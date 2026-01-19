import pino, { Logger } from 'pino';
import { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';

dotenv.config();

const isDevelopment = process.env.NODE_ENV !== 'production';

// Extend Express Request to include custom properties
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      log?: Logger;
    }
  }
}

// Error with additional properties
interface ExtendedError extends Error {
  code?: string;
}

// Create structured JSON logger with pino
// In production: JSON logs for machine parsing (ELK, Splunk, etc.)
// In development: Pretty-printed logs for readability
const logger: Logger = pino({
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  // Standard fields for all log entries
  base: {
    service: 'tiktok-api',
    version: process.env.npm_package_version || '1.0.0',
    env: process.env.NODE_ENV || 'development',
  },
  // Redact sensitive fields
  redact: ['req.headers.authorization', 'req.headers.cookie', 'password', 'passwordHash'],
});

// Create child logger for specific components
export const createLogger = (component: string): Logger => {
  return logger.child({ component });
};

// Request logging middleware
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();

  // Attach request ID to request object
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  // Create request-scoped logger
  req.log = logger.child({
    requestId,
    method: req.method,
    url: req.url,
    userAgent: req.headers['user-agent'],
    ip: req.ip || req.socket?.remoteAddress,
  });

  // Log request start
  req.log.info({ type: 'request_start' }, 'Incoming request');

  // Log response on finish
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logData = {
      type: 'request_complete',
      statusCode: res.statusCode,
      durationMs: duration,
      userId: req.session?.userId,
    };

    if (res.statusCode >= 500) {
      req.log?.error(logData, 'Request failed with server error');
    } else if (res.statusCode >= 400) {
      req.log?.warn(logData, 'Request failed with client error');
    } else {
      req.log?.info(logData, 'Request completed');
    }
  });

  next();
};

// Error logging helper
export const logError = (error: ExtendedError, context: Record<string, unknown> = {}): void => {
  logger.error({
    err: {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
    },
    ...context,
  }, 'Error occurred');
};

// Audit log for sensitive operations
export const auditLog = (
  action: string,
  userId: string | number | null,
  details: Record<string, unknown> = {}
): void => {
  logger.info({
    type: 'audit',
    action,
    userId,
    timestamp: new Date().toISOString(),
    ...details,
  }, `Audit: ${action}`);
};

export default logger;
