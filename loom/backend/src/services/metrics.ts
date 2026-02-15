import client from 'prom-client';

const register = new client.Registry();
client.collectDefaultMetrics({ register });

/** HTTP request duration histogram (latency percentiles). */
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

/** HTTP request counter for rate calculation. */
export const httpRequestTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

/** Video upload duration histogram by status. */
export const videoUploadDuration = new client.Histogram({
  name: 'video_upload_duration_seconds',
  help: 'Duration of video upload operations in seconds',
  labelNames: ['status'],
  buckets: [0.5, 1, 5, 10, 30, 60],
  registers: [register],
});

/** Gauge tracking the number of currently active video viewers. */
export const activeViewers = new client.Gauge({
  name: 'active_viewers_total',
  help: 'Total number of active video viewers',
  registers: [register],
});

export { register };
