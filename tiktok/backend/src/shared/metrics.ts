import client, { Counter, Histogram, Gauge, Registry } from 'prom-client';
import { Request, Response, NextFunction } from 'express';
import { createLogger } from './logger.js';

const logger = createLogger('metrics');

// Create a Registry for metrics
const register = new Registry();

// Add default metrics (CPU, memory, event loop lag, etc.)
client.collectDefaultMetrics({ register });

// Custom metrics for TikTok-specific operations

// Video views counter
export const videoViewsCounter: Counter = new Counter({
  name: 'tiktok_video_views_total',
  help: 'Total number of video views',
  labelNames: ['source'] as const, // fyp, following, hashtag, search
  registers: [register],
});

// Video likes counter
export const videoLikesCounter: Counter = new Counter({
  name: 'tiktok_video_likes_total',
  help: 'Total number of video likes',
  registers: [register],
});

// Video shares counter
export const videoSharesCounter: Counter = new Counter({
  name: 'tiktok_video_shares_total',
  help: 'Total number of video shares',
  registers: [register],
});

// Video uploads counter
export const videoUploadsCounter: Counter = new Counter({
  name: 'tiktok_video_uploads_total',
  help: 'Total number of video uploads',
  labelNames: ['status'] as const, // success, failure
  registers: [register],
});

// For You Page (FYP) latency histogram
export const fypLatencyHistogram: Histogram = new Histogram({
  name: 'tiktok_fyp_latency_seconds',
  help: 'For You Page recommendation latency in seconds',
  labelNames: ['user_type'] as const, // authenticated, anonymous
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// Recommendation service latency
export const recommendationLatencyHistogram: Histogram = new Histogram({
  name: 'tiktok_recommendation_latency_seconds',
  help: 'Recommendation service latency in seconds',
  labelNames: ['phase'] as const, // candidate_generation, ranking
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// Video processing latency
export const videoProcessingLatencyHistogram: Histogram = new Histogram({
  name: 'tiktok_video_processing_latency_seconds',
  help: 'Video processing (transcoding) latency in seconds',
  labelNames: ['resolution'] as const,
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [register],
});

// HTTP request duration histogram
export const httpRequestDurationHistogram: Histogram = new Histogram({
  name: 'tiktok_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// Active sessions gauge
export const activeSessionsGauge: Gauge = new Gauge({
  name: 'tiktok_active_sessions',
  help: 'Number of active user sessions',
  registers: [register],
});

// Circuit breaker state gauge
export const circuitBreakerStateGauge: Gauge = new Gauge({
  name: 'tiktok_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
  labelNames: ['service'] as const,
  registers: [register],
});

// Rate limit hits counter
export const rateLimitHitsCounter: Counter = new Counter({
  name: 'tiktok_rate_limit_hits_total',
  help: 'Total number of rate limit hits',
  labelNames: ['endpoint', 'user_type'] as const,
  registers: [register],
});

// Database query duration histogram
export const dbQueryDurationHistogram: Histogram = new Histogram({
  name: 'tiktok_db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation'] as const, // select, insert, update, delete
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

// Redis operation duration histogram
export const redisOperationDurationHistogram: Histogram = new Histogram({
  name: 'tiktok_redis_operation_duration_seconds',
  help: 'Redis operation duration in seconds',
  labelNames: ['operation'] as const,
  buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1],
  registers: [register],
});

// Storage operation duration histogram
export const storageOperationDurationHistogram: Histogram = new Histogram({
  name: 'tiktok_storage_operation_duration_seconds',
  help: 'Object storage operation duration in seconds',
  labelNames: ['operation'] as const, // upload, download, delete
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
  registers: [register],
});

// Middleware to track HTTP request duration
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationSeconds = Number(end - start) / 1e9;

    // Extract route pattern (e.g., /api/videos/:id instead of /api/videos/123)
    const route = req.route?.path || req.path || 'unknown';
    const baseRoute = req.baseUrl + route;

    httpRequestDurationHistogram
      .labels(req.method, baseRoute, res.statusCode.toString())
      .observe(durationSeconds);
  });

  next();
};

// Get metrics for /metrics endpoint
export const getMetrics = async (): Promise<string> => {
  return await register.metrics();
};

// Get content type for /metrics endpoint
export const getContentType = (): string => {
  return register.contentType;
};

// Helper to time async operations
export const timeAsync = async <T>(
  histogram: Histogram,
  labels: Record<string, string>,
  fn: () => Promise<T>
): Promise<T> => {
  const start = process.hrtime.bigint();
  try {
    return await fn();
  } finally {
    const end = process.hrtime.bigint();
    const durationSeconds = Number(end - start) / 1e9;
    histogram.labels(labels).observe(durationSeconds);
  }
};

logger.info('Prometheus metrics initialized');

export default register;
