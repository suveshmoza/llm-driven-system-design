/**
 * Cluster information and statistics routes
 * - Cluster info, stats, key distribution
 * - Hot keys aggregation
 */

import { Router } from 'express';
import type { ConsistentHashRing } from '../lib/consistent-hash.js';
import { getAllCircuitBreakerStatus } from '../shared/circuit-breaker.js';
import type { RebalanceManager } from '../shared/rebalance.js';
import type {
  NodeRequestFn,
  NodeStats,
  HotKey,
  NodeHotKeysResult,
  NodeStatusInfo,
} from './types.js';

export interface ClusterRoutesConfig {
  port: number | string;
  virtualNodes: number;
}

/**
 * Create router for cluster information and statistics
 */
export function createClusterRouter(
  config: ClusterRoutesConfig,
  ring: ConsistentHashRing,
  nodeStatus: Map<string, NodeStatusInfo>,
  nodeRequest: NodeRequestFn,
  rebalanceManager: RebalanceManager
): Router {
  const router = Router();
  const { port, virtualNodes } = config;

  /**
   * Cluster info
   */
  router.get('/cluster/info', (_req, res) => {
    res.json({
      coordinator: {
        port,
        uptime: process.uptime(),
      },
      ring: {
        virtualNodes,
        activeNodes: ring.getAllNodes(),
      },
      nodes: Array.from(nodeStatus.values()),
      circuitBreakers: getAllCircuitBreakerStatus(),
      rebalance: rebalanceManager.getStatus(),
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * Cluster stats - aggregate from all nodes
   */
  router.get('/cluster/stats', async (_req, res) => {
    const activeNodes = ring.getAllNodes() as string[];
    const statsPromises = activeNodes.map(async (nodeUrl: string) => {
      const result = await nodeRequest(nodeUrl, '/stats');
      return result.success
        ? ({ nodeUrl, ...(result.data as object) } as NodeStats)
        : null;
    });

    const allStats = (await Promise.all(statsPromises)).filter(
      (s): s is NodeStats => s !== null
    );

    // Aggregate stats
    const totalHits = allStats.reduce((sum, s) => sum + s.hits, 0);
    const totalMisses = allStats.reduce((sum, s) => sum + s.misses, 0);
    const totalOps = totalHits + totalMisses;

    const aggregated = {
      totalNodes: allStats.length,
      totalHits,
      totalMisses,
      totalSets: allStats.reduce((sum, s) => sum + s.sets, 0),
      totalDeletes: allStats.reduce((sum, s) => sum + s.deletes, 0),
      totalEvictions: allStats.reduce((sum, s) => sum + s.evictions, 0),
      totalSize: allStats.reduce((sum, s) => sum + s.size, 0),
      totalMemoryMB: allStats
        .reduce((sum, s) => sum + parseFloat(s.memoryMB), 0)
        .toFixed(2),
      hotKeys: allStats.flatMap((s) =>
        (s.hotKeys || []).map((hk: HotKey) => ({ ...hk, node: s.nodeUrl }))
      ),
      perNode: allStats,
      overallHitRate:
        totalOps > 0 ? ((totalHits / totalOps) * 100).toFixed(2) : '0.00',
    };

    res.json({
      ...aggregated,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * Check which node a key belongs to
   */
  router.get('/cluster/locate/:key', (req, res) => {
    const { key } = req.params;

    try {
      const nodeUrl = ring.getNode(key);
      if (!nodeUrl) {
        return res.status(503).json({ error: 'No healthy nodes available' });
      }
      res.json({
        key,
        nodeUrl,
        allNodes: ring.getAllNodes(),
      });
    } catch (error: unknown) {
      res.status(503).json({
        error: (error as Error).message,
      });
    }
  });

  /**
   * Get key distribution across nodes
   */
  router.post('/cluster/distribution', (req, res) => {
    const { keys } = req.body;

    if (!Array.isArray(keys)) {
      return res.status(400).json({
        error: 'Keys must be an array',
      });
    }

    const distribution = ring.getDistribution(keys);
    const result: Record<string, { count: number; percentage: string }> = {};

    for (const [nodeUrl, count] of distribution) {
      result[nodeUrl as string] = {
        count: count as number,
        percentage: (((count as number) / keys.length) * 100).toFixed(2),
      };
    }

    res.json({
      totalKeys: keys.length,
      distribution: result,
    });
  });

  /**
   * Get hot keys across the cluster
   */
  router.get('/cluster/hot-keys', async (_req, res) => {
    const activeNodes = ring.getAllNodes() as string[];
    const hotKeysPromises = activeNodes.map(
      async (nodeUrl: string): Promise<NodeHotKeysResult> => {
        const result = await nodeRequest(nodeUrl, '/hot-keys');
        const data = result.data as { hotKeys?: HotKey[] } | undefined;
        return result.success
          ? { nodeUrl, hotKeys: data?.hotKeys || [] }
          : { nodeUrl, hotKeys: [] };
      }
    );

    const allHotKeys = await Promise.all(hotKeysPromises);

    res.json({
      nodes: allHotKeys,
      aggregated: allHotKeys.flatMap((n) =>
        (n.hotKeys || []).map((hk: HotKey) => ({ ...hk, node: n.nodeUrl }))
      ),
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
