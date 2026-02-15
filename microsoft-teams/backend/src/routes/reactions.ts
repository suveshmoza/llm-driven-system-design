import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';
import { publishToChannel } from '../services/pubsub.js';

const router = Router();

// POST /api/reactions - add reaction
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { messageId, emoji } = req.body;

    if (!messageId || !emoji) {
      res.status(400).json({ error: 'messageId and emoji are required' });
      return;
    }

    await pool.query(
      `INSERT INTO message_reactions (message_id, user_id, emoji)
       VALUES ($1, $2, $3)
       ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
      [messageId, req.session.userId, emoji],
    );

    // Get the channel_id for broadcasting
    const msgResult = await pool.query('SELECT channel_id FROM messages WHERE id = $1', [
      messageId,
    ]);
    if (msgResult.rows.length > 0) {
      await publishToChannel(msgResult.rows[0].channel_id, 'reaction_added', {
        messageId,
        emoji,
        userId: req.session.userId,
        username: req.session.username,
      });
    }

    res.status(201).json({ message: 'Reaction added' });
  } catch (err) {
    logger.error({ err }, 'Failed to add reaction');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/reactions - remove reaction
router.delete('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { messageId, emoji } = req.body;

    if (!messageId || !emoji) {
      res.status(400).json({ error: 'messageId and emoji are required' });
      return;
    }

    await pool.query(
      `DELETE FROM message_reactions
       WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
      [messageId, req.session.userId, emoji],
    );

    // Get the channel_id for broadcasting
    const msgResult = await pool.query('SELECT channel_id FROM messages WHERE id = $1', [
      messageId,
    ]);
    if (msgResult.rows.length > 0) {
      await publishToChannel(msgResult.rows[0].channel_id, 'reaction_removed', {
        messageId,
        emoji,
        userId: req.session.userId,
        username: req.session.username,
      });
    }

    res.json({ message: 'Reaction removed' });
  } catch (err) {
    logger.error({ err }, 'Failed to remove reaction');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
