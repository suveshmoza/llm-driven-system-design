import pino, { Logger } from 'pino';
import { Request, Response, NextFunction } from 'express';

// Extend Express Request to include logger and id
declare global {
  namespace Express {
    interface Request {
      id?: string;
      log?: Logger;
    }
  }
}

// Environment-aware logger configuration
const isDevelopment = process.env.NODE_ENV !== 'production';

// Create base logger with structured formatting
export const logger: Logger = pino({
  level: process.env.LOG_LEVEL || 'info',

  // Use pretty printing in development for readability
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
    service: process.env.SERVICE_NAME || 'notification-system',
    env: process.env.NODE_ENV || 'development',
  },

  // Customize serializers for common objects
  serializers: {
    err: pino.stdSerializers.err,
    req: (req: Request) => ({
      method: req.method,
      url: req.url,
      userId: req.user?.id,
    }),
    res: (res: Response) => ({
      statusCode: res.statusCode,
    }),
  },

  // Redact sensitive fields
  redact: {
    paths: ['req.headers.authorization', 'password', 'token', 'secret'],
    censor: '[REDACTED]',
  },
});

// Create child loggers for specific components
export function createLogger(component: string): Logger {
  return logger.child({ component });
}

// Express request logging middleware
export function requestLogger(): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();
    const reqId = (req.headers['x-request-id'] as string) || crypto.randomUUID();

    // Attach request ID and logger to request
    req.id = reqId;
    req.log = logger.child({ reqId });

    // Log request start
    req.log.info({ req }, 'request started');

    // Log response when finished
    res.on('finish', () => {
      const duration = Date.now() - start;
      req.log?.info(
        { res, duration },
        `request completed in ${duration}ms`
      );
    });

    next();
  };
}

// Structured error logging helper
export function logError(log: Logger, error: Error, context: Record<string, unknown> = {}): void {
  log.error({
    err: error,
    ...context,
  }, error.message);
}

// Performance logging helper for async operations
export async function withTiming<T>(
  log: Logger,
  operationName: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    log.info({ operation: operationName, duration }, `${operationName} completed`);
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    log.error({ operation: operationName, duration, err: error }, `${operationName} failed`);
    throw error;
  }
}

export default logger;
