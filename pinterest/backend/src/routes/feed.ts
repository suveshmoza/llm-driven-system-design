import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getFeed, getDiscoverFeed } from '../services/feedService.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/v1/feed - Personalized feed for authenticated users
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const cursor = req.query.cursor as string | undefined;

    const { pins, nextCursor } = await getFeed(req.session.userId!, limit, cursor);

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
        linkUrl: p.link_url,
        saveCount: p.save_count,
        commentCount: p.comment_count,
        createdAt: p.created_at,
      })),
      nextCursor,
    });
  } catch (err) {
    logger.error({ err }, 'Get feed error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/feed/discover - Discover/explore feed (public)
router.get('/discover', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const cursor = req.query.cursor as string | undefined;

    const { pins, nextCursor } = await getDiscoverFeed(limit, cursor);

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
        linkUrl: p.link_url,
        saveCount: p.save_count,
        commentCount: p.comment_count,
        createdAt: p.created_at,
      })),
      nextCursor,
    });
  } catch (err) {
    logger.error({ err }, 'Get discover feed error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
