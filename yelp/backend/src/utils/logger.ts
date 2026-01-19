import pino, { Logger, Bindings } from 'pino';
import type { Request, Response } from 'express';

/**
 * Structured JSON logging with pino
 *
 * Log levels:
 * - error: Failures requiring attention (5xx, unhandled exceptions)
 * - warn: Degraded behavior (retries, cache misses, rate limits)
 * - info: Request/response, major state changes
 * - debug: Detailed debugging (disabled in production)
 */

const isProduction = process.env.NODE_ENV === 'production';

// Extended request interface with custom properties
interface ExtendedRequest extends Request {
  user?: {
    id: string;
    role: string;
    [key: string]: unknown;
  };
  requestId?: string;
}

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),

  // Format options
  formatters: {
    level: (label: string) => ({ level: label }),
    bindings: (bindings: Bindings) => ({
      service: 'yelp-api',
      pid: bindings.pid,
      hostname: bindings.hostname,
    }),
  },

  // Timestamp format
  timestamp: pino.stdTimeFunctions.isoTime,

  // Redact sensitive fields from logs
  redact: {
    paths: [
      'password',
      'password_hash',
      'authorization',
      'cookie',
      'session_token',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },

  // Base context included in all logs
  base: {
    service: 'yelp-api',
    version: process.env.npm_package_version || '1.0.0',
  },

  // Pretty print in development
  ...(isProduction
    ? {}
    : {
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

/**
 * Create a child logger with request context
 */
export function createRequestLogger(
  context: Record<string, unknown> = {}
): Logger {
  return logger.child(context);
}

/**
 * Log HTTP request with standard fields
 */
export function logRequest(
  req: ExtendedRequest,
  res: Response,
  duration: number,
  extra: Record<string, unknown> = {}
): void {
  const logData: Record<string, unknown> = {
    method: req.method,
    path: req.path,
    status: res.statusCode,
    duration_ms: duration,
    ip: req.ip || req.socket?.remoteAddress,
    userAgent: req.get('user-agent'),
    ...extra,
  };

  if (req.user) {
    logData.userId = req.user.id;
    logData.userRole = req.user.role;
  }

  if (req.requestId) {
    logData.requestId = req.requestId;
  }

  if (res.statusCode >= 500) {
    logger.error(logData, 'Request failed');
  } else if (res.statusCode >= 400) {
    logger.warn(logData, 'Request error');
  } else {
    logger.info(logData, 'Request completed');
  }
}

/**
 * Log database operation
 */
export function logDbOperation(
  operation: string,
  table: string,
  duration: number,
  extra: Record<string, unknown> = {}
): void {
  logger.debug(
    {
      component: 'database',
      operation,
      table,
      duration_ms: duration,
      ...extra,
    },
    'Database operation'
  );
}

/**
 * Log cache operation
 */
export function logCacheOperation(
  operation: string,
  key: string,
  hit: boolean,
  extra: Record<string, unknown> = {}
): void {
  logger.debug(
    {
      component: 'cache',
      operation,
      key,
      hit,
      ...extra,
    },
    `Cache ${operation}`
  );
}

/**
 * Log search operation
 */
export function logSearch(
  query: string | undefined,
  resultCount: number,
  duration: number,
  extra: Record<string, unknown> = {}
): void {
  logger.info(
    {
      component: 'search',
      query,
      resultCount,
      duration_ms: duration,
      ...extra,
    },
    'Search executed'
  );
}

/**
 * Log circuit breaker events
 */
export function logCircuitBreaker(
  name: string,
  state: 'OPEN' | 'CLOSED' | 'HALF_OPEN',
  extra: Record<string, unknown> = {}
): void {
  const logLevel: 'warn' | 'info' = state === 'OPEN' ? 'warn' : 'info';
  logger[logLevel](
    {
      component: 'circuit_breaker',
      name,
      state,
      ...extra,
    },
    `Circuit breaker ${name} is ${state}`
  );
}

export default logger;
