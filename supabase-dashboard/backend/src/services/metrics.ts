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

/** Histogram tracking SQL query execution duration by project and query type. */
export const queryExecutionDuration = new client.Histogram({
  name: 'query_execution_duration_seconds',
  help: 'Duration of SQL query executions in seconds',
  labelNames: ['project_id', 'query_type'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10],
  registers: [register],
});

/** Gauge tracking the number of active target database connection pools. */
export const activeConnections = new client.Gauge({
  name: 'active_target_connections',
  help: 'Number of active target database connection pools',
  registers: [register],
});

export { register };
