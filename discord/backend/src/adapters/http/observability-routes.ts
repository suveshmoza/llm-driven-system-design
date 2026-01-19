/**
 * Observability Routes
 *
 * @description Handles health checks, Prometheus metrics, and storage statistics endpoints.
 * Provides critical infrastructure endpoints for monitoring, load balancer health probes,
 * and operational visibility into the chat server state.
 * @module adapters/http/observability-routes
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
 * Creates an Express router with observability endpoints mounted at root level.
 *
 * @description Sets up infrastructure routes for monitoring:
 * - GET /metrics: Prometheus-formatted metrics for scraping
 * - GET /health: Comprehensive health check with database, Redis, and connection status
 *
 * These routes are mounted at the root level (not under /api) to follow standard
 * conventions for infrastructure endpoints.
 *
 * @param {SSEManager} sseManager - SSE manager for tracking active connection counts
 * @returns {Router} Express router configured with observability routes
 *
 * @example
 * // Mount at root level for standard /metrics and /health paths
 * app.use('/', createObservabilityRoutes(sseManager));
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
 * Creates an Express router with API-level health and storage endpoints.
 *
 * @description Sets up additional observability routes under the /api prefix:
 * - GET /api/health: Legacy health check endpoint for backwards compatibility
 * - GET /api/storage: Storage statistics for monitoring database and message counts
 *
 * These are separate from the root-level observability routes to maintain
 * API versioning and backwards compatibility with existing clients.
 *
 * @param {SSEManager} sseManager - SSE manager for tracking active connection counts
 * @returns {Router} Express router configured with API health and storage routes
 *
 * @example
 * // Mount under /api for API-level health checks
 * app.use('/api', createApiHealthRoutes(sseManager));
 */
export function createApiHealthRoutes(_sseManager: SSEManager): Router {
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
