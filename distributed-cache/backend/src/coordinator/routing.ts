/**
 * Request routing to cache nodes
 * - Routes cache operations (GET, POST, PUT, DELETE) to appropriate nodes
 * - Uses consistent hashing for key distribution
 */

import { Router } from 'express';
import type { ConsistentHashRing } from '../lib/consistent-hash.js';
import type { NodeRequestFn, KeysResult } from './types.js';

/**
 * Get the node responsible for a key
 */
export function getNodeForKey(ring: ConsistentHashRing, key: string): string {
  const nodeUrl = ring.getNode(key);
  if (!nodeUrl) {
    throw new Error('No healthy nodes available');
  }
  return nodeUrl;
}

/**
 * Create router for cache operations
 */
export function createCacheRouter(
  ring: ConsistentHashRing,
  nodeRequest: NodeRequestFn
): Router {
  const router = Router();

  /**
   * GET /cache/:key - Get a value (routed via consistent hashing)
   */
  router.get('/cache/:key', async (req, res) => {
    const { key } = req.params;

    try {
      const nodeUrl = getNodeForKey(ring, key);
      const result = await nodeRequest(nodeUrl, `/cache/${encodeURIComponent(key)}`);

      if (result.success) {
        res.json({
          ...(result.data as object),
          _routing: { nodeUrl },
        });
      } else {
        res.status(result.status || 500).json(result.error);
      }
    } catch (error: unknown) {
      res.status(503).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /cache/:key - Set a value (routed via consistent hashing)
   */
  router.post('/cache/:key', async (req, res) => {
    const { key } = req.params;

    try {
      const nodeUrl = getNodeForKey(ring, key);
      const result = await nodeRequest(
        nodeUrl,
        `/cache/${encodeURIComponent(key)}`,
        {
          method: 'POST',
          body: JSON.stringify(req.body),
        }
      );

      if (result.success) {
        res.status(201).json({
          ...(result.data as object),
          _routing: { nodeUrl },
        });
      } else {
        res.status(result.status || 500).json(result.error);
      }
    } catch (error: unknown) {
      res.status(503).json({ error: (error as Error).message });
    }
  });

  /**
   * PUT /cache/:key - Update a value
   */
  router.put('/cache/:key', async (req, res) => {
    const { key } = req.params;

    try {
      const nodeUrl = getNodeForKey(ring, key);
      const result = await nodeRequest(
        nodeUrl,
        `/cache/${encodeURIComponent(key)}`,
        {
          method: 'PUT',
          body: JSON.stringify(req.body),
        }
      );

      if (result.success) {
        res.json({
          ...(result.data as object),
          _routing: { nodeUrl },
        });
      } else {
        res.status(result.status || 500).json(result.error);
      }
    } catch (error: unknown) {
      res.status(503).json({ error: (error as Error).message });
    }
  });

  /**
   * DELETE /cache/:key - Delete a key
   */
  router.delete('/cache/:key', async (req, res) => {
    const { key } = req.params;

    try {
      const nodeUrl = getNodeForKey(ring, key);
      const result = await nodeRequest(
        nodeUrl,
        `/cache/${encodeURIComponent(key)}`,
        {
          method: 'DELETE',
        }
      );

      if (result.success) {
        res.json({
          ...(result.data as object),
          _routing: { nodeUrl },
        });
      } else {
        res.status(result.status || 500).json(result.error);
      }
    } catch (error: unknown) {
      res.status(503).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /cache/:key/incr - Increment a value
   */
  router.post('/cache/:key/incr', async (req, res) => {
    const { key } = req.params;

    try {
      const nodeUrl = getNodeForKey(ring, key);
      const result = await nodeRequest(
        nodeUrl,
        `/cache/${encodeURIComponent(key)}/incr`,
        {
          method: 'POST',
          body: JSON.stringify(req.body),
        }
      );

      if (result.success) {
        res.json({
          ...(result.data as object),
          _routing: { nodeUrl },
        });
      } else {
        res.status(result.status || 500).json(result.error);
      }
    } catch (error: unknown) {
      res.status(503).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /keys - List all keys from all nodes
   */
  router.get('/keys', async (req, res) => {
    const pattern = (req.query.pattern as string) || '*';
    const activeNodes = ring.getAllNodes() as string[];

    const keysPromises = activeNodes.map(async (nodeUrl: string): Promise<KeysResult> => {
      const result = await nodeRequest(
        nodeUrl,
        `/keys?pattern=${encodeURIComponent(pattern)}`
      );
      const data = result.data as { keys?: string[] } | undefined;
      return result.success
        ? { nodeUrl, keys: data?.keys || [] }
        : { nodeUrl, keys: [] };
    });

    const allKeysResults = await Promise.all(keysPromises);

    const allKeys: string[] = [];
    const perNode: Record<string, number> = {};

    for (const result of allKeysResults) {
      perNode[result.nodeUrl] = result.keys.length;
      allKeys.push(...result.keys);
    }

    res.json({
      pattern,
      totalCount: allKeys.length,
      perNode,
      keys: allKeys.slice(0, 1000),
    });
  });

  /**
   * POST /flush - Flush all nodes (requires admin auth - applied at app level)
   */
  router.post('/flush', async (_req, res) => {
    const activeNodes = ring.getAllNodes() as string[];

    const flushPromises = activeNodes.map(async (nodeUrl: string) => {
      const result = await nodeRequest(nodeUrl, '/flush', { method: 'POST' });
      return { nodeUrl, success: result.success };
    });

    const results = await Promise.all(flushPromises);

    res.json({
      message: 'Flush command sent to all nodes',
      results,
    });
  });

  return router;
}
