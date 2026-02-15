import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/videos/:videoId/comments - List comments for a video
router.get('/:videoId/comments', async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params;

    const result = await pool.query(
      `SELECT c.*, u.username, u.display_name, u.avatar_url
       FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.video_id = $1
       ORDER BY c.created_at ASC`,
      [videoId],
    );

    const comments = result.rows.map((row) => ({
      id: row.id,
      videoId: row.video_id,
      userId: row.user_id,
      content: row.content,
      timestampSeconds: row.timestamp_seconds,
      parentId: row.parent_id,
      createdAt: row.created_at,
      author: {
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
      },
    }));

    res.json({ comments });
  } catch (err) {
    logger.error({ err }, 'Failed to list comments');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/videos/:videoId/comments - Create a comment
router.post('/:videoId/comments', requireAuth, async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params;
    const { content, timestampSeconds, parentId } = req.body;
    const userId = req.session.userId;

    if (!content || content.trim().length === 0) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }

    // Verify video exists
    const video = await pool.query('SELECT id FROM videos WHERE id = $1', [videoId]);
    if (video.rows.length === 0) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    // Verify parent comment exists if specified
    if (parentId) {
      const parent = await pool.query(
        'SELECT id FROM comments WHERE id = $1 AND video_id = $2',
        [parentId, videoId],
      );
      if (parent.rows.length === 0) {
        res.status(404).json({ error: 'Parent comment not found' });
        return;
      }
    }

    const result = await pool.query(
      `INSERT INTO comments (video_id, user_id, content, timestamp_seconds, parent_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [videoId, userId, content.trim(), timestampSeconds ?? null, parentId || null],
    );

    // Fetch author info
    const user = await pool.query(
      'SELECT username, display_name, avatar_url FROM users WHERE id = $1',
      [userId],
    );

    const comment = result.rows[0];
    res.status(201).json({
      comment: {
        id: comment.id,
        videoId: comment.video_id,
        userId: comment.user_id,
        content: comment.content,
        timestampSeconds: comment.timestamp_seconds,
        parentId: comment.parent_id,
        createdAt: comment.created_at,
        author: {
          username: user.rows[0].username,
          displayName: user.rows[0].display_name,
          avatarUrl: user.rows[0].avatar_url,
        },
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to create comment');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/videos/:videoId/comments/:commentId - Delete comment
router.delete('/:videoId/comments/:commentId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { commentId } = req.params;
    const userId = req.session.userId;

    const result = await pool.query(
      'DELETE FROM comments WHERE id = $1 AND user_id = $2 RETURNING id',
      [commentId, userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }

    res.json({ message: 'Comment deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete comment');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
