import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/users/search?q=term
router.get('/search', requireAuth, async (req: Request, res: Response) => {
  try {
    const q = req.query.q as string;

    if (!q || q.length < 2) {
      res.status(400).json({ error: 'Search query must be at least 2 characters' });
      return;
    }

    const result = await pool.query(
      `SELECT id, username, email, display_name
       FROM users
       WHERE (username ILIKE $1 OR email ILIKE $1 OR display_name ILIKE $1)
         AND id != $2
       LIMIT 10`,
      [`%${q}%`, req.session.userId],
    );

    const users = result.rows.map((r) => ({
      id: r.id,
      username: r.username,
      email: r.email,
      displayName: r.display_name,
    }));

    res.json({ users });
  } catch (err) {
    logger.error({ err }, 'User search failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Users router providing search by username, email, or display name. */
export default router;
