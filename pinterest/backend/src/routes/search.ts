import { Router, Request, Response } from 'express';
import { searchRateLimiter } from '../services/rateLimiter.js';
import { searchPins } from '../services/pinService.js';
import { query } from '../services/db.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/v1/search/pins
router.get('/pins', searchRateLimiter, async (req: Request, res: Response) => {
  try {
    const q = req.query.q as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const offset = parseInt(req.query.offset as string) || 0;

    if (!q || q.trim().length < 2) {
      res.json({ pins: [], total: 0 });
      return;
    }

    const pins = await searchPins(q.trim(), limit, offset);

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
    });
  } catch (err) {
    logger.error({ err }, 'Search pins error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/search/users
router.get('/users', searchRateLimiter, async (req: Request, res: Response) => {
  try {
    const q = req.query.q as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    if (!q || q.trim().length < 2) {
      res.json({ users: [] });
      return;
    }

    const result = await query(
      `SELECT id, username, display_name, avatar_url, follower_count
       FROM users
       WHERE username ILIKE $1 OR display_name ILIKE $1
       ORDER BY follower_count DESC
       LIMIT $2`,
      [`%${q.trim()}%`, limit],
    );

    res.json({
      users: result.rows.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        avatarUrl: u.avatar_url,
        followerCount: u.follower_count,
      })),
    });
  } catch (err) {
    logger.error({ err }, 'Search users error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/search/boards
router.get('/boards', searchRateLimiter, async (req: Request, res: Response) => {
  try {
    const q = req.query.q as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    if (!q || q.trim().length < 2) {
      res.json({ boards: [] });
      return;
    }

    const result = await query(
      `SELECT b.*, u.username, u.display_name
       FROM boards b
       JOIN users u ON u.id = b.user_id
       WHERE b.is_private = false AND (b.name ILIKE $1 OR b.description ILIKE $1)
       ORDER BY b.pin_count DESC
       LIMIT $2`,
      [`%${q.trim()}%`, limit],
    );

    res.json({
      boards: result.rows.map((b) => ({
        id: b.id,
        userId: b.user_id,
        username: b.username,
        displayName: b.display_name,
        name: b.name,
        description: b.description,
        pinCount: b.pin_count,
        createdAt: b.created_at,
      })),
    });
  } catch (err) {
    logger.error({ err }, 'Search boards error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
