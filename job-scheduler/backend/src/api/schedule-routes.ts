/**
 * Health check and metrics routes for the job scheduler API.
 * Includes liveness/readiness probes for Kubernetes and system metrics.
 * @module api/schedule-routes
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from './types.js';
import { authenticate } from '../shared/auth.js';
import { metricsHandler, updateQueueMetrics } from '../shared/metrics.js';
import { getCircuitBreakerStates } from '../shared/circuit-breaker.js';
import { healthCheck as dbHealthCheck } from '../db/pool.js';
import { healthCheck as redisHealthCheck, redis } from '../queue/redis.js';
import { queue } from '../queue/reliable-queue.js';
import * as db from '../db/repository.js';
import { ApiResponse } from '../types/index.js';
import { HealthCheckData, WorkerData } from './types.js';

const router = Router();

/** GET /metrics - Prometheus metrics endpoint (public) */
router.get('/metrics', metricsHandler);

/** GET /api/v1/health - Check database and Redis connectivity */
router.get(
  '/api/v1/health',
  asyncHandler(async (_req, res) => {
    const [dbOk, redisOk] = await Promise.all([dbHealthCheck(), redisHealthCheck()]);

    const healthy = dbOk && redisOk;
    const response: ApiResponse<HealthCheckData> = {
      success: healthy,
      data: {
        db: dbOk,
        redis: redisOk,
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
      },
    };

    res.status(healthy ? 200 : 503).json(response);
  })
);

/** GET /api/v1/health/ready - Readiness check for k8s */
router.get(
  '/api/v1/health/ready',
  asyncHandler(async (_req, res) => {
    const [dbOk, redisOk] = await Promise.all([dbHealthCheck(), redisHealthCheck()]);
    const ready = dbOk && redisOk;
    res.status(ready ? 200 : 503).json({ ready, db: dbOk, redis: redisOk });
  })
);

/** GET /api/v1/health/live - Liveness check for k8s */
router.get('/api/v1/health/live', (_req: Request, res: Response) => {
  res.status(200).json({ alive: true });
});

/** GET /api/v1/metrics/system - Get aggregated system metrics */
router.get(
  '/api/v1/metrics/system',
  authenticate,
  asyncHandler(async (_req, res) => {
    const [dbMetrics, queueStats] = await Promise.all([
      db.getSystemMetrics(),
      queue.getStats(),
    ]);

    // Update queue metrics for Prometheus
    await updateQueueMetrics(queueStats);

    // Get worker count from Redis
    const workers = await redis.hgetall('job_scheduler:workers');
    const activeWorkers = Object.values(workers).filter((w) => {
      const worker: WorkerData = JSON.parse(w);
      const lastHeartbeat = new Date(worker.last_heartbeat);
      const isRecent = Date.now() - lastHeartbeat.getTime() < 60000; // 1 minute
      return isRecent;
    }).length;

    // Get circuit breaker states
    const circuitBreakers = Object.fromEntries(getCircuitBreakerStates());

    res.json({
      success: true,
      data: {
        jobs: dbMetrics,
        queue: queueStats,
        workers: {
          active: activeWorkers,
          total: Object.keys(workers).length,
        },
        circuitBreakers,
      },
    });
  })
);

/** GET /api/v1/metrics/executions - Get hourly execution statistics */
router.get(
  '/api/v1/metrics/executions',
  authenticate,
  asyncHandler(async (req, res) => {
    const hours = parseInt(req.query.hours as string) || 24;
    const stats = await db.getExecutionStats(hours);

    res.json({
      success: true,
      data: stats,
    } as ApiResponse<typeof stats>);
  })
);

/** GET /api/v1/workers - Get list of registered workers */
router.get(
  '/api/v1/workers',
  authenticate,
  asyncHandler(async (_req, res) => {
    const workers = await redis.hgetall('job_scheduler:workers');

    const workerList = Object.values(workers).map((w) => JSON.parse(w));

    res.json({
      success: true,
      data: workerList,
    } as ApiResponse<typeof workerList>);
  })
);

/** GET /api/v1/dead-letter - Get items from the dead letter queue */
router.get(
  '/api/v1/dead-letter',
  authenticate,
  asyncHandler(async (req, res) => {
    const start = parseInt(req.query.start as string) || 0;
    const count = parseInt(req.query.count as string) || 100;

    const items = await queue.getDeadLetterItems(start, start + count - 1);

    res.json({
      success: true,
      data: items,
    } as ApiResponse<typeof items>);
  })
);

export { router as scheduleRoutes };
