import client from 'prom-client';

const register = new client.Registry();
client.collectDefaultMetrics({ register });

/** Histogram tracking HTTP request duration by method, route, and status code. */
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

/** Counter tracking total HTTP requests by method, route, and status code. */
export const httpRequestTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

/** Histogram tracking database query duration by query type. */
export const dbQueryDuration = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['query_type'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10],
  registers: [register],
});

/** Gauge tracking the current number of active (non-closed) opportunities. */
export const activeOpportunities = new client.Gauge({
  name: 'active_opportunities_total',
  help: 'Total number of active opportunities',
  registers: [register],
});

export { register };
