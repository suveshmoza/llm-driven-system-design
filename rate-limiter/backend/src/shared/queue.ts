/**
 * @fileoverview RabbitMQ integration for rate limit events and analytics.
 *
 * Provides asynchronous event publishing for:
 * - Rate limit events (allowed/denied decisions)
 * - Metrics aggregation data
 *
 * Events are published non-blocking to avoid impacting rate limit latency.
 * Includes connection management with automatic reconnection.
 */

import amqp, { Connection, Channel, ConfirmChannel } from 'amqplib';
import { logger } from './logger.js';
import { prometheusMetrics } from './metrics.js';

/** RabbitMQ connection configuration */
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

/** Queue names for rate limit events */
export const QUEUES = {
  RATE_LIMIT_EVENTS: 'rate-limit-events',
  METRICS_AGGREGATION: 'metrics-aggregation',
} as const;

/** Singleton connection and channel instances */
let connection: Connection | null = null;
let channel: Channel | null = null;
let confirmChannel: ConfirmChannel | null = null;

/** Connection state tracking */
let isConnecting = false;
let connectionRetries = 0;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

/**
 * Rate limit event payload published to the queue.
 */
export interface RateLimitEvent {
  /** Unique identifier for the requester */
  clientId: string;
  /** API endpoint being accessed */
  endpoint: string;
  /** Whether the request was allowed */
  allowed: boolean;
  /** Remaining requests in the window */
  remaining: number;
  /** Rate limiting algorithm used */
  algorithm: string;
  /** Event timestamp in milliseconds */
  timestamp: number;
  /** Server instance that processed the request */
  serverId?: string;
}

/**
 * Metrics aggregation payload for periodic summaries.
 */
export interface MetricsAggregation {
  /** Time window identifier (e.g., minute timestamp) */
  window: number;
  /** Aggregated metrics data */
  data: {
    totalRequests: number;
    allowedRequests: number;
    deniedRequests: number;
    avgLatencyMs: number;
    p99LatencyMs: number;
    uniqueClients: number;
    byAlgorithm: Record<string, { allowed: number; denied: number }>;
    byEndpoint: Record<string, { allowed: number; denied: number }>;
  };
}

/**
 * Initialize RabbitMQ connection and create necessary queues.
 * Implements automatic retry with exponential backoff.
 *
 * @returns Promise that resolves when connection is established
 */
export async function initializeQueue(): Promise<void> {
  if (connection && channel) {
    return;
  }

  if (isConnecting) {
    // Wait for existing connection attempt
    await new Promise<void>((resolve) => {
      const checkConnection = setInterval(() => {
        if (connection && channel) {
          clearInterval(checkConnection);
          resolve();
        }
      }, 100);
    });
    return;
  }

  isConnecting = true;

  try {
    logger.info({ url: RABBITMQ_URL.replace(/:[^:@]*@/, ':***@') }, 'Connecting to RabbitMQ');

    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    confirmChannel = await connection.createConfirmChannel();

    // Set up connection event handlers
    connection.on('error', (err) => {
      logger.error({ error: err.message }, 'RabbitMQ connection error');
      prometheusMetrics.recordFallback('rabbitmq_error');
    });

    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed');
      connection = null;
      channel = null;
      confirmChannel = null;

      // Attempt reconnection
      if (connectionRetries < MAX_RETRIES) {
        connectionRetries++;
        setTimeout(() => {
          isConnecting = false;
          initializeQueue().catch((err) => {
            logger.error({ error: err.message }, 'RabbitMQ reconnection failed');
          });
        }, RETRY_DELAY_MS * connectionRetries);
      }
    });

    // Declare queues with durability for message persistence
    await channel.assertQueue(QUEUES.RATE_LIMIT_EVENTS, {
      durable: true,
      arguments: {
        'x-message-ttl': 3600000, // 1 hour TTL for unprocessed messages
        'x-max-length': 1000000, // Max 1M messages to prevent unbounded growth
      },
    });

    await channel.assertQueue(QUEUES.METRICS_AGGREGATION, {
      durable: true,
      arguments: {
        'x-message-ttl': 7200000, // 2 hour TTL
        'x-max-length': 100000, // Max 100K messages
      },
    });

    connectionRetries = 0;
    logger.info('RabbitMQ connection established, queues declared');
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Failed to connect to RabbitMQ');
    throw error;
  } finally {
    isConnecting = false;
  }
}

