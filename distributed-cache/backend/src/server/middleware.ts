/**
 * Express Middleware for Cache Server
 *
 * Provides common middleware functions including:
 * - Operation timing and metrics recording
 * - Error handling
 * - Request logging
 */

import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { recordOperation } from '../shared/metrics.js';
import type { ServerContext, AsyncRequestHandler, CacheOperation } from './types.js';

/**
 * Create a middleware that measures operation duration and records metrics
 *
 * @param nodeId - The node identifier for metrics labels
 * @param operation - The operation type (get, set, delete)
 * @param handler - The async request handler to wrap
 * @returns Express middleware function
 */
export function measureOperation(
  nodeId: string,
  operation: CacheOperation,
  handler: AsyncRequestHandler
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const start = performance.now();
    try {
      await handler(req, res, next);
    } finally {
      const duration = performance.now() - start;
      recordOperation(nodeId, operation, duration);
    }
  };
}

/**
 * Create the global error handling middleware
 *
 * @param context - Server context with logger
 * @returns Express error handler middleware
 */
export function createErrorHandler(context: ServerContext): ErrorRequestHandler {
  return (
    err: Error,
    _req: Request,
    res: Response,
    _next: NextFunction
  ): void => {
    context.logger.error({ error: err.message, stack: err.stack }, 'unhandled_error');
    res.status(500).json({
      error: 'Internal server error',
      message: err.message,
    });
  };
}

/**
 * Update cache stats metrics periodically
 * Returns a function that can be called to update metrics
 *
 * @param context - Server context with cache and hot key detector
 * @returns Function to update metrics
 */
export function createMetricsUpdater(context: ServerContext) {
  const { cache, hotKeyDetector, config } = context;

  return function updateMetrics(): void {
    const { updateCacheStats } = require('../shared/metrics.js');
    const { logHotKeysDetected } = require('../shared/logger.js');

    const stats = cache.getStats();
    updateCacheStats(config.nodeId, stats);

    // Check for hot keys
    const hotKeys = hotKeyDetector.getHotKeys();
    if (hotKeys.length > 0) {
      logHotKeysDetected(hotKeys);
    }
  };
}
