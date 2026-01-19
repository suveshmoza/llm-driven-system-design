/**
 * Admin routes for cluster management
 * - Node management (add/remove)
 * - Health check triggers
 * - Rebalancing operations
 * - Circuit breaker management
 * - Snapshots
 */

import { Router } from 'express';
import type { ConsistentHashRing } from '../lib/consistent-hash.js';
import { requireAdminKey, getAdminConfig } from '../shared/auth.js';
import {
  removeCircuitBreaker,
  getAllCircuitBreakerStatus,
  resetAllCircuitBreakers,
} from '../shared/circuit-breaker.js';
import { createLogger, logAdminOperation } from '../shared/logger.js';
import type { RebalanceManager } from '../shared/rebalance.js';
import type { HealthMonitor } from './health-monitor.js';
import type { NodeRequestFn, NodeStatusInfo } from './types.js';

const logger = createLogger({ component: 'admin-routes' });

export interface AdminRoutesConfig {
  gracefulRebalance: boolean;
}

/**
 * Create router for admin operations
 */
export function createAdminRouter(
  config: AdminRoutesConfig,
  ring: ConsistentHashRing,
  nodes: string[],
  nodeStatus: Map<string, NodeStatusInfo>,
  nodeRequest: NodeRequestFn,
  healthMonitor: HealthMonitor,
  rebalanceManager: RebalanceManager
): Router {
  const router = Router();
  const { gracefulRebalance } = config;

  /**
   * GET /admin/config - Get admin configuration
   */
  router.get('/admin/config', (_req, res) => {
    res.json(getAdminConfig());
  });

  /**
   * POST /admin/node - Add a new node to the cluster
   */
  router.post('/admin/node', requireAdminKey, async (req, res) => {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    if (!nodes.includes(url)) {
      nodes.push(url);
    }

    const status = await healthMonitor.checkNodeHealth(url);

    logAdminOperation('add_node', { url, healthy: status.healthy });

    res.json({
      message: status.healthy
        ? 'Node added successfully'
        : 'Node added but is not healthy',
      status,
    });
  });

  /**
   * DELETE /admin/node - Remove a node from the cluster
   */
  router.delete('/admin/node', requireAdminKey, async (req, res) => {
    const { url, graceful = true } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Graceful rebalancing before removal
    if (graceful && gracefulRebalance && ring.getAllNodes().includes(url)) {
      try {
        const rebalanceResult = await rebalanceManager.handleNodeRemoved(url);
        logger.info({ url, ...rebalanceResult }, 'graceful_removal_complete');
      } catch (error: unknown) {
        logger.error(
          { url, error: (error as Error).message },
          'graceful_removal_failed'
        );
      }
    }

    const index = nodes.indexOf(url);
    if (index > -1) {
      nodes.splice(index, 1);
    }

    ring.removeNode(url);
    removeCircuitBreaker(url);
    nodeStatus.delete(url);

    logAdminOperation('remove_node', { url, graceful });

    res.json({
      message: 'Node removed',
      remainingNodes: nodes,
    });
  });

  /**
   * POST /admin/health-check - Force health check of all nodes
   */
  router.post('/admin/health-check', requireAdminKey, async (_req, res) => {
    const results = await healthMonitor.checkAllNodesHealth();

    logAdminOperation('force_health_check', {
      total: results.length,
      healthy: results.filter((r) => r.healthy).length,
    });

    res.json({
      message: 'Health check completed',
      results,
    });
  });

  /**
   * POST /admin/rebalance - Trigger rebalancing
   */
  router.post('/admin/rebalance', requireAdminKey, async (req, res) => {
    const { targetNode, action } = req.body;

    if (!targetNode || !action) {
      return res.status(400).json({
        error: 'targetNode and action (add/remove) are required',
      });
    }

    let result;
    if (action === 'add') {
      result = await rebalanceManager.handleNodeAdded(targetNode);
    } else if (action === 'remove') {
      result = await rebalanceManager.handleNodeRemoved(targetNode);
    } else {
      return res.status(400).json({
        error: 'Invalid action. Use "add" or "remove"',
      });
    }

    logAdminOperation('rebalance', { targetNode, action, ...result });

    res.json({
      message: 'Rebalance completed',
      ...result,
    });
  });

  /**
   * GET /admin/rebalance/analyze - Analyze impact of adding a node
   */
  router.get('/admin/rebalance/analyze', requireAdminKey, async (req, res) => {
    const targetNode = req.query.targetNode as string | undefined;

    if (!targetNode) {
      return res.status(400).json({
        error: 'targetNode query parameter is required',
      });
    }

    const impact = await rebalanceManager.analyzeAddNodeImpact(targetNode);

    res.json({
      targetNode,
      impact,
    });
  });

  /**
   * POST /admin/snapshot - Force snapshot on all nodes
   */
  router.post('/admin/snapshot', requireAdminKey, async (_req, res) => {
    const activeNodes = ring.getAllNodes() as string[];

    const snapshotPromises = activeNodes.map(async (nodeUrl: string) => {
      const result = await nodeRequest(nodeUrl, '/snapshot', { method: 'POST' });
      return { nodeUrl, success: result.success, data: result.data };
    });

    const results = await Promise.all(snapshotPromises);

    logAdminOperation('force_snapshot', { nodes: activeNodes.length });

    res.json({
      message: 'Snapshot command sent to all nodes',
      results,
    });
  });

  /**
   * GET /admin/circuit-breakers - Get circuit breaker status
   */
  router.get('/admin/circuit-breakers', requireAdminKey, (_req, res) => {
    res.json({
      circuitBreakers: getAllCircuitBreakerStatus(),
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * POST /admin/circuit-breakers/reset - Reset all circuit breakers
   */
  router.post('/admin/circuit-breakers/reset', requireAdminKey, (_req, res) => {
    resetAllCircuitBreakers();

    logAdminOperation('reset_circuit_breakers', {});

    res.json({
      message: 'All circuit breakers reset',
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
