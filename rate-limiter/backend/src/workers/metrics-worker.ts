/**
 * Metrics aggregation worker for Rate Limiter
 * Processes metrics-aggregation queue for dashboard updates.
 */
import amqp, { Channel, ConsumeMessage } from 'amqplib';
import { logger } from '../shared/logger.js';
import {
  initializeQueue,
  closeQueue,
  QUEUES,
  MetricsAggregation,
  getConsumerChannel,
} from '../shared/queue.js';
import { prometheusMetrics } from '../shared/metrics.js';

/**
 * Store aggregated metrics (would go to time-series DB in production).
 */
interface StoredMetrics {
  window: number;
  data: MetricsAggregation['data'];
  processedAt: number;
}

/** In-memory metrics history for demo (would use InfluxDB/TimescaleDB in production) */
const metricsHistory: StoredMetrics[] = [];
const MAX_HISTORY = 60; // Keep last 60 windows (~1 hour at 1-minute windows)

/**
 * Process aggregated metrics.
 */
function processMetrics(aggregation: MetricsAggregation): void {
  const { window, data } = aggregation;

  logger.info({
    window: new Date(window).toISOString(),
    totalRequests: data.totalRequests,
    allowedRequests: data.allowedRequests,
    deniedRequests: data.deniedRequests,
    uniqueClients: data.uniqueClients,
    avgLatencyMs: data.avgLatencyMs,
    p99LatencyMs: data.p99LatencyMs,
  }, 'Processing metrics aggregation');

  // Store in history
  metricsHistory.push({
    window,
    data,
    processedAt: Date.now(),
  });

  // Trim history
  while (metricsHistory.length > MAX_HISTORY) {
    metricsHistory.shift();
  }

  // Update Prometheus gauges with latest data
  prometheusMetrics.setActiveIdentifiers(data.uniqueClients);

  // Calculate overall deny rate for alerting
  const denyRate = data.totalRequests > 0
    ? data.deniedRequests / data.totalRequests
    : 0;

  if (denyRate > 0.5) {
    logger.warn({
      denyRate: (denyRate * 100).toFixed(2) + '%',
      window: new Date(window).toISOString(),
    }, 'High deny rate detected - possible attack or misconfiguration');
  }

  // In production, store to time-series database:
  // await influxClient.write('rate_limit_metrics', {
  //   window,
  //   total_requests: data.totalRequests,
  //   allowed_requests: data.allowedRequests,
  //   denied_requests: data.deniedRequests,
  //   unique_clients: data.uniqueClients,
  //   avg_latency_ms: data.avgLatencyMs,
  //   p99_latency_ms: data.p99LatencyMs,
  // });

  // Log breakdown by algorithm
  if (data.byAlgorithm) {
    for (const [algo, stats] of Object.entries(data.byAlgorithm)) {
      logger.debug({
        algorithm: algo,
        allowed: stats.allowed,
        denied: stats.denied,
        denyRate: stats.allowed + stats.denied > 0
          ? ((stats.denied / (stats.allowed + stats.denied)) * 100).toFixed(2) + '%'
          : '0%',
      }, 'Algorithm breakdown');
    }
  }

  // Log breakdown by endpoint
  if (data.byEndpoint) {
    const topEndpoints = Object.entries(data.byEndpoint)
      .map(([endpoint, stats]) => ({
        endpoint,
        total: stats.allowed + stats.denied,
        denied: stats.denied,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    if (topEndpoints.length > 0) {
      logger.debug({ topEndpoints }, 'Top endpoints by traffic');
    }
  }
}

/**
 * Process messages from the metrics aggregation queue.
 */
async function processMetricsMessage(msg: ConsumeMessage, channel: Channel): Promise<void> {
  try {
    const aggregation: MetricsAggregation = JSON.parse(msg.content.toString());

    processMetrics(aggregation);

    channel.ack(msg);
  } catch (error) {
    logger.error({ error }, 'Error processing metrics aggregation');
    channel.nack(msg, false, false);
  }
}

/**
 * Get recent metrics history for dashboard.
 */
export function getMetricsHistory(): StoredMetrics[] {
  return [...metricsHistory];
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  logger.info('Starting rate limiter metrics worker...');

  try {
    await initializeQueue();

    const channel = getConsumerChannel();
    if (!channel) {
      throw new Error('Failed to get consumer channel');
    }

    await channel.prefetch(10);

    await channel.consume(
      QUEUES.METRICS_AGGREGATION,
      (msg) => {
        if (msg) {
          processMetricsMessage(msg, channel);
        }
      },
      { noAck: false }
    );

    logger.info('Rate limiter metrics worker started, waiting for messages...');

    const shutdown = async () => {
      logger.info('Shutting down metrics worker...');
      await closeQueue();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error({ error }, 'Failed to start metrics worker');
    process.exit(1);
  }
}

main();
