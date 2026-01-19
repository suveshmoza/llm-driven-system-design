/**
 * Observability Routes
 *
 * Handles health checks, metrics, and storage statistics endpoints.
 */

import type { Request, Response, Router } from 'express';
import express from 'express';
import type { ApiResponse } from '../../types/index.js';
import { connectionManager, roomManager } from '../../core/index.js';
import * as dbOps from '../../db/index.js';
import { httpLogger } from '../../utils/logger.js';
import { pubsubManager } from '../../utils/pubsub.js';
import {
  getMetrics,
  getMetricsContentType,
  activeConnections,
} from '../../shared/metrics.js';
import { server } from '../../shared/config.js';
import { getStorageStats, isCleanupRunning } from '../../utils/cleanup.js';
import type { SSEManager } from './types.js';

/**
 * Create observability routes (mounted at root, not /api)
 *
 * @param sseManager - SSE manager for connection counts
 */
export function createObservabilityRoutes(sseManager: SSEManager): Router {
  const router = express.Router();

  // Prometheus metrics endpoint
  router.get('/metrics', async (req: Request, res: Response) => {
    try {
      // Update current gauge values before returning metrics
      activeConnections.labels({ transport: 'http', instance: server.instanceId })
        .set(sseManager.clients.size);

      const metrics = await getMetrics();
      res.setHeader('Content-Type', getMetricsContentType());
      res.send(metrics);
    } catch (error) {
      httpLogger.error({ err: error }, 'Failed to generate metrics');
      res.status(500).send('Failed to generate metrics');
    }
  });

  // Comprehensive health check endpoint
  router.get('/health', async (req: Request, res: Response) => {
    const checks: Record<string, unknown> = {};
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    // Database health
    const dbStartTime = process.hrtime.bigint();
    const dbHealthy = await dbOps.db.healthCheck();
    const dbLatencyMs = Number(process.hrtime.bigint() - dbStartTime) / 1_000_000;

    checks.database = {
      status: dbHealthy ? 'healthy' : 'unhealthy',
      latencyMs: Math.round(dbLatencyMs * 100) / 100,
    };

    if (!dbHealthy) overallStatus = 'unhealthy';

    // Redis/Valkey health
    const redisConnected = pubsubManager.isConnected();
    checks.redis = {
      status: redisConnected ? 'healthy' : 'degraded',
      subscribedChannels: pubsubManager.getSubscribedChannels().length,
    };

    if (!redisConnected && overallStatus === 'healthy') {
      overallStatus = 'degraded';
    }

    // Connection stats
    checks.connections = {
      sessions: connectionManager.getSessionCount(),
      sseClients: sseManager.clients.size,
      onlineUsers: connectionManager.getOnlineUserCount(),
    };

    // Room stats
    const rooms = await roomManager.listRooms();
    checks.rooms = {
      count: rooms.length,
    };

    // Cleanup job status
    checks.cleanup = {
      running: isCleanupRunning(),
    };

    // Server info
    checks.server = {
      instanceId: server.instanceId,
      uptime: process.uptime(),
      draining: sseManager.isDraining,
    };

    const statusCode = overallStatus === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  return router;
}

/**
 * Create API health and storage routes
 *
 * @param sseManager - SSE manager for connection counts
 */
export function createApiHealthRoutes(sseManager: SSEManager): Router {
  const router = express.Router();

  // Legacy health check endpoint for backwards compatibility
  router.get('/health', async (req: Request, res: Response) => {
    const dbHealthy = await dbOps.db.healthCheck();
    res.json({
      status: dbHealthy ? 'healthy' : 'degraded',
      db: dbHealthy,
      connections: connectionManager.getSessionCount(),
      uptime: process.uptime(),
    });
  });

  // Storage stats endpoint for monitoring
  router.get('/storage', async (req: Request, res: Response) => {
    try {
      const stats = await getStorageStats();
      res.json({
        success: true,
        data: stats,
      } as ApiResponse);
    } catch (error) {
      httpLogger.error({ err: error }, 'Failed to get storage stats');
      res.status(500).json({
        success: false,
        error: 'Failed to get storage stats',
      } as ApiResponse);
    }
  });

  return router;
}
