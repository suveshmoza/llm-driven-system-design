import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { followRateLimiter } from '../services/rateLimiter.js';
import { query } from '../services/db.js';
import { cacheDel } from '../services/redis.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/v1/users/:username
router.get('/:username', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, username, display_name, avatar_url, bio, follower_count, following_count, created_at
       FROM users WHERE username = $1`,
      [req.params.username],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = result.rows[0];

    // Check if current user follows this user
    let isFollowing = false;
    if (req.session?.userId && req.session.userId !== user.id) {
      const followResult = await query(
        `SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2`,
        [req.session.userId, user.id],
      );
      isFollowing = followResult.rows.length > 0;
    }

    res.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        followerCount: user.follower_count,
        followingCount: user.following_count,
        isFollowing,
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Get user error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/users/:username/pins
router.get('/:username/pins', async (req: Request, res: Response) => {
  try {
    const userResult = await query(
      `SELECT id FROM users WHERE username = $1`,
      [req.params.username],
    );

    if (userResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const userId = userResult.rows[0].id;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const cursor = req.query.cursor as string | undefined;

    let result;
    if (cursor) {
      result = await query(
        `SELECT p.*, u.username, u.display_name, u.avatar_url
         FROM pins p
         JOIN users u ON u.id = p.user_id
         WHERE p.user_id = $1 AND p.status = 'published' AND p.created_at < $3
         ORDER BY p.created_at DESC
         LIMIT $2`,
        [userId, limit + 1, cursor],
      );
    } else {
      result = await query(
        `SELECT p.*, u.username, u.display_name, u.avatar_url
         FROM pins p
         JOIN users u ON u.id = p.user_id
         WHERE p.user_id = $1 AND p.status = 'published'
         ORDER BY p.created_at DESC
         LIMIT $2`,
        [userId, limit + 1],
      );
    }

    const pins = result.rows;
    let nextCursor: string | null = null;

    if (pins.length > limit) {
      nextCursor = pins[limit - 1].created_at.toISOString();
      pins.splice(limit);
    }

    res.json({
      pins: pins.map((p) => ({
        id: p.id,
        userId: p.user_id,
        username: p.username,
        displayName: p.display_name,
        avatarUrl: p.avatar_url,
        title: p.title,
        description: p.description,
        imageUrl: p.image_url,
        imageWidth: p.image_width,
        imageHeight: p.image_height,
        aspectRatio: p.aspect_ratio,
        dominantColor: p.dominant_color,
        saveCount: p.save_count,
        createdAt: p.created_at,
      })),
      nextCursor,
    });
  } catch (err) {
    logger.error({ err }, 'Get user pins error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/users/:username/boards
router.get('/:username/boards', async (req: Request, res: Response) => {
  try {
    const userResult = await query(
      `SELECT id FROM users WHERE username = $1`,
      [req.params.username],
    );

    if (userResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const userId = userResult.rows[0].id;
    const showPrivate = req.session?.userId === userId;

    const result = await query(
      `SELECT b.*,
        (SELECT p.image_url FROM board_pins bp JOIN pins p ON p.id = bp.pin_id
         WHERE bp.board_id = b.id AND p.status = 'published'
         ORDER BY bp.position DESC LIMIT 1) as cover_image_url
       FROM boards b
       WHERE b.user_id = $1 ${showPrivate ? '' : "AND b.is_private = false"}
       ORDER BY b.updated_at DESC`,
      [userId],
    );

    res.json({
      boards: result.rows.map((b) => ({
        id: b.id,
        userId: b.user_id,
        name: b.name,
        description: b.description,
        isPrivate: b.is_private,
        pinCount: b.pin_count,
        coverImageUrl: b.cover_image_url,
        createdAt: b.created_at,
        updatedAt: b.updated_at,
      })),
    });
  } catch (err) {
    logger.error({ err }, 'Get user boards error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/users/:username/followers
router.get('/:username/followers', async (req: Request, res: Response) => {
  try {
    const userResult = await query(
      `SELECT id FROM users WHERE username = $1`,
      [req.params.username],
    );

    if (userResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const userId = userResult.rows[0].id;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    const result = await query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.follower_count
       FROM follows f
       JOIN users u ON u.id = f.follower_id
       WHERE f.following_id = $1
       ORDER BY f.created_at DESC
       LIMIT $2`,
      [userId, limit],
    );

    res.json({
      followers: result.rows.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        avatarUrl: u.avatar_url,
        followerCount: u.follower_count,
      })),
    });
  } catch (err) {
    logger.error({ err }, 'Get followers error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/users/:username/following
router.get('/:username/following', async (req: Request, res: Response) => {
  try {
    const userResult = await query(
      `SELECT id FROM users WHERE username = $1`,
      [req.params.username],
    );

    if (userResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const userId = userResult.rows[0].id;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    const result = await query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.follower_count
       FROM follows f
       JOIN users u ON u.id = f.following_id
       WHERE f.follower_id = $1
       ORDER BY f.created_at DESC
       LIMIT $2`,
      [userId, limit],
    );

    res.json({
      following: result.rows.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        avatarUrl: u.avatar_url,
        followerCount: u.follower_count,
      })),
    });
  } catch (err) {
    logger.error({ err }, 'Get following error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/users/:userId/follow
router.post('/:userId/follow', requireAuth, followRateLimiter, async (req: Request, res: Response) => {
  try {
    const targetUserId = req.params.userId;

    if (targetUserId === req.session.userId) {
      res.status(400).json({ error: 'Cannot follow yourself' });
      return;
    }

    // Check if target user exists
    const userCheck = await query(`SELECT id FROM users WHERE id = $1`, [targetUserId]);
    if (userCheck.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    await query(
      `INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.session.userId, targetUserId],
    );

    await query(`UPDATE users SET following_count = following_count + 1 WHERE id = $1`, [req.session.userId]);
    await query(`UPDATE users SET follower_count = follower_count + 1 WHERE id = $1`, [targetUserId]);

    await cacheDel(`feed:${req.session.userId}`);

    res.json({ message: 'Followed successfully' });
  } catch (err) {
    logger.error({ err }, 'Follow error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/v1/users/:userId/follow
router.delete('/:userId/follow', requireAuth, async (req: Request, res: Response) => {
  try {
    const targetUserId = req.params.userId;

    const result = await query(
      `DELETE FROM follows WHERE follower_id = $1 AND following_id = $2`,
      [req.session.userId, targetUserId],
    );

    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'Not following this user' });
      return;
    }

    await query(`UPDATE users SET following_count = GREATEST(following_count - 1, 0) WHERE id = $1`, [req.session.userId]);
    await query(`UPDATE users SET follower_count = GREATEST(follower_count - 1, 0) WHERE id = $1`, [targetUserId]);

    await cacheDel(`feed:${req.session.userId}`);

    res.json({ message: 'Unfollowed successfully' });
  } catch (err) {
    logger.error({ err }, 'Unfollow error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
