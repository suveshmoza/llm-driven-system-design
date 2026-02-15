import client from 'prom-client';

const register = new client.Registry();
client.collectDefaultMetrics({ register });

/** Histogram tracking HTTP request duration in seconds by method, route, and status. */
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

/** Counter for total HTTP requests by method, route, and status code. */
export const httpRequestTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

/** Histogram tracking P2P transfer execution duration in seconds. */
export const transferDuration = new client.Histogram({
  name: 'transfer_duration_seconds',
  help: 'Duration of P2P transfers in seconds',
  labelNames: ['status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

/** Counter for total P2P transfers by completion status. */
export const transferTotal = new client.Counter({
  name: 'transfers_total',
  help: 'Total number of P2P transfers',
  labelNames: ['status'],
  registers: [register],
});

/** Counter for wallet operations (deposit, withdrawal, transfer). */
export const walletOperations = new client.Counter({
  name: 'wallet_operations_total',
  help: 'Total number of wallet operations',
  labelNames: ['type'],
  registers: [register],
});

/** Counter for idempotency cache hits preventing duplicate operations. */
export const idempotencyHits = new client.Counter({
  name: 'idempotency_cache_hits_total',
  help: 'Number of idempotency key cache hits',
  registers: [register],
});

export { register };
