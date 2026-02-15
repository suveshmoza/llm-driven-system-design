import client from 'prom-client';

const register = new client.Registry();

client.collectDefaultMetrics({ register });

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

export const httpRequestTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const pageOperations = new client.Counter({
  name: 'page_operations_total',
  help: 'Total page operations',
  labelNames: ['operation'],
  registers: [register],
});

export const searchLatency = new client.Histogram({
  name: 'search_latency_seconds',
  help: 'Search query latency in seconds',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

export { register };
