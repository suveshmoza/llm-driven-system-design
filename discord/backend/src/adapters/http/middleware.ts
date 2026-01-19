/**
 * HTTP Middleware
 *
 * Provides Express middleware for request logging and connection draining.
 */

import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import express from 'express';
import type { ApiResponse } from '../../types/index.js';
import { createRequestLogger, generateRequestId } from '../../utils/logger.js';
import type { RequestWithId, SSEManager } from './types.js';

/**
 * Create CORS middleware
 */
export function createCorsMiddleware() {
  return cors();
}

/**
 * Create JSON body parser middleware
 */
export function createJsonMiddleware() {
  return express.json();
}

/**
 * Create request logging middleware with request ID generation
 */
export function createRequestLoggingMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = generateRequestId();
    (req as Request & RequestWithId).requestId = requestId;
    const reqLogger = createRequestLogger(req.method, req.path, requestId);
    reqLogger.debug({ body: req.body }, 'Incoming request');
    next();
  };
}

/**
 * Create connection draining middleware for graceful shutdown
 *
 * @param sseManager - Manager containing draining state
 */
export function createDrainingMiddleware(sseManager: SSEManager) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (sseManager.isDraining) {
      res.setHeader('Connection', 'close');
      // Allow health/metrics endpoints during drain
      if (!req.path.startsWith('/health') && !req.path.startsWith('/metrics')) {
        res.status(503).json({
          success: false,
          error: 'Server is shutting down',
        } as ApiResponse);
        return;
      }
    }
    next();
  };
}

/**
 * Apply all standard middleware to an Express app
 *
 * @param app - Express application
 * @param sseManager - Manager containing draining state
 */
export function applyMiddleware(
  app: express.Application,
  sseManager: SSEManager
): void {
  app.use(createCorsMiddleware());
  app.use(createJsonMiddleware());
  app.use(createRequestLoggingMiddleware());
  app.use(createDrainingMiddleware(sseManager));
}
