import client, { Registry, Histogram, Counter, Gauge } from 'prom-client';
import type { Request, Response, NextFunction } from 'express';
import config from '../config/index.js';

const register = new Registry();

client.collectDefaultMetrics({
  register,
  prefix: 'gmail_',
  labels: { service: 'api', port: String(config.port) },
});

export const httpRequestDuration: Histogram<string> = new client.Histogram({
  name: 'gmail_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const httpRequestsTotal: Counter<string> = new client.Counter({
  name: 'gmail_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

export const emailsSentTotal: Counter<string> = new client.Counter({
  name: 'gmail_emails_sent_total',
  help: 'Total number of emails sent',
  registers: [register],
});

export const emailsReceivedTotal: Counter<string> = new client.Counter({
  name: 'gmail_emails_received_total',
  help: 'Total number of emails received',
  registers: [register],
});

export const searchQueriesTotal: Counter<string> = new client.Counter({
  name: 'gmail_search_queries_total',
  help: 'Total number of search queries',
  registers: [register],
});

export const searchDuration: Histogram<string> = new client.Histogram({
  name: 'gmail_search_duration_seconds',
  help: 'Duration of search queries in seconds',
  labelNames: ['type'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

export const draftConflictsTotal: Counter<string> = new client.Counter({
  name: 'gmail_draft_conflicts_total',
  help: 'Total number of draft version conflicts',
  registers: [register],
});

export const authAttempts: Counter<string> = new client.Counter({
  name: 'gmail_auth_attempts_total',
  help: 'Total number of authentication attempts',
  labelNames: ['type', 'result'] as const,
  registers: [register],
});

export const rateLimitHits: Counter<string> = new client.Counter({
  name: 'gmail_rate_limit_hits_total',
  help: 'Total number of rate limit hits',
  labelNames: ['action'] as const,
  registers: [register],
});

export const circuitBreakerState: Gauge<string> = new client.Gauge({
  name: 'gmail_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
  labelNames: ['name'] as const,
  registers: [register],
});

export const circuitBreakerEvents: Counter<string> = new client.Counter({
  name: 'gmail_circuit_breaker_events_total',
  help: 'Total circuit breaker events',
  labelNames: ['name', 'event'] as const,
  registers: [register],
});

export const dbQueryDuration: Histogram<string> = new client.Histogram({
  name: 'gmail_db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

export const dbConnectionPoolSize: Gauge<string> = new client.Gauge({
  name: 'gmail_db_connection_pool_size',
  help: 'Current database connection pool size',
  labelNames: ['state'] as const,
  registers: [register],
});

export const indexedMessagesTotal: Counter<string> = new client.Counter({
  name: 'gmail_indexed_messages_total',
  help: 'Total number of messages indexed in Elasticsearch',
  registers: [register],
});

export { register };

interface ExtendedRequest extends Omit<Request, 'route'> {
  route?: { path?: string };
}

export const metricsMiddleware = (
  req: ExtendedRequest,
  res: Response,
  next: NextFunction
): void => {
  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1e9;

    const route = req.route?.path || req.path || 'unknown';

    httpRequestDuration
      .labels(req.method, route, String(res.statusCode))
      .observe(duration);

    httpRequestsTotal
      .labels(req.method, route, String(res.statusCode))
      .inc();
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
