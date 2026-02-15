import client from 'prom-client';

// Create a Registry to register metrics
const register = new client.Registry();

// Add default metrics (CPU, memory, event loop, etc.)
client.collectDefaultMetrics({ register });

// HTTP Request duration histogram
/** Histogram tracking HTTP request latency by method, route, and status code. */
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// HTTP Request counter
/** Counter tracking total HTTP requests by method, route, and status code. */
export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// Playback events counter
/** Counter tracking total playback events by event type and device. */
export const playbackEventsTotal = new client.Counter({
  name: 'playback_events_total',
  help: 'Total playback events',
  labelNames: ['event_type', 'device_type'],
  registers: [register],
});

// Stream count counter
/** Counter tracking total stream counts for royalty calculation. */
export const streamCountsTotal = new client.Counter({
  name: 'stream_counts_total',
  help: 'Total stream counts (for royalty tracking)',
  registers: [register],
});

// Active streams gauge
/** Gauge tracking the number of currently active audio streams. */
export const activeStreams = new client.Gauge({
  name: 'active_streams',
  help: 'Number of currently active streams',
  registers: [register],
});

// Search operations counter
/** Counter tracking total search operations by result type. */
export const searchOperationsTotal = new client.Counter({
  name: 'search_operations_total',
  help: 'Total search operations',
  labelNames: ['type'],
  registers: [register],
});

// Playlist operations counter
/** Counter tracking playlist mutations (create, update, add/remove track). */
export const playlistOperationsTotal = new client.Counter({
  name: 'playlist_operations_total',
  help: 'Total playlist operations',
  labelNames: ['operation'],
  registers: [register],
});

// Recommendation latency histogram
/** Histogram tracking recommendation generation time by algorithm type. */
export const recommendationLatency = new client.Histogram({
  name: 'recommendation_generation_seconds',
  help: 'Time to generate recommendations',
  labelNames: ['algorithm'],
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [register],
});

// Cache hit/miss counters
/** Counter tracking cache hits by cache type (playback state, catalog, etc.). */
export const cacheHitsTotal = new client.Counter({
  name: 'cache_hits_total',
  help: 'Total cache hits',
  labelNames: ['cache_type'],
  registers: [register],
});

/** Counter tracking cache misses by cache type. */
export const cacheMissesTotal = new client.Counter({
  name: 'cache_misses_total',
  help: 'Total cache misses',
  labelNames: ['cache_type'],
  registers: [register],
});

// Rate limit counter
/** Counter tracking rate limit enforcement events by endpoint and scope. */
export const rateLimitHitsTotal = new client.Counter({
  name: 'rate_limit_hits_total',
  help: 'Total rate limit hits',
  labelNames: ['endpoint', 'scope'],
  registers: [register],
});

// Auth events counter
/** Counter tracking authentication events (login, register) by success/failure. */
export const authEventsTotal = new client.Counter({
  name: 'auth_events_total',
  help: 'Total authentication events',
  labelNames: ['event', 'success'],
  registers: [register],
});

// Idempotency deduplication counter
/** Counter tracking requests deduplicated by idempotency key. */
export const idempotencyDeduplicationsTotal = new client.Counter({
  name: 'idempotency_deduplications_total',
  help: 'Total requests deduplicated by idempotency key',
  labelNames: ['operation'],
  registers: [register],
});

// Database connection pool metrics
/** Gauge tracking database connection pool size by state (total, idle, waiting). */
export const dbPoolConnections = new client.Gauge({
  name: 'db_pool_connections',
  help: 'Database connection pool metrics',
  labelNames: ['state'],
  registers: [register],
});

import { Request, Response, NextFunction } from 'express';

// Express middleware for metrics collection
/** Middleware that records HTTP request duration and count for each response. */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path || 'unknown';

    httpRequestDuration.observe(
      {
        method: req.method,
        route: route,
        status_code: res.statusCode,
      },
      duration
    );

    httpRequestsTotal.inc({
      method: req.method,
      route: route,
      status_code: res.statusCode,
    });
  });

  next();
}

// Metrics endpoint handler
/** Serves Prometheus-formatted metrics from the registry. */
export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.set('Content-Type', register.contentType);
  res.send(await register.metrics());
}

export { register };
export default {
  register,
  httpRequestDuration,
  httpRequestsTotal,
  playbackEventsTotal,
  streamCountsTotal,
  activeStreams,
  searchOperationsTotal,
  playlistOperationsTotal,
  recommendationLatency,
  cacheHitsTotal,
  cacheMissesTotal,
  rateLimitHitsTotal,
  authEventsTotal,
  idempotencyDeduplicationsTotal,
  dbPoolConnections,
  metricsMiddleware,
  metricsHandler,
};
