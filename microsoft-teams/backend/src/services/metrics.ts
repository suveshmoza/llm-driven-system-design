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

/** Counter tracking total messages sent per channel. */
export const messagesTotal = new client.Counter({
  name: 'messages_total',
  help: 'Total number of messages sent',
  labelNames: ['channel_id'],
  registers: [register],
});

/** Gauge tracking the number of active SSE connections. */
export const sseConnectionsGauge = new client.Gauge({
  name: 'sse_connections_active',
  help: 'Number of active SSE connections',
  registers: [register],
});

/** Counter tracking total presence heartbeat updates. */
export const presenceUpdatesTotal = new client.Counter({
  name: 'presence_updates_total',
  help: 'Total number of presence heartbeats',
  registers: [register],
});

export { register };
