import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/teams?orgId=xxx - list teams in org
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { orgId } = req.query;

    if (!orgId) {
      res.status(400).json({ error: 'orgId query parameter is required' });
      return;
    }

    const result = await pool.query(
      `SELECT t.*, tm.role as member_role
       FROM teams t
       LEFT JOIN team_members tm ON t.id = tm.team_id AND tm.user_id = $2
       WHERE t.org_id = $1 AND (t.is_private = false OR tm.user_id IS NOT NULL)
       ORDER BY t.name`,
      [orgId, req.session.userId],
    );
    res.json({ teams: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to list teams');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/teams - create team
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { orgId, name, description, isPrivate } = req.body;

    if (!orgId || !name) {
      res.status(400).json({ error: 'orgId and name are required' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const teamResult = await client.query(
        `INSERT INTO teams (org_id, name, description, is_private, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [orgId, name, description || null, isPrivate || false, req.session.userId],
      );
      const team = teamResult.rows[0];

      // Add creator as owner
      await client.query(
        `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [team.id, req.session.userId],
      );

      // Create default "General" channel
      const channelResult = await client.query(
        `INSERT INTO channels (team_id, name, description, created_by)
         VALUES ($1, 'General', 'General discussion', $2) RETURNING *`,
        [team.id, req.session.userId],
      );
      const channel = channelResult.rows[0];

      // Add creator to the default channel
      await client.query(
        `INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)`,
        [channel.id, req.session.userId],
      );

      await client.query('COMMIT');
      res.status(201).json({ team, defaultChannel: channel });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, 'Failed to create team');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/teams/:teamId - get team details
router.get('/:teamId', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM teams WHERE id = $1', [req.params.teamId]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    res.json({ team: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to get team');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/teams/:teamId/members - list team members
router.get('/:teamId/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, tm.role, tm.joined_at
       FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = $1
       ORDER BY u.display_name`,
      [req.params.teamId],
    );
    res.json({ members: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to list team members');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/teams/:teamId/members - add member to team
router.post('/:teamId/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId, role } = req.body;

    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    await pool.query(
      `INSERT INTO team_members (team_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (team_id, user_id) DO NOTHING`,
      [req.params.teamId, userId, role || 'member'],
    );

    res.status(201).json({ message: 'Member added' });
  } catch (err) {
    logger.error({ err }, 'Failed to add team member');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
