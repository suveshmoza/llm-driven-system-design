import { Router, Request, Response } from 'express';
import { searchPages } from '../services/searchService.js';
import { pool } from '../services/db.js';
import { logger } from '../services/logger.js';

const router = Router();

// Search pages
router.get('/', async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;
    const spaceKey = req.query.space as string;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;

    if (!query) {
      res.status(400).json({ error: 'Search query (q) is required' });
      return;
    }

    let spaceId: string | undefined;
    if (spaceKey) {
      const space = await pool.query('SELECT id FROM spaces WHERE key = $1', [spaceKey.toUpperCase()]);
      if (space.rows.length > 0) {
        spaceId = space.rows[0].id;
      }
    }

    const results = await searchPages(query, spaceId, page, pageSize);
    res.json(results);
  } catch (err) {
    logger.error({ err }, 'Search failed');
    res.status(500).json({ error: 'Search failed' });
  }
});

export default router;
