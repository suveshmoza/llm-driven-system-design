import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { appService } from '../services/appService.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/apps - List current user's apps
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const apps = await appService.listByOwner(req.session.userId!);
    res.json({ apps });
  } catch (err) {
    logger.error({ err }, 'Failed to list apps');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/apps/:id - Get app by ID
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const app = await appService.getById(req.params.id);
    if (!app) {
      res.status(404).json({ error: 'App not found' });
      return;
    }
    res.json({ app });
  } catch (err) {
    logger.error({ err }, 'Failed to get app');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/apps - Create new app
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      res.status(400).json({ error: 'App name is required' });
      return;
    }

    const app = await appService.create(name, description || null, req.session.userId!);
    res.status(201).json({ app });
  } catch (err) {
    logger.error({ err }, 'Failed to create app');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/apps/:id - Update app
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, description, components, layout, queries, global_settings } = req.body;

    const app = await appService.update(req.params.id, {
      name,
      description,
      components,
      layout,
      queries,
      global_settings,
    });

    if (!app) {
      res.status(404).json({ error: 'App not found' });
      return;
    }

    res.json({ app });
  } catch (err) {
    logger.error({ err }, 'Failed to update app');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/apps/:id - Delete app
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const deleted = await appService.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'App not found' });
      return;
    }
    res.json({ message: 'App deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete app');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/apps/:id/publish - Publish app
router.post('/:id/publish', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await appService.publish(req.params.id, req.session.userId!);
    res.json({ message: 'App published', version: result.version });
  } catch (err) {
    logger.error({ err }, 'Failed to publish app');
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /api/apps/:id/preview - Get published version
router.get('/:id/preview', async (req: Request, res: Response) => {
  try {
    const published = await appService.getPublishedVersion(req.params.id);
    if (!published) {
      res.status(404).json({ error: 'No published version found' });
      return;
    }

    const app = await appService.getById(req.params.id);
    res.json({
      app: {
        id: req.params.id,
        name: app?.name,
        ...published,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get preview');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/apps/:id/versions - Get app version history
router.get('/:id/versions', requireAuth, async (req: Request, res: Response) => {
  try {
    const versions = await appService.getVersions(req.params.id);
    res.json({ versions });
  } catch (err) {
    logger.error({ err }, 'Failed to get versions');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
