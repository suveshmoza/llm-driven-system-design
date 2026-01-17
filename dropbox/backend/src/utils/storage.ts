/**
 * MinIO/S3 object storage utilities for chunk storage and retrieval.
 * Chunks are stored in a content-addressed manner using their SHA-256 hash.
 * Supports presigned URLs for direct client uploads/downloads.
 * @module utils/storage
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// MinIO connection configuration from environment variables
const endpoint = process.env.MINIO_ENDPOINT || 'localhost';
const port = process.env.MINIO_PORT || '9000';
const useSSL = process.env.MINIO_USE_SSL === 'true';
const accessKey = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const secretKey = process.env.MINIO_SECRET_KEY || 'minioadmin123';
const bucket = process.env.MINIO_BUCKET || 'dropbox-chunks';

/**
 * S3-compatible client configured for MinIO.
 * forcePathStyle is required for MinIO compatibility.
 */
export const s3Client = new S3Client({
  endpoint: `${useSSL ? 'https' : 'http'}://${endpoint}:${port}`,
  region: 'us-east-1',
  credentials: {
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
  },
  forcePathStyle: true, // Required for MinIO
});

/** Name of the S3 bucket where chunks are stored */
export const BUCKET_NAME = bucket;

/**
 * Uploads a chunk to object storage.
 * Chunks are stored with their hash as the key for content-addressing.
 * @param hash - SHA-256 hash of the chunk data (used as storage key)
 * @param data - Raw chunk data to store
 * @returns Storage key where the chunk was saved
 */
export async function uploadChunk(hash: string, data: Buffer): Promise<string> {
  const key = getChunkKey(hash);

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: data,
    ContentType: 'application/octet-stream',
  }));

  return key;
}

/**
 * Downloads a chunk from object storage.
 * Streams the response body and concatenates into a Buffer.
 * @param hash - SHA-256 hash identifying the chunk
 * @returns Raw chunk data as a Buffer
 */
export async function downloadChunk(hash: string): Promise<Buffer> {
  const key = getChunkKey(hash);

  const response = await s3Client.send(new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  }));

  const chunks: Uint8Array[] = [];
  const stream = response.Body as AsyncIterable<Uint8Array>;

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

/**
 * Checks if a chunk already exists in storage.
 * Used for deduplication - skip uploading chunks that already exist.
 * @param hash - SHA-256 hash of the chunk to check
 * @returns true if chunk exists, false otherwise
 */
export async function chunkExists(hash: string): Promise<boolean> {
  const key = getChunkKey(hash);

  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes a chunk from object storage.
 * Called during garbage collection when reference count reaches zero.
 * @param hash - SHA-256 hash of the chunk to delete
 */
export async function deleteChunk(hash: string): Promise<void> {
  const key = getChunkKey(hash);

  await s3Client.send(new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  }));
}

/**
 * Generates a presigned URL for direct chunk upload from the client.
 * Enables large file uploads without proxying through the API server.
 * @param hash - SHA-256 hash for the chunk being uploaded
 * @param expiresIn - URL validity in seconds (default 1 hour)
 * @returns Presigned URL for PUT request
 */
export async function getUploadPresignedUrl(hash: string, expiresIn: number = 3600): Promise<string> {
  const key = getChunkKey(hash);

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: 'application/octet-stream',
  });

  return getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Generates a presigned URL for direct chunk download.
 * Enables parallel chunk downloads directly from storage.
 * @param hash - SHA-256 hash of the chunk to download
 * @param expiresIn - URL validity in seconds (default 1 hour)
 * @returns Presigned URL for GET request
 */
export async function getDownloadPresignedUrl(hash: string, expiresIn: number = 3600): Promise<string> {
  const key = getChunkKey(hash);

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Generates the storage key for a chunk.
 * Chunks are organized into subdirectories by hash prefix for better filesystem performance.
 * @param hash - SHA-256 hash of the chunk
 * @returns Storage key path (e.g., "chunks/ab/abcdef123...")
 */
function getChunkKey(hash: string): string {
  const prefix = hash.substring(0, 2);
  return `chunks/${prefix}/${hash}`;
}
