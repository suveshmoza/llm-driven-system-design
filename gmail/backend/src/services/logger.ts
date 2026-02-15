import pino, { Logger } from 'pino';
import type { Request, Response } from 'express';
import type { Session, SessionData } from 'express-session';
import config from '../config/index.js';

export interface ExtendedRequest extends Omit<Request, 'session'> {
  traceId?: string;
  session: Session &
    Partial<SessionData> & {
      userId?: string;
      username?: string;
    };
}

const logger: Logger = pino({
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  base: {
    service: 'gmail-api',
    env: config.nodeEnv,
    port: config.port,
  },
  transport:
    config.nodeEnv !== 'production'
      ? {
          target: 'pino/file',
          options: { destination: 1 },
        }
      : undefined,
});

export const createRequestLogger = (req: ExtendedRequest): Logger => {
  return logger.child({
    requestId: req.traceId,
    method: req.method,
    path: req.path,
    userId: req.session?.userId,
    username: req.session?.username,
  });
};

export const logRequest = (
  req: ExtendedRequest,
  res: Response,
  duration: number
): void => {
  const level =
    res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

  logger[level](
    {
      requestId: req.traceId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: duration,
      userId: req.session?.userId,
      contentLength: res.get('content-length'),
      userAgent: req.get('user-agent'),
    },
    `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`
  );
};

export const logError = (
  error: Error,
  context: Record<string, unknown> = {}
): void => {
  logger.error(
    {
      error: error.name || 'Error',
      message: error.message,
      stack: error.stack,
      ...context,
    },
    error.message
  );
};

export const logQuery = (
  queryName: string,
  duration: number,
  context: Record<string, unknown> = {}
): void => {
  const level = duration > 1000 ? 'warn' : 'debug';
  logger[level](
    {
      type: 'db_query',
      query: queryName,
      durationMs: duration,
      ...context,
    },
    `DB: ${queryName} (${duration}ms)`
  );
};

export const logCache = (
  operation: string,
  key: string,
  hit: boolean | null = null
): void => {
  logger.debug(
    {
      type: 'cache',
      operation,
      key: key.substring(0, 50),
      hit,
    },
    `Cache ${operation}: ${key.substring(0, 50)}${hit !== null ? (hit ? ' HIT' : ' MISS') : ''}`
  );
};

export const logMetric = (
  event: string,
  data: Record<string, unknown> = {}
): void => {
  logger.info(
    {
      type: 'metric',
      event,
      ...data,
    },
    `Metric: ${event}`
  );
};

export { logger };
export default logger;
