import pino from 'pino';
import type { Logger } from 'pino';
import dotenv from 'dotenv';
import type { Request, Response, NextFunction } from 'express';

dotenv.config();

const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * Structured JSON logger for Reddit clone.
 *
 * Why structured logging:
 * - Enables filtering and aggregation in log management systems
 * - Consistent format across all services
 * - Machine-parseable for alerting and metrics extraction
 */
export const logger: Logger = pino({
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  formatters: {
    level: (label: string) => ({ level: label }),
    bindings: () => ({}), // Remove pid and hostname in development
  },
  base: {
    service: process.env.SERVICE_NAME || 'reddit-api',
    version: process.env.npm_package_version || '1.0.0',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Pretty print in development, JSON in production
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname,service,version',
        },
      }
    : undefined,
});

// Extended request interface with user and log properties
export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    username: string;
    email: string;
    karma_post: number;
    karma_comment: number;
    role: string;
    created_at: Date;
  } | null;
  log?: Logger;
}

/**
 * Create a child logger with request context.
 * Useful for tracing requests across log entries.
 */
export const createRequestLogger = (req: AuthenticatedRequest): Logger => {
  return logger.child({
    requestId: req.headers['x-request-id'] || `req-${Date.now()}`,
    method: req.method,
    path: req.path,
    userId: req.user?.id,
  });
};

/**
 * Middleware to attach logger to request object.
 */
export const requestLoggerMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  req.log = createRequestLogger(req);

  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel: 'error' | 'warn' | 'info' = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    req.log?.[logLevel]({
      statusCode: res.statusCode,
      durationMs: duration,
      contentLength: res.get('content-length'),
    }, `${req.method} ${req.path} ${res.statusCode}`);
  });

  next();
};

export default logger;
