/**
 * Image processing worker for Pinterest.
 * Consumes from RabbitMQ, processes images with Sharp:
 * - Extracts dimensions (width, height)
 * - Calculates aspect_ratio = height / width
 * - Extracts dominant color via sharp.stats()
 * - Generates thumbnail (300px wide)
 * - Uploads thumbnail to MinIO
 * - Updates pin record with results
 */

import sharp from 'sharp';
import { logger } from '../services/logger.js';
import { initializeQueue, getChannel, QUEUES } from '../services/queue.js';
import { getObject, uploadImage } from '../services/storage.js';
import { updatePinProcessing } from '../services/pinService.js';
import { imageProcessingDuration, imageProcessingErrors } from '../services/metrics.js';
import redis from '../services/redis.js';

interface ImageJob {
  pinId: string;
  imageKey: string;
}

/**
 * Convert RGB values to hex color string.
 */
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Process a single image: extract metadata, generate thumbnail, upload.
 */
async function processImage(job: ImageJob): Promise<void> {
  const start = Date.now();
  const { pinId, imageKey } = job;

  logger.info({ pinId, imageKey }, 'Processing image');

  try {
    // Download original from MinIO
    const originalBuffer = await getObject(imageKey);

    // Get image metadata
    const image = sharp(originalBuffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error('Could not extract image dimensions');
    }

    const width = metadata.width;
    const height = metadata.height;
    const aspectRatio = height / width;

    // Extract dominant color using sharp stats
    const stats = await image.stats();
    const dominant = stats.dominant;
    const dominantColor = rgbToHex(dominant.r, dominant.g, dominant.b);

    // Generate thumbnail (300px wide, maintaining aspect ratio)
    const thumbnailBuffer = await sharp(originalBuffer)
      .resize(300, Math.round(300 * aspectRatio), { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer();

    // Upload thumbnail to MinIO
    const thumbnailKey = `thumbnails/${pinId}/thumb.webp`;
    const thumbnailUrl = await uploadImage(thumbnailKey, thumbnailBuffer, 'image/webp');

    // Update pin record in database
    await updatePinProcessing(pinId, {
      imageWidth: width,
      imageHeight: height,
      aspectRatio,
      dominantColor,
      status: 'published',
      thumbnailUrl,
    });

    const duration = (Date.now() - start) / 1000;
    imageProcessingDuration.observe(duration);

    logger.info(
      { pinId, width, height, aspectRatio, dominantColor, duration },
      'Image processed successfully',
    );
  } catch (err) {
    imageProcessingErrors.inc();
    logger.error({ err, pinId, imageKey }, 'Image processing failed');

    // Mark pin as failed
    try {
      await updatePinProcessing(pinId, {
        imageWidth: 0,
        imageHeight: 0,
        aspectRatio: 1,
        dominantColor: '#cccccc',
        status: 'failed',
      });
    } catch (updateErr) {
      logger.error({ err: updateErr, pinId }, 'Failed to update pin status to failed');
    }
  }
}

/**
 * Start the image processing worker.
 */
async function startWorker() {
  logger.info('Starting image processing worker...');

  // Connect to Redis
  await redis.connect();

  // Initialize RabbitMQ
  await initializeQueue();

  const channel = getChannel();
  if (!channel) {
    logger.error('Failed to get RabbitMQ channel');
    process.exit(1);
  }

  logger.info('Image worker listening for jobs...');

  // Consume messages
  await channel.consume(
    QUEUES.IMAGE_PROCESSING,
    async (msg) => {
      if (!msg) return;

      try {
        const job: ImageJob = JSON.parse(msg.content.toString());
        await processImage(job);
        channel.ack(msg);
      } catch (err) {
        logger.error({ err }, 'Error processing message');
        // Reject and don't requeue (send to DLQ)
        channel.nack(msg, false, false);
      }
    },
    { noAck: false },
  );

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Worker shutting down...');
    await redis.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startWorker();
