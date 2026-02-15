import client, { Registry, Histogram, Counter, Gauge } from 'prom-client';
import type { Request, Response, NextFunction } from 'express';
import config from '../config/index.js';

const register = new Registry();

client.collectDefaultMetrics({
  register,
  prefix: 'excalidraw_',
  labels: { service: 'api', port: String(config.port) },
});

export const httpRequestDuration: Histogram<string> = new client.Histogram({
  name: 'excalidraw_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const httpRequestsTotal: Counter<string> = new client.Counter({
  name: 'excalidraw_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

export const drawingsCreatedTotal: Counter<string> = new client.Counter({
  name: 'excalidraw_drawings_created_total',
  help: 'Total number of drawings created',
  registers: [register],
});

export const drawingsDeletedTotal: Counter<string> = new client.Counter({
  name: 'excalidraw_drawings_deleted_total',
  help: 'Total number of drawings deleted',
  registers: [register],
});

export const wsConnectionsActive: Gauge<string> = new client.Gauge({
  name: 'excalidraw_ws_connections_active',
  help: 'Number of active WebSocket connections',
  registers: [register],
});

export const wsMessagesTotal: Counter<string> = new client.Counter({
  name: 'excalidraw_ws_messages_total',
  help: 'Total WebSocket messages processed',
  labelNames: ['type'] as const,
  registers: [register],
});

export const activeSessions: Gauge<string> = new client.Gauge({
  name: 'excalidraw_active_sessions',
  help: 'Number of active user sessions',
  registers: [register],
});

export const authAttempts: Counter<string> = new client.Counter({
  name: 'excalidraw_auth_attempts_total',
  help: 'Total number of authentication attempts',
  labelNames: ['type', 'result'] as const,
  registers: [register],
});

export const rateLimitHits: Counter<string> = new client.Counter({
  name: 'excalidraw_rate_limit_hits_total',
  help: 'Total number of rate limit hits',
  labelNames: ['action'] as const,
  registers: [register],
});

export const circuitBreakerState: Gauge<string> = new client.Gauge({
  name: 'excalidraw_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
  labelNames: ['name'] as const,
  registers: [register],
});

export const circuitBreakerEvents: Counter<string> = new client.Counter({
  name: 'excalidraw_circuit_breaker_events_total',
  help: 'Total circuit breaker events',
  labelNames: ['name', 'event'] as const,
  registers: [register],
});

export const dbQueryDuration: Histogram<string> = new client.Histogram({
  name: 'excalidraw_db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

export { register };

interface ExtendedRequest extends Omit<Request, 'route'> {
  route?: { path?: string };
}

export const metricsMiddleware = (req: ExtendedRequest, res: Response, next: NextFunction): void => {
  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1e9;
    const route = req.route?.path || req.path || 'unknown';

    httpRequestDuration.labels(req.method, route, String(res.statusCode)).observe(duration);
    httpRequestsTotal.labels(req.method, route, String(res.statusCode)).inc();
  });

  next();
};

export const timedOperation = async <T>(
  histogram: Histogram<string>,
  labels: Record<string, string> | string,
  fn: () => Promise<T>
): Promise<T> => {
  const startTime = process.hrtime.bigint();
  try {
    return await fn();
  } finally {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1e9;
    if (typeof labels === 'object') {
      histogram.labels(labels).observe(duration);
    } else {
      histogram.observe(duration);
    }
  }
};

export default register;
