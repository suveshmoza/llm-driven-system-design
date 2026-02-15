import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';

const router = Router();

// List all spaces
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT s.*, u.username as creator_username,
              (SELECT COUNT(*) FROM pages WHERE space_id = s.id) as page_count
       FROM spaces s
       JOIN users u ON u.id = s.created_by
       WHERE s.is_public = true
       ORDER BY s.name ASC`,
    );
    res.json({ spaces: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to list spaces');
    res.status(500).json({ error: 'Failed to list spaces' });
  }
});

// Get space by key
router.get('/:key', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT s.*, u.username as creator_username
       FROM spaces s
       JOIN users u ON u.id = s.created_by
       WHERE s.key = $1`,
      [req.params.key.toUpperCase()],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Space not found' });
      return;
    }

    res.json({ space: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to get space');
    res.status(500).json({ error: 'Failed to get space' });
  }
});

// Create space
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { key, name, description, isPublic } = req.body;

    if (!key || !name) {
      res.status(400).json({ error: 'Key and name are required' });
      return;
    }

    if (key.length > 10 || !/^[A-Z]+$/.test(key.toUpperCase())) {
      res.status(400).json({ error: 'Key must be 1-10 uppercase letters' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO spaces (key, name, description, is_public, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [key.toUpperCase(), name, description || null, isPublic !== false, req.session.userId],
    );

    const space = result.rows[0];

    // Add creator as admin member
    await pool.query(
      `INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [space.id, req.session.userId],
    );

    logger.info({ spaceId: space.id, key }, 'Space created');
    res.status(201).json({ space });
  } catch (err) {
    logger.error({ err }, 'Failed to create space');
    res.status(500).json({ error: 'Failed to create space' });
  }
});

// Update space
router.put('/:key', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, description, isPublic } = req.body;

    const result = await pool.query(
      `UPDATE spaces SET name = COALESCE($1, name), description = COALESCE($2, description),
       is_public = COALESCE($3, is_public), updated_at = NOW()
       WHERE key = $4 RETURNING *`,
      [name, description, isPublic, req.params.key.toUpperCase()],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Space not found' });
      return;
    }

    res.json({ space: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to update space');
    res.status(500).json({ error: 'Failed to update space' });
  }
});

// Delete space
router.delete('/:key', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM spaces WHERE key = $1 RETURNING id',
      [req.params.key.toUpperCase()],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Space not found' });
      return;
    }

    logger.info({ key: req.params.key }, 'Space deleted');
    res.json({ message: 'Space deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete space');
    res.status(500).json({ error: 'Failed to delete space' });
  }
});

// Get space members
router.get('/:key/members', async (req: Request, res: Response) => {
  try {
    const space = await pool.query('SELECT id FROM spaces WHERE key = $1', [req.params.key.toUpperCase()]);
    if (space.rows.length === 0) {
      res.status(404).json({ error: 'Space not found' });
      return;
    }

    const result = await pool.query(
      `SELECT sm.*, u.username, u.display_name, u.email
       FROM space_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.space_id = $1
       ORDER BY sm.role, u.username`,
      [space.rows[0].id],
    );

    res.json({ members: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to get space members');
    res.status(500).json({ error: 'Failed to get members' });
  }
});

// Add member to space
router.post('/:key/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId, role } = req.body;

    const space = await pool.query('SELECT id FROM spaces WHERE key = $1', [req.params.key.toUpperCase()]);
    if (space.rows.length === 0) {
      res.status(404).json({ error: 'Space not found' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO space_members (space_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (space_id, user_id) DO UPDATE SET role = $3
       RETURNING *`,
      [space.rows[0].id, userId, role || 'member'],
    );

    res.status(201).json({ member: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to add member');
    res.status(500).json({ error: 'Failed to add member' });
  }
});

export default router;
