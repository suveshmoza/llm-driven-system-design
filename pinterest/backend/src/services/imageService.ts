import { v4 as uuidv4 } from 'uuid';
import { uploadImage } from './storage.js';
import { publishImageProcessingJob } from './queue.js';
import { logger } from './logger.js';

export interface UploadResult {
  imageKey: string;
  imageUrl: string;
}

/**
 * Upload an original image to MinIO and queue processing.
 */
export async function uploadOriginalImage(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  pinId: string,
): Promise<UploadResult> {
  const ext = originalName.split('.').pop() || 'jpg';
  const imageKey = `originals/${pinId}/${uuidv4()}.${ext}`;

  const imageUrl = await uploadImage(imageKey, buffer, mimeType);

  // Queue image processing job
  const published = await publishImageProcessingJob({ pinId, imageKey });
  if (!published) {
    logger.warn({ pinId }, 'Failed to queue image processing job; will process inline');
  }

  return { imageKey, imageUrl };
}

/**
 * Upload a processed thumbnail to MinIO.
 */
export async function uploadThumbnail(
  buffer: Buffer,
  pinId: string,
): Promise<string> {
  const thumbKey = `thumbnails/${pinId}/${uuidv4()}.webp`;
  return uploadImage(thumbKey, buffer, 'image/webp');
}
