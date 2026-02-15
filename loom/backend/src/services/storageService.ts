import * as Minio from 'minio';
import { config } from '../config/index.js';
import { logger } from './logger.js';

const minioClient = new Minio.Client({
  endPoint: config.minio.endpoint,
  port: config.minio.port,
  useSSL: false,
  accessKey: config.minio.accessKey,
  secretKey: config.minio.secretKey,
});

/** Ensures the configured MinIO bucket exists, creating it if necessary. */
export async function ensureBucket(): Promise<void> {
  try {
    const exists = await minioClient.bucketExists(config.minio.bucket);
    if (!exists) {
      await minioClient.makeBucket(config.minio.bucket);
      logger.info({ bucket: config.minio.bucket }, 'Created MinIO bucket');
    }
  } catch (err) {
    logger.error({ err }, 'Failed to ensure MinIO bucket');
  }
}

/** Generates a presigned PUT URL for direct browser-to-MinIO video upload. */
export async function getPresignedUploadUrl(
  objectName: string,
  expirySeconds: number = 3600,
): Promise<string> {
  return minioClient.presignedPutObject(
    config.minio.bucket,
    objectName,
    expirySeconds,
  );
}

/** Generates a presigned GET URL for video playback or download. */
export async function getPresignedDownloadUrl(
  objectName: string,
  expirySeconds: number = 3600,
): Promise<string> {
  return minioClient.presignedGetObject(
    config.minio.bucket,
    objectName,
    expirySeconds,
  );
}

/** Deletes a video or thumbnail object from MinIO. */
export async function deleteObject(objectName: string): Promise<void> {
  await minioClient.removeObject(config.minio.bucket, objectName);
}

/** Retrieves metadata (size, etag, etc.) for an object in MinIO. */
export async function getObjectStat(
  objectName: string,
): Promise<Minio.BucketItemStat> {
  return minioClient.statObject(config.minio.bucket, objectName);
}

export { minioClient };