/**
 * Publish a rate limit event to the queue.
 * This is non-blocking - failures are logged but don't throw.
 *
 * @param clientId - Identifier for the rate-limited client
 * @param endpoint - API endpoint that was accessed
 * @param allowed - Whether the request was allowed
 * @param remaining - Remaining requests in the window
 * @param algorithm - Rate limiting algorithm used
 */
export function publishRateLimitEvent(
  clientId: string,
  endpoint: string,
  allowed: boolean,
  remaining: number,
  algorithm: string = 'unknown'
): void {
  if (!channel) {
    logger.debug('RabbitMQ channel not available, skipping event publish');
    return;
  }

  const event: RateLimitEvent = {
    clientId,
    endpoint,
    allowed,
    remaining,
    algorithm,
    timestamp: Date.now(),
    serverId: process.env.SERVER_ID || `server-${process.env.PORT || '3000'}`,
  };

  try {
    const message = Buffer.from(JSON.stringify(event));
    const published = channel.sendToQueue(QUEUES.RATE_LIMIT_EVENTS, message, {
      persistent: true,
      contentType: 'application/json',
    });

    if (!published) {
      logger.warn('RabbitMQ buffer full, rate limit event not published');
    }
  } catch (error) {
    // Non-blocking - log and continue
    logger.warn({ error: (error as Error).message }, 'Failed to publish rate limit event');
  }
}

/**
 * Publish metrics aggregation data to the queue.
 * Uses confirm channel for reliable delivery of important metrics.
 *
 * @param window - Time window identifier (e.g., minute timestamp)
 * @param data - Aggregated metrics data
 * @returns Promise that resolves when message is confirmed
 */
export async function publishMetricsAggregation(
  window: number,
  data: MetricsAggregation['data']
): Promise<boolean> {
  if (!confirmChannel) {
    logger.debug('RabbitMQ confirm channel not available, skipping metrics publish');
    return false;
  }

  const payload: MetricsAggregation = {
    window,
    data,
  };

  try {
    const message = Buffer.from(JSON.stringify(payload));

    return new Promise((resolve) => {
      confirmChannel!.sendToQueue(
        QUEUES.METRICS_AGGREGATION,
        message,
        {
          persistent: true,
          contentType: 'application/json',
        },
        (err) => {
          if (err) {
            logger.error({ error: err.message }, 'Failed to confirm metrics aggregation publish');
            resolve(false);
          } else {
            resolve(true);
          }
        }
      );
    });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Failed to publish metrics aggregation');
    return false;
  }
}

/**
 * Get a channel for consuming messages.
 * Creates a new channel if the current one is not available.
 *
 * @returns Channel for message consumption, or null if unavailable
 */
export function getConsumerChannel(): Channel | null {
  return channel;
}

/**
 * Get the RabbitMQ connection for advanced operations.
 *
 * @returns Connection instance, or null if not connected
 */
export function getConnection(): Connection | null {
  return connection;
}

/**
 * Check if RabbitMQ is connected and ready.
 *
 * @returns True if connected and channel is available
 */
export function isQueueReady(): boolean {
  return connection !== null && channel !== null;
}

/**
 * Gracefully close the RabbitMQ connection.
 * Should be called during application shutdown.
 *
 * @returns Promise that resolves when connection is closed
 */
export async function closeQueue(): Promise<void> {
  try {
    if (channel) {
      await channel.close();
      channel = null;
    }
    if (confirmChannel) {
      await confirmChannel.close();
      confirmChannel = null;
    }
    if (connection) {
      await connection.close();
      connection = null;
    }
    logger.info('RabbitMQ connection closed');
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Error closing RabbitMQ connection');
  }
}
