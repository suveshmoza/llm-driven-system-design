import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/users/search?q=xxx - search users
router.get('/search', requireAuth, async (req: Request, res: Response) => {
  try {
    const { q } = req.query;

    if (!q || (q as string).length < 2) {
      res.status(400).json({ error: 'Search query must be at least 2 characters' });
      return;
    }

    const result = await pool.query(
      `SELECT id, username, display_name, avatar_url
       FROM users
       WHERE username ILIKE $1 OR display_name ILIKE $1
       ORDER BY username
       LIMIT 20`,
      [`%${q}%`],
    );

    res.json({ users: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to search users');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:userId - get user profile
router.get('/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, display_name, avatar_url, role, created_at FROM users WHERE id = $1',
      [req.params.userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to get user');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
