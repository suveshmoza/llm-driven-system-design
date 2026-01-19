import type { Request, Response, NextFunction } from 'express';
import type { Logger } from 'pino';
import { generateId } from '../utils/index.js';
import { metricsService } from '../services/metrics.js';
import logger, { createRequestLogger } from '../services/logger.js';

interface RequestWithId extends Request {
  id: string;
  log: Logger;
}

/**
 * Request ID middleware - adds unique ID to each request for tracing
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const extReq = req as RequestWithId;
  extReq.id = (req.headers['x-request-id'] as string) || generateId();
  res.setHeader('X-Request-ID', extReq.id);
  // Attach a request-scoped logger
  extReq.log = createRequestLogger(extReq);
  next();
}

/**
 * Request logging middleware - logs requests and records metrics using pino
 *
 * WHY structured logging:
 * - Machine-parseable for log aggregation (ELK, Loki, CloudWatch)
 * - Consistent format across all services
 * - Enables filtering and alerting on specific fields
 * - Correlates requests via request IDs for distributed tracing
 */
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const extReq = req as RequestWithId;
  const start = Date.now();
  const log = extReq.log || logger.child({ requestId: extReq.id });

  // Log request start at debug level
  log.debug({ method: req.method, path: req.path }, 'Request started');

  res.on('finish', () => {
    const duration = Date.now() - start;

    // Record metrics
    metricsService.recordRequest({
      method: req.method,
      path: extReq.route?.path || req.path,
      status: res.statusCode,
      duration,
    });

    // Log with appropriate level based on status
    const forwardedFor = req.headers?.['x-forwarded-for'];
    const ip = typeof forwardedFor === 'string' ? forwardedFor.split(',')[0] : forwardedFor?.[0];
    const logData = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      ip: req.ip || ip,
    };

    if (res.statusCode >= 500) {
      log.error(logData, 'Request failed');
    } else if (res.statusCode >= 400) {
      log.warn(logData, 'Request error');
    } else if (duration > 1000) {
      log.warn({ ...logData, slow: true }, 'Slow request');
    } else {
      log.info(logData, 'Request completed');
    }
  });

  next();
}

/**
 * Error handler middleware
 */
export function errorHandlerMiddleware(
  err: Error & { isOperational?: boolean; statusCode?: number; retryAfter?: number },
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const extReq = req as RequestWithId;
  const log = extReq.log || logger.child({ requestId: extReq.id });

  // Record error metrics
  metricsService.recordError({
    method: req.method,
    path: req.path,
    error: err.name || 'Error',
  });

  // Log error with full context
  log.error({
    err,
    method: req.method,
    path: req.path,
    stack: err.stack,
  }, 'Error handling request');

  // Handle operational errors
  if (err.isOperational) {
    res.status(err.statusCode || 500).json({
      error: err.message,
      requestId: extReq.id,
      ...(err.retryAfter && { retryAfter: err.retryAfter }),
    });
    return;
  }

  // Handle validation errors
  if (err.name === 'ValidationError') {
    res.status(400).json({
      error: 'Validation failed',
      details: err.message,
      requestId: extReq.id,
    });
    return;
  }

  // Handle syntax errors (bad JSON)
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      error: 'Invalid JSON',
      requestId: extReq.id,
    });
    return;
  }

  // Generic server error
  res.status(500).json({
    error: 'Internal server error',
    requestId: extReq.id,
  });
}

/**
 * Not found handler middleware
 */
export function notFoundMiddleware(req: Request, res: Response): void {
  const extReq = req as RequestWithId;
  res.status(404).json({
    error: 'Not found',
    path: req.path,
    requestId: extReq.id,
  });
}

/**
 * CORS middleware configuration
 */
export function corsOptions(): {
  origin: boolean;
  credentials: boolean;
  methods: string[];
  allowedHeaders: string[];
  exposedHeaders: string[];
} {
  return {
    origin: true, // Allow all origins in development
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-API-Key'],
    exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  };
}
