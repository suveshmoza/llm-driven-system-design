/**
 * Health monitoring for cache nodes
 * - Periodic health checks
 * - Automatic node addition/removal from ring
 * - Metrics updates
 */

import type { ConsistentHashRing } from '../lib/consistent-hash.js';
import {
  clusterNodesHealthy,
  clusterNodesTotal,
  nodeHealthCheckFailures,
} from '../shared/metrics.js';
import {
  createLogger,
  logNodeHealthChange,
  logNodeAdded,
  logNodeRemoved,
} from '../shared/logger.js';
import { removeCircuitBreaker } from '../shared/circuit-breaker.js';
import type { RebalanceManager } from '../shared/rebalance.js';
import type { NodeStatusInfo, NodeRequestFn } from './types.js';

const logger = createLogger({ component: 'health-monitor' });

export interface HealthMonitorConfig {
  nodes: string[];
  healthCheckInterval: number;
  gracefulRebalance: boolean;
}

export interface HealthMonitor {
  nodeStatus: Map<string, NodeStatusInfo>;
  checkNodeHealth: (nodeUrl: string) => Promise<NodeStatusInfo>;
  checkAllNodesHealth: () => Promise<NodeStatusInfo[]>;
  startPeriodicHealthCheck: () => NodeJS.Timeout;
  getHealthyNodesCount: () => number;
}

/**
 * Create a health monitor for cache nodes
 */
export function createHealthMonitor(
  config: HealthMonitorConfig,
  ring: ConsistentHashRing,
  nodeRequest: NodeRequestFn,
  rebalanceManager: RebalanceManager
): HealthMonitor {
  const { nodes, healthCheckInterval, gracefulRebalance } = config;
  const nodeStatus = new Map<string, NodeStatusInfo>();

  /**
   * Check health of a single node
   */
  async function checkNodeHealth(nodeUrl: string): Promise<NodeStatusInfo> {
    const result = await nodeRequest(nodeUrl, '/health');

    if (result.success) {
      const data = result.data as {
        nodeId?: string;
        uptime?: number;
        cache?: unknown;
      };
      const wasUnhealthy = nodeStatus.get(nodeUrl)?.healthy === false;
      const status: NodeStatusInfo = {
        url: nodeUrl,
        healthy: true,
        nodeId: data.nodeId,
        uptime: data.uptime,
        cache: data.cache,
        lastCheck: new Date().toISOString(),
        consecutiveFailures: 0,
      };
      nodeStatus.set(nodeUrl, status);

      // Add to ring if not already present
      if (!ring.getAllNodes().includes(nodeUrl)) {
        ring.addNode(nodeUrl);
        logNodeAdded(nodeUrl);

        // Trigger graceful rebalancing if enabled
        if (gracefulRebalance && ring.getAllNodes().length > 1) {
          rebalanceManager.handleNodeAdded(nodeUrl).catch((err) => {
            logger.error(
              { nodeUrl, error: err.message },
              'rebalance_after_node_add_failed'
            );
          });
        }
      }

      // Log recovery
      if (wasUnhealthy) {
        logNodeHealthChange(nodeUrl, true, 'recovered');
      }
    } else {
      const existing = nodeStatus.get(nodeUrl) || { consecutiveFailures: 0 };
      const status: NodeStatusInfo = {
        url: nodeUrl,
        healthy: false,
        error: result.error as string,
        lastCheck: new Date().toISOString(),
        consecutiveFailures: existing.consecutiveFailures + 1,
      };
      nodeStatus.set(nodeUrl, status);
      nodeHealthCheckFailures.labels(nodeUrl).inc();

      // Remove from ring after 3 consecutive failures
      if (status.consecutiveFailures >= 3 && ring.getAllNodes().includes(nodeUrl)) {
        ring.removeNode(nodeUrl);
        removeCircuitBreaker(nodeUrl);
        logNodeRemoved(nodeUrl, `${status.consecutiveFailures} consecutive failures`);
      }
    }

    return nodeStatus.get(nodeUrl)!;
  }

  /**
   * Check health of all nodes
   */
  async function checkAllNodesHealth(): Promise<NodeStatusInfo[]> {
    const results = await Promise.all(nodes.map(checkNodeHealth));

    // Update cluster metrics
    const healthy = results.filter((r) => r.healthy).length;
    clusterNodesHealthy.set(healthy);
    clusterNodesTotal.set(nodes.length);

    return results;
  }

  /**
   * Start periodic health checks
   */
  function startPeriodicHealthCheck(): NodeJS.Timeout {
    return setInterval(checkAllNodesHealth, healthCheckInterval);
  }

  /**
   * Get count of healthy nodes
   */
  function getHealthyNodesCount(): number {
    return Array.from(nodeStatus.values()).filter((n) => n.healthy).length;
  }

  return {
    nodeStatus,
    checkNodeHealth,
    checkAllNodesHealth,
    startPeriodicHealthCheck,
    getHealthyNodesCount,
  };
}
