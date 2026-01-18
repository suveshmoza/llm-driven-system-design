/**
 * RabbitMQ message queue for async event processing.
 *
 * Provides:
 * - Connection management with reconnection logic
 * - Pixel event publishing for async persistence
 * - Snapshot job publishing for periodic captures
 * - Consumer setup for workers
 *
 * Queues:
 * - pixel-events: High-volume pixel placement events
 * - snapshot-jobs: Periodic snapshot generation triggers
 */
import amqplib, { Connection, Channel, ConsumeMessage } from 'amqplib';
import { logger } from './logger.js';
import { Counter, Histogram } from 'prom-client';
import { metricsRegistry } from './metrics.js';

/** RabbitMQ connection URL. */
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

/** Queue names. */
export const QUEUES = {
  PIXEL_EVENTS: 'pixel-events',
  SNAPSHOT_JOBS: 'snapshot-jobs',
} as const;

/** Exchange names. */
export const EXCHANGES = {
  PIXEL_EVENTS: 'pixel-events-exchange',
} as const;

/** Shared connection instance. */
let connection: Connection | null = null;

/** Shared channel instance for publishing. */
let publishChannel: Channel | null = null;

/** Flag to prevent multiple connection attempts. */
let isConnecting = false;

/** Reconnection delay in ms. */
const RECONNECT_DELAY = 5000;

/**
 * Metrics for queue operations.
 */
export const queueMessagesPublished = new Counter({
  name: 'rplace_queue_messages_published_total',
  help: 'Total number of messages published to queues',
  labelNames: ['queue'] as const,
  registers: [metricsRegistry],
});

export const queueMessagesConsumed = new Counter({
  name: 'rplace_queue_messages_consumed_total',
  help: 'Total number of messages consumed from queues',
  labelNames: ['queue', 'status'] as const,
  registers: [metricsRegistry],
});

export const queuePublishDuration = new Histogram({
  name: 'rplace_queue_publish_duration_seconds',
  help: 'Time to publish a message to the queue',
  labelNames: ['queue'] as const,
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.025, 0.05],
  registers: [metricsRegistry],
});

/**
 * Pixel event message structure for the queue.
 */
export interface PixelEventMessage {
  x: number;
  y: number;
  color: number;
  userId: string;
  timestamp: number;
}

/**
 * Snapshot job message structure.
 */
export interface SnapshotJobMessage {
  triggeredAt: number;
  reason: 'scheduled' | 'manual';
}

/**
 * Connects to RabbitMQ and sets up exchanges/queues.
 *
 * @returns Promise that resolves when connected.
 */
export async function connectQueue(): Promise<void> {
  if (connection && publishChannel) {
    return;
  }

  if (isConnecting) {
    // Wait for existing connection attempt
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return connectQueue();
  }

  isConnecting = true;

  try {
    logger.info({ url: RABBITMQ_URL.replace(/:[^:@]+@/, ':***@') }, 'Connecting to RabbitMQ');
    connection = await amqplib.connect(RABBITMQ_URL);

    connection.on('error', (err) => {
      logger.error({ error: err }, 'RabbitMQ connection error');
    });

    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed, scheduling reconnect');
      connection = null;
      publishChannel = null;
      setTimeout(() => {
        connectQueue().catch((err) =>
          logger.error({ error: err }, 'RabbitMQ reconnection failed')
        );
      }, RECONNECT_DELAY);
    });

    // Create publish channel
    publishChannel = await connection.createChannel();

    // Set up queues with durability
    await publishChannel.assertQueue(QUEUES.PIXEL_EVENTS, {
      durable: true,
      arguments: {
        'x-message-ttl': 86400000, // 24 hours
        'x-max-length': 1000000, // Max 1M messages
      },
    });

    await publishChannel.assertQueue(QUEUES.SNAPSHOT_JOBS, {
      durable: true,
      arguments: {
        'x-message-ttl': 3600000, // 1 hour
        'x-max-length': 1000, // Max 1K messages
      },
    });

    logger.info('RabbitMQ connected and queues asserted');
  } catch (error) {
    logger.error({ error }, 'Failed to connect to RabbitMQ');
    throw error;
  } finally {
    isConnecting = false;
  }
}

/**
 * Publishes a pixel event to the queue for async persistence.
 *
 * @param x - X coordinate.
 * @param y - Y coordinate.
 * @param color - Color index.
 * @param userId - User who placed the pixel.
 */
export async function publishPixelEvent(
  x: number,
  y: number,
  color: number,
  userId: string
): Promise<void> {
  const start = Date.now();

  if (!publishChannel) {
    logger.warn('Queue not connected, attempting to reconnect');
    await connectQueue();
  }

  if (!publishChannel) {
    logger.error('Cannot publish pixel event: queue not connected');
    return;
  }

  const message: PixelEventMessage = {
    x,
    y,
    color,
    userId,
    timestamp: Date.now(),
  };

  try {
    publishChannel.sendToQueue(
      QUEUES.PIXEL_EVENTS,
      Buffer.from(JSON.stringify(message)),
      {
        persistent: true,
        contentType: 'application/json',
      }
    );

    queueMessagesPublished.inc({ queue: QUEUES.PIXEL_EVENTS });
    queuePublishDuration.observe(
      { queue: QUEUES.PIXEL_EVENTS },
      (Date.now() - start) / 1000
    );
  } catch (error) {
    logger.error({ error, message }, 'Failed to publish pixel event');
  }
}

/**
 * Publishes a snapshot job to the queue.
 *
 * @param reason - Why the snapshot is being triggered.
 */
