import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { pool } from '../services/db.js';
import {
  createPage,
  updatePage,
  deletePage,
  getPageById,
  getPageBySlug,
  getPageTree,
  movePage,
  getRecentPages,
  addLabel,
  removeLabel,
  getLabels,
  getPageBreadcrumbs,
} from '../services/pageService.js';
import { logger } from '../services/logger.js';

const router = Router();

// Get recent pages (dashboard)
router.get('/recent', async (_req: Request, res: Response) => {
  try {
    const pages = await getRecentPages(20);
    res.json({ pages });
  } catch (err) {
    logger.error({ err }, 'Failed to get recent pages');
    res.status(500).json({ error: 'Failed to get recent pages' });
  }
});

// Get page tree for a space
router.get('/space/:spaceKey/tree', async (req: Request, res: Response) => {
  try {
    const space = await pool.query('SELECT id FROM spaces WHERE key = $1', [
      req.params.spaceKey.toUpperCase(),
    ]);
    if (space.rows.length === 0) {
      res.status(404).json({ error: 'Space not found' });
      return;
    }

    const tree = await getPageTree(space.rows[0].id);
    res.json({ tree });
  } catch (err) {
    logger.error({ err }, 'Failed to get page tree');
    res.status(500).json({ error: 'Failed to get page tree' });
  }
});

// Get page by slug
router.get('/space/:spaceKey/slug/:slug', async (req: Request, res: Response) => {
  try {
    const space = await pool.query('SELECT id FROM spaces WHERE key = $1', [
      req.params.spaceKey.toUpperCase(),
    ]);
    if (space.rows.length === 0) {
      res.status(404).json({ error: 'Space not found' });
      return;
    }

    const page = await getPageBySlug(space.rows[0].id, req.params.slug);
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    // Get author info
    const author = await pool.query(
      'SELECT username, display_name FROM users WHERE id = $1',
      [page.created_by],
    );

    // Get labels
    const labels = await getLabels(page.id);

    // Get breadcrumbs
    const breadcrumbs = await getPageBreadcrumbs(page.id);

    res.json({
      page: {
        ...page,
        author: author.rows[0],
        labels,
        breadcrumbs,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get page');
    res.status(500).json({ error: 'Failed to get page' });
  }
});

// Get page by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const page = await getPageById(req.params.id);
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    const author = await pool.query(
      'SELECT username, display_name FROM users WHERE id = $1',
      [page.created_by],
    );

    const labels = await getLabels(page.id);
    const breadcrumbs = await getPageBreadcrumbs(page.id);

    res.json({
      page: {
        ...page,
        author: author.rows[0],
        labels,
        breadcrumbs,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get page');
    res.status(500).json({ error: 'Failed to get page' });
  }
});

// Create page
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { spaceId, title, contentJson, contentHtml, contentText, parentId, status } = req.body;

    if (!spaceId || !title) {
      res.status(400).json({ error: 'Space ID and title are required' });
      return;
    }

    const page = await createPage(
      spaceId,
      title,
      contentJson || {},
      contentHtml || '',
      contentText || '',
      req.session.userId!,
      parentId || null,
      status || 'published',
    );

    res.status(201).json({ page });
  } catch (err) {
    logger.error({ err }, 'Failed to create page');
    res.status(500).json({ error: 'Failed to create page' });
  }
});

// Update page
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { title, contentJson, contentHtml, contentText, changeMessage } = req.body;

    if (!title) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    const page = await updatePage(
      req.params.id,
      title,
      contentJson || {},
      contentHtml || '',
      contentText || '',
      req.session.userId!,
      changeMessage,
    );

    res.json({ page });
  } catch (err) {
    logger.error({ err }, 'Failed to update page');
    res.status(500).json({ error: 'Failed to update page' });
  }
});

// Delete page
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    await deletePage(req.params.id);
    res.json({ message: 'Page deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete page');
    res.status(500).json({ error: 'Failed to delete page' });
  }
});

// Move page
router.post('/:id/move', requireAuth, async (req: Request, res: Response) => {
  try {
    const { parentId, position } = req.body;
    await movePage(req.params.id, parentId || null, position || 0);
    res.json({ message: 'Page moved' });
  } catch (err) {
    logger.error({ err }, 'Failed to move page');
    res.status(500).json({ error: 'Failed to move page' });
  }
});

// Add label
router.post('/:id/labels', requireAuth, async (req: Request, res: Response) => {
  try {
    const { label } = req.body;
    if (!label) {
      res.status(400).json({ error: 'Label is required' });
      return;
    }
    await addLabel(req.params.id, label);
    res.status(201).json({ message: 'Label added' });
  } catch (err) {
    logger.error({ err }, 'Failed to add label');
    res.status(500).json({ error: 'Failed to add label' });
  }
});

// Remove label
router.delete('/:id/labels/:label', requireAuth, async (req: Request, res: Response) => {
  try {
    await removeLabel(req.params.id, req.params.label);
    res.json({ message: 'Label removed' });
  } catch (err) {
    logger.error({ err }, 'Failed to remove label');
    res.status(500).json({ error: 'Failed to remove label' });
  }
});

// Get labels
router.get('/:id/labels', async (req: Request, res: Response) => {
  try {
    const labels = await getLabels(req.params.id);
    res.json({ labels });
  } catch (err) {
    logger.error({ err }, 'Failed to get labels');
    res.status(500).json({ error: 'Failed to get labels' });
  }
});

export default router;
