import pino, { Logger } from 'pino';
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const logger: Logger = pino({
  level,
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: 'imessage-backend',
    pid: process.pid,
    env: process.env.NODE_ENV || 'development',
  },
  ...(process.env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname,service,env',
      },
    },
  }),
});

// Create child loggers for different contexts
export function createLogger(context: string): Logger {
  return logger.child({ context });
}

// Extended request type with log property
export interface LoggedRequest extends Request {
  log: Logger;
  requestId: string;
  user?: { id: string; [key: string]: unknown };
  deviceId?: string;
  session?: unknown;
  idempotencyKey?: string | null;
}

// Request logging middleware
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();

  const loggedReq = req as LoggedRequest;
  loggedReq.log = logger.child({
    requestId,
    method: req.method,
    url: req.url,
  });

  loggedReq.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    loggedReq.log[logLevel]({
      statusCode: res.statusCode,
      durationMs: duration,
      contentLength: res.get('content-length'),
    }, 'request completed');
  });

  next();
}

export default logger;
