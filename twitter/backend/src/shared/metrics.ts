import promClient from 'prom-client';
import type { Request, Response, NextFunction } from 'express';
import logger from './logger.js';

// Create a Registry for Prometheus metrics
const register = new promClient.Registry();

// Add default labels
register.setDefaultLabels({
  app: 'twitter-api',
  env: process.env.NODE_ENV || 'development',
});

// Collect default metrics (CPU, memory, event loop, etc.)
promClient.collectDefaultMetrics({ register });

// ============================================================================
// Custom Application Metrics
// ============================================================================

/**
 * Tweet Throughput Metrics
 */
export const tweetCounter = new promClient.Counter({
  name: 'twitter_tweets_created_total',
  help: 'Total number of tweets created',
  labelNames: ['status'] as const, // success, error
  registers: [register],
});

export const tweetCreationDuration = new promClient.Histogram({
  name: 'twitter_tweet_creation_duration_seconds',
  help: 'Duration of tweet creation in seconds',
  labelNames: ['status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

/**
 * Timeline Latency Metrics
 */
export const timelineLatency = new promClient.Histogram({
  name: 'twitter_timeline_latency_seconds',
  help: 'Home timeline fetch latency in seconds',
  labelNames: ['timeline_type', 'cache_hit'] as const, // home, user, explore, hashtag
  buckets: [0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2],
  registers: [register],
});

export const timelineRequestsTotal = new promClient.Counter({
  name: 'twitter_timeline_requests_total',
  help: 'Total number of timeline requests',
  labelNames: ['timeline_type', 'status'] as const,
  registers: [register],
});

/**
 * Fanout Queue Depth Metrics
 */
export const fanoutQueueDepth = new promClient.Gauge({
  name: 'twitter_fanout_queue_depth',
  help: 'Current depth of the fanout queue',
  registers: [register],
});

export const fanoutOperationsTotal = new promClient.Counter({
  name: 'twitter_fanout_operations_total',
  help: 'Total number of fanout operations',
  labelNames: ['status'] as const, // success, error, skipped (celebrity)
  registers: [register],
});

export const fanoutDuration = new promClient.Histogram({
  name: 'twitter_fanout_duration_seconds',
  help: 'Duration of fanout operations in seconds',
  labelNames: ['follower_count_bucket'] as const, // <100, 100-1000, 1000-10000
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const fanoutFollowersTotal = new promClient.Counter({
  name: 'twitter_fanout_followers_total',
  help: 'Total number of followers notified via fanout',
  registers: [register],
});

/**
 * Circuit Breaker Metrics
 */
export const circuitBreakerState = new promClient.Gauge({
  name: 'twitter_circuit_breaker_state',
  help: 'Circuit breaker state: 0=closed, 1=half-open, 2=open',
  labelNames: ['circuit_name'] as const,
  registers: [register],
});

export const circuitBreakerTrips = new promClient.Counter({
  name: 'twitter_circuit_breaker_trips_total',
  help: 'Total number of circuit breaker trips',
  labelNames: ['circuit_name'] as const,
  registers: [register],
});

/**
 * Redis Connection Metrics
 */
export const redisConnectionStatus = new promClient.Gauge({
  name: 'twitter_redis_connection_status',
  help: 'Redis connection status: 1=connected, 0=disconnected',
  registers: [register],
});

export const redisOperationDuration = new promClient.Histogram({
  name: 'twitter_redis_operation_duration_seconds',
  help: 'Duration of Redis operations in seconds',
  labelNames: ['operation'] as const, // get, set, lpush, pipeline, etc.
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
  registers: [register],
});

/**
 * Database Connection Metrics
 */
export const dbConnectionPoolSize = new promClient.Gauge({
  name: 'twitter_db_connection_pool_size',
  help: 'Current size of the database connection pool',
  labelNames: ['state'] as const, // total, idle, waiting
  registers: [register],
});

export const dbQueryDuration = new promClient.Histogram({
  name: 'twitter_db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['query_type'] as const, // select, insert, update, delete
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

/**
 * HTTP Request Metrics
 */
export const httpRequestDuration = new promClient.Histogram({
  name: 'twitter_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const httpRequestsTotal = new promClient.Counter({
  name: 'twitter_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

/**
 * Idempotency Metrics
 */
export const idempotencyHits = new promClient.Counter({
  name: 'twitter_idempotency_cache_hits_total',
  help: 'Total number of idempotency cache hits (duplicate requests prevented)',
  registers: [register],
});

export const idempotencyMisses = new promClient.Counter({
  name: 'twitter_idempotency_cache_misses_total',
  help: 'Total number of idempotency cache misses (new requests)',
  registers: [register],
});

/**
 * Express middleware for HTTP metrics
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path;
    const labels = {
      method: req.method,
      route: route,
      status_code: res.statusCode.toString(),
    };

    httpRequestDuration.observe(labels, duration);
    httpRequestsTotal.inc(labels);
  });

  next();
}

/**
 * Get metrics in Prometheus format
 */
export async function getMetrics(): Promise<string> {
  return register.metrics();
}

/**
 * Get content type for metrics
 */
export function getMetricsContentType(): string {
  return register.contentType;
}

/**
 * Helper to categorize follower count for metrics buckets
 */
export function getFollowerCountBucket(count: number): string {
  if (count < 100) return '<100';
  if (count < 1000) return '100-1000';
  if (count < 10000) return '1000-10000';
  return '>10000';
}

logger.info('Prometheus metrics initialized');

export { register };
