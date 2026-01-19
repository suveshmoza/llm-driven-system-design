/**
 * Admin Routes for Cache Server
 *
 * Provides endpoints for administrative operations:
 * - POST /snapshot - Force a snapshot
 * - GET /snapshots - List available snapshots
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ServerContext } from './types.js';

/**
 * Create admin routes for persistence and management
 *
 * @param context - Server context with persistence manager and logger
 * @returns Express Router with admin routes
 */
export function createAdminRoutes(context: ServerContext): Router {
  const router = Router();
  const { persistence, config, logger } = context;

  /**
   * POST /snapshot - Force a snapshot
   */
  router.post('/snapshot', async (_req: Request, res: Response) => {
    try {
      const result = await persistence.forceSnapshot();
      res.json({
        message: 'Snapshot created',
        ...result,
      });
    } catch (error) {
      const err = error as Error;
      logger.error({ error: err.message }, 'snapshot_failed');
      res.status(500).json({
        error: 'Snapshot failed',
        message: err.message,
      });
    }
  });

  /**
   * GET /snapshots - List available snapshots
   */
  router.get('/snapshots', async (_req: Request, res: Response) => {
    try {
      const snapshots = await persistence.listSnapshots();
      res.json({
        nodeId: config.nodeId,
        snapshots,
      });
    } catch (error) {
      const err = error as Error;
      logger.error({ error: err.message }, 'list_snapshots_failed');
      res.status(500).json({
        error: 'Failed to list snapshots',
        message: err.message,
      });
    }
  });

  return router;
}
