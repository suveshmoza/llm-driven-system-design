/**
 * HTTP Middleware
 *
 * @description Provides Express middleware for request logging, CORS handling,
 * JSON parsing, and connection draining during graceful shutdown.
 * @module adapters/http/middleware
 */

import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import express from 'express';
import type { ApiResponse } from '../../types/index.js';
import { createRequestLogger, generateRequestId } from '../../utils/logger.js';
import type { RequestWithId, SSEManager } from './types.js';

/**
 * Creates CORS (Cross-Origin Resource Sharing) middleware.
 *
 * @description Enables cross-origin requests from any origin. This is necessary
 * for the browser frontend to communicate with the API when served from different ports.
 *
 * @returns {ReturnType<typeof cors>} Express middleware function for CORS handling
 */
export function createCorsMiddleware() {
  return cors();
}

/**
 * Creates JSON body parser middleware.
 *
 * @description Parses incoming requests with JSON payloads and makes the parsed
 * data available on req.body.
 *
 * @returns {ReturnType<typeof express.json>} Express middleware function for JSON parsing
 */
export function createJsonMiddleware() {
  return express.json();
}

/**
 * Creates request logging middleware with request ID generation.
 *
 * @description Generates a unique request ID for each incoming request and attaches
 * it to the request object for distributed tracing. Also logs the incoming request
 * details (method, path, body) at debug level.
 *
 * @returns {Function} Express middleware function that logs requests and adds request IDs
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
 * Creates connection draining middleware for graceful shutdown.
 *
 * @description When the server is in draining mode (preparing to shut down),
 * this middleware rejects new requests with a 503 status code while still
 * allowing health and metrics endpoints to respond. This enables load balancers
 * to detect the shutdown and route traffic elsewhere.
 *
 * @param {SSEManager} sseManager - Manager containing the draining state flag
 * @returns {Function} Express middleware function that blocks requests during drain
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
 * Applies all standard middleware to an Express application.
 *
 * @description Convenience function that sets up the complete middleware stack
 * in the correct order: CORS, JSON parsing, request logging, and connection draining.
 *
 * @param {express.Application} app - Express application instance to configure
 * @param {SSEManager} sseManager - Manager containing the draining state for shutdown handling
 * @returns {void}
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
