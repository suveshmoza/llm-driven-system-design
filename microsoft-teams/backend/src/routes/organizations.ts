import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/organizations - list user's organizations
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT o.*, om.role as member_role
       FROM organizations o
       JOIN org_members om ON o.id = om.org_id
       WHERE om.user_id = $1
       ORDER BY o.name`,
      [req.session.userId],
    );
    res.json({ organizations: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to list organizations');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/organizations - create organization
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orgResult = await client.query(
        `INSERT INTO organizations (name, slug, description, created_by)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [name, slug, description || null, req.session.userId],
      );
      const org = orgResult.rows[0];

      // Add creator as owner
      await client.query(
        `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [org.id, req.session.userId],
      );

      await client.query('COMMIT');
      res.status(201).json({ organization: org });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, 'Failed to create organization');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/organizations/:orgId - get organization details
router.get('/:orgId', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM organizations WHERE id = $1', [
      req.params.orgId,
    ]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }
    res.json({ organization: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to get organization');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/organizations/:orgId/members - list org members
router.get('/:orgId/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, om.role, om.joined_at
       FROM org_members om
       JOIN users u ON om.user_id = u.id
       WHERE om.org_id = $1
       ORDER BY u.display_name`,
      [req.params.orgId],
    );
    res.json({ members: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to list org members');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/organizations/:orgId/members - add member to org
router.post('/:orgId/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId, role } = req.body;

    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    await pool.query(
      `INSERT INTO org_members (org_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, user_id) DO NOTHING`,
      [req.params.orgId, userId, role || 'member'],
    );

    res.status(201).json({ message: 'Member added' });
  } catch (err) {
    logger.error({ err }, 'Failed to add org member');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
