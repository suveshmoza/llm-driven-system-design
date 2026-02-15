import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { pool } from '../services/db.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/users/search?q= - Search users to send money to
router.get('/search', requireAuth, async (req: Request, res: Response) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string' || q.length < 2) {
      res.json({ users: [] });
      return;
    }

    const result = await pool.query(
      `SELECT id, username, display_name, email
       FROM users
       WHERE id != $1
         AND (username ILIKE $2 OR display_name ILIKE $2 OR email ILIKE $2)
       LIMIT 10`,
      [req.session.userId, `%${q}%`],
    );

    const users = result.rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
    }));

    res.json({ users });
  } catch (err) {
    logger.error({ err }, 'User search failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Users router providing search by username, display name, or email. */
export default router;
