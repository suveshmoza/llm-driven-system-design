import pino, { Logger } from 'pino';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types.js';

// Create base logger with structured JSON output
export const logger: Logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  base: {
    service: 'spotify-api',
    version: process.env.APP_VERSION || 'dev',
    pid: process.pid,
  },
  // Pretty print in development
  ...(process.env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  }),
});

// Request logging middleware
export function requestLogger(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  const startTime = Date.now();

  // Attach child logger and requestId to request
  req.requestId = requestId;
  req.log = logger.child({
    requestId,
    userId: req.session?.userId,
  });

  // Log request start
  req.log.info(
    {
      method: req.method,
      path: req.path,
      query: req.query,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    },
    'request started'
  );

  // Set request ID header on response
  res.setHeader('X-Request-Id', requestId);

  // Log on response finish
  res.on('finish', () => {
    const durationMs = Date.now() - startTime;

    const logData = {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
    };

    if (res.statusCode >= 500) {
      req.log?.error(logData, 'request completed with server error');
    } else if (res.statusCode >= 400) {
      req.log?.warn(logData, 'request completed with client error');
    } else {
      req.log?.info(logData, 'request completed');
    }
  });

  next();
}

export default logger;
