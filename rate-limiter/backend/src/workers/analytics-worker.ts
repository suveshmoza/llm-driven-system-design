/**
 * Analytics worker for Rate Limiter
 * Processes rate-limit-events queue for analytics and auditing.
 */
import amqp, { Channel, ConsumeMessage } from 'amqplib';
import { logger } from '../shared/logger.js';
import {
  initializeQueue,
  closeQueue,
  QUEUES,
  RateLimitEvent,
  getConsumerChannel,
} from '../shared/queue.js';
import { prometheusMetrics } from '../shared/metrics.js';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

/** In-memory aggregation for demo (would use PostgreSQL or ClickHouse in production) */
interface AggregatedStats {
  windowStart: number;
  totalAllowed: number;
  totalDenied: number;
  byEndpoint: Map<string, { allowed: number; denied: number }>;
  byAlgorithm: Map<string, { allowed: number; denied: number }>;
  byClient: Map<string, { allowed: number; denied: number }>;
  latencies: number[];
}

let currentWindow: AggregatedStats | null = null;
const WINDOW_SIZE_MS = 60_000; // 1-minute windows

/**
 * Get or create the current aggregation window.
 */
function getWindow(): AggregatedStats {
  const now = Date.now();
  const windowStart = Math.floor(now / WINDOW_SIZE_MS) * WINDOW_SIZE_MS;

  if (!currentWindow || currentWindow.windowStart !== windowStart) {
    // Flush previous window if exists
    if (currentWindow) {
      flushWindow(currentWindow);
    }

    currentWindow = {
      windowStart,
      totalAllowed: 0,
      totalDenied: 0,
      byEndpoint: new Map(),
      byAlgorithm: new Map(),
      byClient: new Map(),
      latencies: [],
    };
  }

  return currentWindow;
}

/**
 * Flush aggregated window to storage (simulated).
 */
function flushWindow(window: AggregatedStats): void {
  const p99 = window.latencies.length > 0
    ? window.latencies.sort((a, b) => a - b)[Math.floor(window.latencies.length * 0.99)]
    : 0;

  logger.info({
    windowStart: new Date(window.windowStart).toISOString(),
    totalAllowed: window.totalAllowed,
    totalDenied: window.totalDenied,
    uniqueClients: window.byClient.size,
    uniqueEndpoints: window.byEndpoint.size,
    p99LatencyMs: p99,
  }, 'Flushing aggregated window');

  // In production, store to PostgreSQL:
  // await pool.query(`
  //   INSERT INTO rate_limit_analytics
  //     (window_start, allowed, denied, unique_clients, p99_latency)
  //   VALUES ($1, $2, $3, $4, $5)
  // `, [window.windowStart, window.totalAllowed, window.totalDenied, window.byClient.size, p99]);
}

/**
 * Process a rate limit event.
 */
function processEvent(event: RateLimitEvent): void {
  const window = getWindow();

  if (event.allowed) {
    window.totalAllowed++;
  } else {
    window.totalDenied++;
  }

  // By endpoint
  const endpointStats = window.byEndpoint.get(event.endpoint) || { allowed: 0, denied: 0 };
  if (event.allowed) endpointStats.allowed++;
  else endpointStats.denied++;
  window.byEndpoint.set(event.endpoint, endpointStats);

  // By algorithm
  const algoStats = window.byAlgorithm.get(event.algorithm) || { allowed: 0, denied: 0 };
  if (event.allowed) algoStats.allowed++;
  else algoStats.denied++;
  window.byAlgorithm.set(event.algorithm, algoStats);

  // By client
  const clientStats = window.byClient.get(event.clientId) || { allowed: 0, denied: 0 };
  if (event.allowed) clientStats.allowed++;
  else clientStats.denied++;
  window.byClient.set(event.clientId, clientStats);

  // Update Prometheus metrics
  prometheusMetrics.rateLimitChecks.inc({
    result: event.allowed ? 'allowed' : 'denied',
    algorithm: event.algorithm,
  });
}

/**
 * Process messages from the rate limit events queue.
 */
async function processRateLimitEvents(msg: ConsumeMessage, channel: Channel): Promise<void> {
  try {
    const event: RateLimitEvent = JSON.parse(msg.content.toString());

    processEvent(event);

    channel.ack(msg);
  } catch (error) {
    logger.error({ error }, 'Error processing rate limit event');
    channel.nack(msg, false, false); // Discard malformed messages
  }
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  logger.info('Starting rate limiter analytics worker...');

  try {
    await initializeQueue();

    const channel = getConsumerChannel();
    if (!channel) {
      throw new Error('Failed to get consumer channel');
    }

    // Set prefetch for batch processing
    await channel.prefetch(100);

    await channel.consume(
      QUEUES.RATE_LIMIT_EVENTS,
      (msg) => {
        if (msg) {
          processRateLimitEvents(msg, channel);
        }
      },
      { noAck: false }
    );

    logger.info('Rate limiter analytics worker started, waiting for messages...');

    // Periodic window flush
    setInterval(() => {
      if (currentWindow) {
        const now = Date.now();
        const windowEnd = currentWindow.windowStart + WINDOW_SIZE_MS;
        if (now >= windowEnd) {
          flushWindow(currentWindow);
          currentWindow = null;
        }
      }
    }, 10_000); // Check every 10 seconds

    const shutdown = async () => {
      logger.info('Shutting down analytics worker...');
      if (currentWindow) {
        flushWindow(currentWindow);
      }
      await closeQueue();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error({ error }, 'Failed to start analytics worker');
    process.exit(1);
  }
}

main();
