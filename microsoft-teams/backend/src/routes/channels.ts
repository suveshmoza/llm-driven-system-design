import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/channels?teamId=xxx - list channels in team
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { teamId } = req.query;

    if (!teamId) {
      res.status(400).json({ error: 'teamId query parameter is required' });
      return;
    }

    const result = await pool.query(
      `SELECT c.*, cm.user_id IS NOT NULL as is_member
       FROM channels c
       LEFT JOIN channel_members cm ON c.id = cm.channel_id AND cm.user_id = $2
       WHERE c.team_id = $1 AND (c.is_private = false OR cm.user_id IS NOT NULL)
       ORDER BY c.name`,
      [teamId, req.session.userId],
    );
    res.json({ channels: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to list channels');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/channels - create channel
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { teamId, name, description, isPrivate } = req.body;

    if (!teamId || !name) {
      res.status(400).json({ error: 'teamId and name are required' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO channels (team_id, name, description, is_private, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [teamId, name, description || null, isPrivate || false, req.session.userId],
      );
      const channel = result.rows[0];

      // Add creator as member
      await client.query(
        `INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)`,
        [channel.id, req.session.userId],
      );

      await client.query('COMMIT');
      res.status(201).json({ channel });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, 'Failed to create channel');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/channels/:channelId - get channel details
router.get('/:channelId', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM channels WHERE id = $1', [
      req.params.channelId,
    ]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }
    res.json({ channel: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to get channel');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/channels/:channelId/members - list channel members
router.get('/:channelId/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, cm.last_read_at, cm.joined_at
       FROM channel_members cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.channel_id = $1
       ORDER BY u.display_name`,
      [req.params.channelId],
    );
    res.json({ members: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to list channel members');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/channels/:channelId/members - add member to channel
router.post('/:channelId/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    await pool.query(
      `INSERT INTO channel_members (channel_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (channel_id, user_id) DO NOTHING`,
      [req.params.channelId, userId],
    );

    res.status(201).json({ message: 'Member added' });
  } catch (err) {
    logger.error({ err }, 'Failed to add channel member');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/channels/:channelId/read - mark channel as read
router.post('/:channelId/read', requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query(
      `UPDATE channel_members SET last_read_at = NOW()
       WHERE channel_id = $1 AND user_id = $2`,
      [req.params.channelId, req.session.userId],
    );
    res.json({ message: 'Channel marked as read' });
  } catch (err) {
    logger.error({ err }, 'Failed to mark channel as read');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
