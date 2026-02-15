import { S3Client, PutObjectCommand, GetObjectCommand, PutObjectCommandOutput } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

const s3Client = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY || 'minio_admin',
    secretAccessKey: process.env.MINIO_SECRET_KEY || 'minio_secret'
  },
  forcePathStyle: true
});

/** S3-compatible bucket name constants for audio and artwork storage. */
export const BUCKETS = {
  AUDIO: 'audio-files',
  ARTWORK: 'album-artwork'
} as const;

export type BucketName = typeof BUCKETS[keyof typeof BUCKETS];

/**
 * Uploads a file to the specified S3-compatible bucket.
 * @param bucket - Target bucket name.
 * @param key - Object key (path) within the bucket.
 * @param body - File content as Buffer, Readable stream, or string.
 * @param contentType - MIME type of the file.
 * @returns The S3 PutObject response.
 */
export async function uploadFile(
  bucket: BucketName,
  key: string,
  body: Buffer | Readable | string,
  contentType: string
): Promise<PutObjectCommandOutput> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType
  });

  return s3Client.send(command);
}

/**
 * Generates a time-limited signed URL for downloading a file.
 * @param bucket - Bucket containing the file.
 * @param key - Object key within the bucket.
 * @param expiresIn - URL expiration time in seconds (default: 3600).
 * @returns A signed download URL.
 */
export async function getSignedDownloadUrl(
  bucket: BucketName,
  key: string,
  expiresIn: number = 3600
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key
  });

  return getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Constructs a direct public URL for a file in MinIO (development only).
 * @param bucket - Bucket containing the file.
 * @param key - Object key within the bucket.
 * @returns The public URL string.
 */
export async function getPublicUrl(bucket: BucketName, key: string): Promise<string> {
  const endpoint = process.env.MINIO_ENDPOINT || 'http://localhost:9000';
  return `${endpoint}/${bucket}/${key}`;
}

export { s3Client };
