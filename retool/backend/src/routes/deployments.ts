import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { appService } from '../services/appService.js';
import { logger } from '../services/logger.js';

const router = Router();

// POST /api/deployments/:appId - Publish app (alias for apps/:id/publish)
router.post('/:appId', requireAuth, async (req: Request, res: Response) => {
  try {
    const app = await appService.getById(req.params.appId);
    if (!app) {
      res.status(404).json({ error: 'App not found' });
      return;
    }

    if (app.owner_id !== req.session.userId) {
      res.status(403).json({ error: 'Only the app owner can publish' });
      return;
    }

    const result = await appService.publish(req.params.appId, req.session.userId!);
    res.json({
      message: 'App published successfully',
      version: result.version,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to publish app');
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /api/deployments/:appId/versions - Get version history
router.get('/:appId/versions', requireAuth, async (req: Request, res: Response) => {
  try {
    const versions = await appService.getVersions(req.params.appId);
    res.json({ versions });
  } catch (err) {
    logger.error({ err }, 'Failed to get version history');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
