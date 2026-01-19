/**
 * Express middleware for the job scheduler API.
 * Includes logging, error handling, and request tracking.
 * @module api/middleware
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { ApiResponse } from '../types/index.js';

/**
 * Request logging middleware.
 * Logs method, URL, status, and response time for all requests.
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(
      {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
        userId: req.user?.userId,
      },
      `${req.method} ${req.path}`
    );
  });
  next();
}

/**
 * Global error handler middleware.
 * Logs unhandled errors and returns a standardized error response.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  } as ApiResponse<never>);
}

/**
 * Not found handler for unmatched routes.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} not found`,
  } as ApiResponse<never>);
}
