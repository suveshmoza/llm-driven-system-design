import express, { Request, Response, Router } from 'express';
import { query } from '../services/database.js';
import { getSession } from '../services/redis.js';

const router: Router = express.Router();

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  created_at: Date;
  channel_id: number | null;
  follower_count: number | null;
  subscriber_count: number | null;
  is_live: boolean | null;
}

interface FollowingRow {
  id: number;
  name: string;
  title: string;
  is_live: boolean;
  current_viewers: number;
  thumbnail_url: string | null;
  followed_at: Date;
  username: string;
  display_name: string;
  avatar_url: string | null;
  category_name: string | null;
  category_slug: string | null;
}

interface UserParams {
  username: string;
}

interface PaginationQuery {
  limit?: string;
  offset?: string;
}

interface UpdateProfileBody {
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
}

// Get user profile
router.get('/:username', async (req: Request<UserParams>, res: Response): Promise<void> => {
  try {
    const { username } = req.params;

    const result = await query<UserRow>(`
      SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.created_at,
             c.id as channel_id, c.follower_count, c.subscriber_count, c.is_live
      FROM users u
      LEFT JOIN channels c ON c.user_id = u.id
      WHERE u.username = $1
    `, [username]);

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const row = result.rows[0];
    res.json({
      user: {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        bio: row.bio,
        createdAt: row.created_at,
        channel: row.channel_id ? {
          id: row.channel_id,
          followerCount: row.follower_count,
          subscriberCount: row.subscriber_count,
          isLive: row.is_live
        } : null
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Get user's followed channels
router.get('/:username/following', async (req: Request<UserParams, object, object, PaginationQuery>, res: Response): Promise<void> => {
  try {
    const { username } = req.params;
    const { limit = '20', offset = '0' } = req.query;

    const userResult = await query<{ id: number }>('SELECT id FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const userId = userResult.rows[0].id;

    const result = await query<FollowingRow>(`
      SELECT c.id, c.name, c.title, c.is_live, c.current_viewers,
             c.thumbnail_url, f.followed_at,
             u.username, u.display_name, u.avatar_url,
             cat.name as category_name, cat.slug as category_slug
      FROM followers f
      JOIN channels c ON f.channel_id = c.id
      JOIN users u ON c.user_id = u.id
      LEFT JOIN categories cat ON c.category_id = cat.id
      WHERE f.user_id = $1
      ORDER BY c.is_live DESC, f.followed_at DESC
      LIMIT $2 OFFSET $3
    `, [userId, parseInt(limit), parseInt(offset)]);

    res.json({
      following: result.rows.map(row => ({
        id: row.id,
        name: row.name,
        title: row.title,
        isLive: row.is_live,
        viewerCount: row.current_viewers,
        thumbnailUrl: row.thumbnail_url,
        followedAt: row.followed_at,
        user: {
          username: row.username,
          displayName: row.display_name,
          avatarUrl: row.avatar_url
        },
        category: row.category_name ? {
          name: row.category_name,
          slug: row.category_slug
        } : null
      }))
    });
  } catch (error) {
    console.error('Get following error:', error);
    res.status(500).json({ error: 'Failed to get following' });
  }
});

// Update user profile
router.patch('/me', async (req: Request<object, object, UpdateProfileBody>, res: Response): Promise<void> => {
  try {
    const sessionId = req.cookies.session as string | undefined;
    if (!sessionId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const userId = await getSession(sessionId);
    if (!userId) {
      res.status(401).json({ error: 'Session expired' });
      return;
    }

    const { displayName, bio, avatarUrl } = req.body;

    const updates: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (displayName !== undefined) {
      params.push(displayName);
      updates.push(`display_name = $${paramIndex++}`);
    }

    if (bio !== undefined) {
      params.push(bio);
      updates.push(`bio = $${paramIndex++}`);
    }

    if (avatarUrl !== undefined) {
      params.push(avatarUrl);
      updates.push(`avatar_url = $${paramIndex++}`);
    }

    if (updates.length === 0) {
      res.json({ success: true, message: 'Nothing to update' });
      return;
    }

    params.push(userId);
    await query(`
      UPDATE users
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${paramIndex}
    `, params);

    res.json({ success: true });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

export default router;
