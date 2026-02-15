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

export const queryExecutionDuration = new client.Histogram({
  name: 'query_execution_duration_seconds',
  help: 'Duration of query executions in seconds',
  labelNames: ['data_source_type'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10],
  registers: [register],
});

export const activeApps = new client.Gauge({
  name: 'active_apps_total',
  help: 'Total number of active apps',
  registers: [register],
});

export { register };
