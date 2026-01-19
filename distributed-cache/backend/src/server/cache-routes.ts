/**
 * Cache Operation Routes for Cache Server
 *
 * Provides endpoints for single-key cache operations:
 * - GET /cache/:key - Get a value
 * - POST /cache/:key - Set a value
 * - PUT /cache/:key - Update a value
 * - DELETE /cache/:key - Delete a key
 * - GET /cache/:key/exists - Check if key exists
 * - GET /cache/:key/ttl - Get TTL for a key
 * - POST /cache/:key/expire - Set TTL on existing key
 * - POST /cache/:key/incr - Increment numeric value
 * - GET /cache/:key/info - Get detailed key info
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  cacheHits,
  cacheMisses,
  cacheSets,
  cacheDeletes,
} from '../shared/metrics.js';
import {
  logCacheHit,
  logCacheMiss,
  logCacheSet,
  logCacheDelete,
} from '../shared/logger.js';
import { measureOperation } from './middleware.js';
import type {
  ServerContext,
  SetRequestBody,
  ExpireRequestBody,
  IncrRequestBody,
} from './types.js';

/**
 * Create cache operation routes for single-key operations
 *
 * @param context - Server context with cache, hot key detector, and config
 * @returns Express Router with cache operation routes
 */
export function createCacheRoutes(context: ServerContext): Router {
  const router = Router();
  const { cache, hotKeyDetector, config } = context;
  const { nodeId } = config;

  /**
   * GET /cache/:key - Get a value from cache
   */
  router.get(
    '/cache/:key',
    measureOperation(nodeId, 'get', async (req: Request, res: Response) => {
      const { key } = req.params;

      hotKeyDetector.recordAccess(key);
      const value = cache.get(key);

      if (value === undefined) {
        cacheMisses.labels(nodeId).inc();
        logCacheMiss(key, 0);
        res.status(404).json({ error: 'Key not found', key });
        return;
      }

      cacheHits.labels(nodeId).inc();
      logCacheHit(key, 0);
      res.json({ key, value, ttl: cache.ttl(key) });
    })
  );

  /**
   * POST /cache/:key - Set a value in cache
   */
  router.post(
    '/cache/:key',
    measureOperation(nodeId, 'set', async (req: Request, res: Response) => {
      const { key } = req.params;
      const { value, ttl = 0 } = req.body as SetRequestBody;

      if (value === undefined) {
        res.status(400).json({ error: 'Value is required' });
        return;
      }

      cache.set(key, value, ttl);
      cacheSets.labels(nodeId).inc();
      logCacheSet(key, ttl, 0);
      res.status(201).json({ key, ttl: cache.ttl(key), message: 'Value set successfully' });
    })
  );

  /**
   * PUT /cache/:key - Update a value in cache (same as POST)
   */
  router.put(
    '/cache/:key',
    measureOperation(nodeId, 'set', async (req: Request, res: Response) => {
      const { key } = req.params;
      const { value, ttl = 0 } = req.body as SetRequestBody;

      if (value === undefined) {
        res.status(400).json({ error: 'Value is required' });
        return;
      }

      cache.set(key, value, ttl);
      cacheSets.labels(nodeId).inc();
      logCacheSet(key, ttl, 0);
      res.json({ key, ttl: cache.ttl(key), message: 'Value updated successfully' });
    })
  );

  /**
   * DELETE /cache/:key - Delete a key from cache
   */
  router.delete(
    '/cache/:key',
    measureOperation(nodeId, 'delete', async (req: Request, res: Response) => {
      const { key } = req.params;
      const deleted = cache.delete(key);

      if (!deleted) {
        res.status(404).json({ error: 'Key not found', key });
        return;
      }

      cacheDeletes.labels(nodeId).inc();
      logCacheDelete(key);
      res.json({ key, message: 'Key deleted successfully' });
    })
  );

  /**
   * GET /cache/:key/exists - Check if a key exists
   */
  router.get('/cache/:key/exists', (req: Request, res: Response) => {
    const { key } = req.params;
    res.json({ key, exists: cache.has(key) });
  });

  /**
   * GET /cache/:key/ttl - Get TTL for a key
   */
  router.get('/cache/:key/ttl', (req: Request, res: Response) => {
    const { key } = req.params;
    const ttl = cache.ttl(key);

    if (ttl === -2) {
      res.status(404).json({ error: 'Key not found', key });
      return;
    }

    res.json({ key, ttl, hasExpiration: ttl !== -1 });
  });

  /**
   * POST /cache/:key/expire - Set TTL on an existing key
   */
  router.post('/cache/:key/expire', (req: Request, res: Response) => {
    const { key } = req.params;
    const { ttl } = req.body as ExpireRequestBody;

    if (ttl === undefined || typeof ttl !== 'number') {
      res.status(400).json({ error: 'TTL is required and must be a number' });
      return;
    }

    const success = cache.expire(key, ttl);
    if (!success) {
      res.status(404).json({ error: 'Key not found', key });
      return;
    }

    res.json({ key, ttl: cache.ttl(key), message: 'TTL set successfully' });
  });

  /**
   * POST /cache/:key/incr - Increment a numeric value
   */
  router.post('/cache/:key/incr', (req: Request, res: Response) => {
    const { key } = req.params;
    const { delta = 1 } = req.body as IncrRequestBody;

    const result = cache.incr(key, delta);
    if (result === null) {
      res.status(400).json({ error: 'Value is not a number', key });
      return;
    }

    res.json({ key, value: result });
  });

  /**
   * GET /cache/:key/info - Get detailed info about a key
   */
  router.get('/cache/:key/info', (req: Request, res: Response) => {
    const { key } = req.params;
    const info = cache.getKeyInfo(key);

    if (!info) {
      res.status(404).json({ error: 'Key not found', key });
      return;
    }

    res.json(info);
  });

  return router;
}
