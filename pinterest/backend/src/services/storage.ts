import * as Minio from 'minio';
import config from '../config/index.js';
import { logger } from './logger.js';

const minioClient = new Minio.Client({
  endPoint: config.minio.endPoint,
  port: config.minio.port,
  useSSL: config.minio.useSSL,
  accessKey: config.minio.accessKey,
  secretKey: config.minio.secretKey,
});

const BUCKET = config.minio.bucket;

/** Creates the MinIO bucket if it does not already exist. */
export async function ensureBucket(): Promise<void> {
  try {
    const exists = await minioClient.bucketExists(BUCKET);
    if (!exists) {
      await minioClient.makeBucket(BUCKET, 'us-east-1');
      logger.info({ bucket: BUCKET }, 'Created bucket');
    }
  } catch (err) {
    logger.error({ err }, 'Failed to ensure bucket exists');
  }
}

/** Uploads an image buffer to MinIO and returns its public URL. */
export async function uploadImage(
  objectName: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  await minioClient.putObject(BUCKET, objectName, buffer, buffer.length, {
    'Content-Type': contentType,
  });
  return getPublicUrl(objectName);
}

/** Downloads an object from MinIO and returns it as a Buffer. */
export async function getObject(objectName: string): Promise<Buffer> {
  const stream = await minioClient.getObject(BUCKET, objectName);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/** Constructs a public URL for a MinIO object based on endpoint configuration. */
export function getPublicUrl(objectName: string): string {
  const protocol = config.minio.useSSL ? 'https' : 'http';
  return `${protocol}://${config.minio.endPoint}:${config.minio.port}/${BUCKET}/${objectName}`;
}

/** Removes an object from the MinIO bucket. */
export async function deleteObject(objectName: string): Promise<void> {
  await minioClient.removeObject(BUCKET, objectName);
}

export { minioClient, BUCKET };
export default minioClient;
