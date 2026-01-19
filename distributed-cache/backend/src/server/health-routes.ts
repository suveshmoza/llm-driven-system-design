/**
 * Health and Metrics Routes for Cache Server
 *
 * Provides endpoints for:
 * - /health - Health check with cache and process stats
 * - /metrics - Prometheus metrics endpoint
 * - /info - Detailed node information
 * - /stats - Cache statistics
 * - /hot-keys - Hot key detection data
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getMetrics, getContentType, updateCacheStats } from '../shared/metrics.js';
import { logHotKeysDetected } from '../shared/logger.js';
import type { ServerContext, HealthResponse } from './types.js';

/**
 * Create health and metrics routes
 *
 * @param context - Server context with cache, hot key detector, and config
 * @returns Express Router with health and metrics routes
 */
export function createHealthRoutes(context: ServerContext): Router {
  const router = Router();
  const { cache, hotKeyDetector, config, logger } = context;

  /**
   * Helper to update cache stats metrics
   */
  function updateMetrics(): void {
    const stats = cache.getStats();
    updateCacheStats(config.nodeId, stats);

    const hotKeys = hotKeyDetector.getHotKeys();
    if (hotKeys.length > 0) {
      logHotKeysDetected(hotKeys);
    }
  }

  /**
   * GET /health - Health check endpoint
   */
  router.get('/health', (_req: Request, res: Response) => {
    const stats = cache.getStats();
    const memoryUsage = process.memoryUsage();

    const response: HealthResponse = {
      status: 'healthy',
      nodeId: config.nodeId,
      port: config.port,
      uptime: process.uptime(),
      cache: {
        entries: stats.size,
        memoryMB: stats.memoryMB,
        hitRate: stats.hitRate,
      },
      process: {
        heapUsedMB: (memoryUsage.heapUsed / 1024 / 1024).toFixed(2),
        heapTotalMB: (memoryUsage.heapTotal / 1024 / 1024).toFixed(2),
        rssMB: (memoryUsage.rss / 1024 / 1024).toFixed(2),
      },
      timestamp: new Date().toISOString(),
    };

    res.json(response);
  });

  /**
   * GET /metrics - Prometheus metrics endpoint
   */
  router.get('/metrics', async (_req: Request, res: Response) => {
    try {
      updateMetrics();
      res.set('Content-Type', getContentType());
      res.end(await getMetrics());
    } catch (error) {
      const err = error as Error;
      logger.error({ error: err.message }, 'metrics_error');
      res.status(500).end(err.message);
    }
  });

  /**
   * GET /info - Node info endpoint
   */
  router.get('/info', (_req: Request, res: Response) => {
    res.json({
      nodeId: config.nodeId,
      port: config.port,
      config: {
        maxSize: config.maxSize,
        maxMemoryMB: config.maxMemoryMB,
        defaultTTL: config.defaultTTL,
      },
      stats: cache.getStats(),
      hotKeys: hotKeyDetector.getHotKeys(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /stats - Cache statistics endpoint
   */
  router.get('/stats', (_req: Request, res: Response) => {
    res.json({
      nodeId: config.nodeId,
      ...cache.getStats(),
      hotKeys: hotKeyDetector.getHotKeys(),
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /hot-keys - Hot keys endpoint
   */
  router.get('/hot-keys', (_req: Request, res: Response) => {
    res.json({
      nodeId: config.nodeId,
      hotKeys: hotKeyDetector.getHotKeys(),
      windowMs: 60000,
      threshold: '1%',
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
