import client from 'prom-client';

const register = new client.Registry();

register.setDefaultLabels({ app: 'zoom-backend' });
client.collectDefaultMetrics({ register });

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

export const activeMeetings = new client.Gauge({
  name: 'active_meetings_total',
  help: 'Number of currently active meetings',
  registers: [register],
});

export const activeParticipants = new client.Gauge({
  name: 'active_participants_total',
  help: 'Number of currently active participants',
  registers: [register],
});

export const wsConnections = new client.Gauge({
  name: 'websocket_connections_total',
  help: 'Number of active WebSocket connections',
  registers: [register],
});

export const metricsRegistry = register;
