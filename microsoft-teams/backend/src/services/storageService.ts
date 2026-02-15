import { Client as MinioClient } from 'minio';
import { config } from '../config/index.js';
import { logger } from './logger.js';
import { Readable } from 'stream';

const minioClient = new MinioClient({
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
      logger.info({ bucket: config.minio.bucket }, 'MinIO bucket created');
    }
  } catch (err) {
    logger.error({ err }, 'Failed to ensure MinIO bucket');
  }
}

/** Uploads a file buffer to MinIO with the specified content type. */
export async function uploadFile(
  storagePath: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const stream = Readable.from(buffer);
  await minioClient.putObject(config.minio.bucket, storagePath, stream, buffer.length, {
    'Content-Type': contentType,
  });
}

/** Generates a presigned GET URL for downloading a file from MinIO. */
export async function getPresignedUrl(storagePath: string): Promise<string> {
  return minioClient.presignedGetObject(config.minio.bucket, storagePath, 3600);
}

/** Deletes a file from MinIO by its storage path. */
export async function deleteFile(storagePath: string): Promise<void> {
  await minioClient.removeObject(config.minio.bucket, storagePath);
}