export async function publishSnapshotJob(reason: 'scheduled' | 'manual' = 'scheduled'): Promise<void> {
  const start = Date.now();

  if (!publishChannel) {
    await connectQueue();
  }

  if (!publishChannel) {
    logger.error('Cannot publish snapshot job: queue not connected');
    return;
  }

  const message: SnapshotJobMessage = {
    triggeredAt: Date.now(),
    reason,
  };

  try {
    publishChannel.sendToQueue(
      QUEUES.SNAPSHOT_JOBS,
      Buffer.from(JSON.stringify(message)),
      {
        persistent: true,
        contentType: 'application/json',
      }
    );

    queueMessagesPublished.inc({ queue: QUEUES.SNAPSHOT_JOBS });
    queuePublishDuration.observe(
      { queue: QUEUES.SNAPSHOT_JOBS },
      (Date.now() - start) / 1000
    );

    logger.debug({ reason }, 'Snapshot job published');
  } catch (error) {
    logger.error({ error }, 'Failed to publish snapshot job');
  }
}

/**
 * Creates a consumer for pixel events.
 *
 * @param handler - Function to process batches of pixel events.
 * @param batchSize - Number of messages to batch before processing.
 * @param batchTimeoutMs - Max time to wait for a full batch.
 * @returns Promise resolving to the consumer channel.
 */
export async function consumePixelEvents(
  handler: (events: PixelEventMessage[]) => Promise<void>,
  batchSize: number = 100,
  batchTimeoutMs: number = 1000
): Promise<Channel> {
  if (!connection) {
    await connectQueue();
  }

  if (!connection) {
    throw new Error('Cannot create consumer: not connected to RabbitMQ');
  }

  const channel = await connection.createChannel();

  // Prefetch to control how many messages we receive at once
  await channel.prefetch(batchSize);

  let batch: { message: PixelEventMessage; msg: ConsumeMessage }[] = [];
  let batchTimer: NodeJS.Timeout | null = null;

  const processBatch = async () => {
    if (batch.length === 0) return;

    const currentBatch = batch;
    batch = [];

    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }

    try {
      await handler(currentBatch.map((b) => b.message));

      // Ack all messages in batch
      for (const item of currentBatch) {
        channel.ack(item.msg);
      }

      queueMessagesConsumed.inc(
        { queue: QUEUES.PIXEL_EVENTS, status: 'success' },
        currentBatch.length
      );
    } catch (error) {
      logger.error({ error, batchSize: currentBatch.length }, 'Failed to process pixel event batch');

      // Nack all messages for retry
      for (const item of currentBatch) {
        channel.nack(item.msg, false, true);
      }

      queueMessagesConsumed.inc(
        { queue: QUEUES.PIXEL_EVENTS, status: 'error' },
        currentBatch.length
      );
    }
  };

  await channel.consume(
    QUEUES.PIXEL_EVENTS,
    async (msg) => {
      if (!msg) return;

      try {
        const message: PixelEventMessage = JSON.parse(msg.content.toString());
        batch.push({ message, msg });

        // Start batch timer if not already running
        if (!batchTimer) {
          batchTimer = setTimeout(processBatch, batchTimeoutMs);
        }

        // Process immediately if batch is full
        if (batch.length >= batchSize) {
          await processBatch();
        }
      } catch (error) {
        logger.error({ error }, 'Failed to parse pixel event message');
        channel.nack(msg, false, false); // Don't requeue malformed messages
      }
    },
    { noAck: false }
  );

  logger.info(
    { queue: QUEUES.PIXEL_EVENTS, batchSize, batchTimeoutMs },
    'Pixel events consumer started'
  );

  return channel;
}

/**
 * Creates a consumer for snapshot jobs.
 *
 * @param handler - Function to process snapshot jobs.
 * @returns Promise resolving to the consumer channel.
 */
export async function consumeSnapshotJobs(
  handler: (job: SnapshotJobMessage) => Promise<void>
): Promise<Channel> {
  if (!connection) {
    await connectQueue();
  }

  if (!connection) {
    throw new Error('Cannot create consumer: not connected to RabbitMQ');
  }

  const channel = await connection.createChannel();

  // Process one at a time for snapshots
  await channel.prefetch(1);

  await channel.consume(
    QUEUES.SNAPSHOT_JOBS,
    async (msg) => {
      if (!msg) return;

      try {
        const job: SnapshotJobMessage = JSON.parse(msg.content.toString());
        await handler(job);
        channel.ack(msg);
        queueMessagesConsumed.inc({ queue: QUEUES.SNAPSHOT_JOBS, status: 'success' });
      } catch (error) {
        logger.error({ error }, 'Failed to process snapshot job');
        channel.nack(msg, false, true); // Requeue on error
        queueMessagesConsumed.inc({ queue: QUEUES.SNAPSHOT_JOBS, status: 'error' });
      }
    },
    { noAck: false }
  );

  logger.info({ queue: QUEUES.SNAPSHOT_JOBS }, 'Snapshot jobs consumer started');

  return channel;
}

/**
 * Checks if the queue connection is healthy.
 *
 * @returns True if connected, false otherwise.
 */
export function isQueueHealthy(): boolean {
  return connection !== null && publishChannel !== null;
}

/**
 * Gracefully closes the RabbitMQ connection.
 */
export async function closeQueue(): Promise<void> {
  try {
    if (publishChannel) {
      await publishChannel.close();
      publishChannel = null;
    }
    if (connection) {
      await connection.close();
      connection = null;
    }
    logger.info('RabbitMQ connection closed');
  } catch (error) {
    logger.error({ error }, 'Error closing RabbitMQ connection');
  }
}
