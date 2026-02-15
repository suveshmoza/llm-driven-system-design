import promClient from 'prom-client';

// Create a registry
export const register = new promClient.Registry();

// Collect default metrics
promClient.collectDefaultMetrics({ register });

// HTTP request metrics
export const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// Pin metrics
export const pinsCreatedTotal = new promClient.Counter({
  name: 'pins_created_total',
  help: 'Total number of pins created',
  registers: [register],
});

export const pinSavesTotal = new promClient.Counter({
  name: 'pin_saves_total',
  help: 'Total number of pin saves',
  registers: [register],
});

// Image processing metrics
export const imageProcessingDuration = new promClient.Histogram({
  name: 'image_processing_duration_seconds',
  help: 'Duration of image processing in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

export const imageProcessingErrors = new promClient.Counter({
  name: 'image_processing_errors_total',
  help: 'Total number of image processing errors',
  registers: [register],
});

// Feed metrics
export const feedGenerationDuration = new promClient.Histogram({
  name: 'feed_generation_duration_seconds',
  help: 'Duration of feed generation in seconds',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

export const feedCacheHits = new promClient.Counter({
  name: 'feed_cache_hits_total',
  help: 'Total feed cache hits',
  registers: [register],
});

export const feedCacheMisses = new promClient.Counter({
  name: 'feed_cache_misses_total',
  help: 'Total feed cache misses',
  registers: [register],
});

// Auth metrics
export const authAttempts = new promClient.Counter({
  name: 'auth_attempts_total',
  help: 'Total authentication attempts',
  labelNames: ['type', 'result'],
  registers: [register],
});

// Middleware to track HTTP metrics
/** Express middleware that records HTTP request duration and total counts per route. */
export function metricsMiddleware(
  req: { method: string; route?: { path?: string }; path: string },
  res: { statusCode: number; on: (event: string, cb: () => void) => void },
  next: () => void,
) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path || 'unknown';
    httpRequestDuration.labels(req.method, route, String(res.statusCode)).observe(duration);
    httpRequestsTotal.labels(req.method, route, String(res.statusCode)).inc();
  });
  next();
}
