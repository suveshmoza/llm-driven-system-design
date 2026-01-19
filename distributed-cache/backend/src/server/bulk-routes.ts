/**
 * Bulk Operation Routes for Cache Server
 *
 * Provides endpoints for bulk cache operations:
 * - GET /keys - List all keys (with optional pattern)
 * - POST /mget - Get multiple keys
 * - POST /mset - Set multiple keys
 * - POST /flush - Clear all keys
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { cacheHits, cacheMisses, cacheSets } from '../shared/metrics.js';
import type { ServerContext, MGetRequestBody, MSetRequestBody } from './types.js';

/**
 * Create bulk operation routes
 *
 * @param context - Server context with cache, hot key detector, and config
 * @returns Express Router with bulk operation routes
 */
export function createBulkRoutes(context: ServerContext): Router {
  const router = Router();
  const { cache, hotKeyDetector, config, logger } = context;
  const { nodeId } = config;

  /**
   * GET /keys - List all keys (with optional pattern)
   */
  router.get('/keys', (req: Request, res: Response) => {
    const pattern = (req.query.pattern as string) || '*';
    const keys = cache.keys(pattern);

    res.json({
      pattern,
      count: keys.length,
      keys: keys.slice(0, 1000), // Limit to first 1000 keys
    });
  });

  /**
   * POST /mget - Get multiple keys
   */
  router.post('/mget', (req: Request, res: Response) => {
    const { keys } = req.body as MGetRequestBody;

    if (!Array.isArray(keys)) {
      res.status(400).json({
        error: 'Keys must be an array',
      });
      return;
    }

    const results: Record<string, unknown> = {};
    for (const key of keys) {
      hotKeyDetector.recordAccess(key);
      const value = cache.get(key);
      if (value !== undefined) {
        results[key] = value;
        cacheHits.labels(nodeId).inc();
      } else {
        cacheMisses.labels(nodeId).inc();
      }
    }

    res.json({
      results,
      found: Object.keys(results).length,
      requested: keys.length,
    });
  });

  /**
   * POST /mset - Set multiple keys
   */
  router.post('/mset', (req: Request, res: Response) => {
    const { entries } = req.body as MSetRequestBody;

    if (!Array.isArray(entries)) {
      res.status(400).json({
        error: 'Entries must be an array',
      });
      return;
    }

    let set = 0;
    for (const entry of entries) {
      if (entry.key && entry.value !== undefined) {
        cache.set(entry.key, entry.value, entry.ttl || 0);
        cacheSets.labels(nodeId).inc();
        set++;
      }
    }

    res.json({
      set,
      requested: entries.length,
      message: 'Bulk set completed',
    });
  });

  /**
   * POST /flush - Clear all keys
   */
  router.post('/flush', (_req: Request, res: Response) => {
    const statsBefore = cache.getStats();
    cache.clear();

    logger.info({ keysCleared: statsBefore.size }, 'cache_flushed');

    res.json({
      message: 'Cache flushed',
      keysCleared: statsBefore.size,
    });
  });

  return router;
}
