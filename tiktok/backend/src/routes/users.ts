import express, { Request, Response, NextFunction, Router } from 'express';
import { query } from '../db.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { createLogger } from '../shared/logger.js';
import { getRateLimiters } from '../index.js';

const router: Router = express.Router();
const logger = createLogger('users');

// User row type
interface UserRow {
  id: number;
  username: string;
  email?: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  follower_count: number;
  following_count: number;
  video_count: number;
  like_count: number;
  created_at: string;
}

// Helper to get rate limiters
const getLimiters = () => getRateLimiters();

// Get user profile by username
router.get('/:username', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { username } = req.params;

    const result = await query(
      `SELECT id, username, display_name, avatar_url, bio,
              follower_count, following_count, video_count, like_count, created_at
       FROM users WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = result.rows[0] as UserRow;

    // Check if current user follows this user
    let isFollowing = false;
    if (req.session?.userId && req.session.userId !== user.id) {
      const followResult = await query(
        'SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2',
        [req.session.userId, user.id]
      );
      isFollowing = followResult.rows.length > 0;
    }

    res.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      bio: user.bio,
      followerCount: user.follower_count,
      followingCount: user.following_count,
      videoCount: user.video_count,
      likeCount: user.like_count,
      createdAt: user.created_at,
      isFollowing,
      isOwnProfile: req.session?.userId === user.id,
    });
  } catch (error) {
    logger.error({ error: (error as Error).message, username: req.params.username }, 'Get user error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update current user profile
router.patch('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { displayName, bio, avatarUrl } = req.body as {
      displayName?: string;
      bio?: string;
      avatarUrl?: string;
    };
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (displayName !== undefined) {
      updates.push(`display_name = $${paramIndex++}`);
      values.push(displayName);
    }
    if (bio !== undefined) {
      updates.push(`bio = $${paramIndex++}`);
      values.push(bio);
    }
    if (avatarUrl !== undefined) {
      updates.push(`avatar_url = $${paramIndex++}`);
      values.push(avatarUrl);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    values.push(req.session.userId);

    const result = await query(
      `UPDATE users SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, username, email, display_name, avatar_url, bio,
                 follower_count, following_count, video_count, created_at`,
      values
    );

    const user = result.rows[0] as UserRow;

    logger.debug({ userId: req.session.userId, updates: Object.keys(req.body) }, 'User profile updated');

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      bio: user.bio,
      followerCount: user.follower_count,
      followingCount: user.following_count,
      videoCount: user.video_count,
      createdAt: user.created_at,
    });
  } catch (error) {
    logger.error({ error: (error as Error).message, userId: req.session.userId }, 'Update user error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Follow a user
router.post('/:username/follow', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // Apply rate limiting
  const limiters = getLimiters();
  if (limiters?.follow) {
    limiters.follow(req, res, async () => {
      await handleFollow(req, res, next);
    });
    return;
  }
  await handleFollow(req, res, next);
});

async function handleFollow(req: Request, res: Response, _next: NextFunction): Promise<void> {
  try {
    const { username } = req.params;

    // Get target user
    const userResult = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const targetUserId = (userResult.rows[0] as { id: number }).id;

    if (targetUserId === req.session.userId) {
      res.status(400).json({ error: 'Cannot follow yourself' });
      return;
    }

    // Check if already following
    const existingFollow = await query(
      'SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2',
      [req.session.userId, targetUserId]
    );

    if (existingFollow.rows.length > 0) {
      res.status(409).json({ error: 'Already following' });
      return;
    }

    // Create follow
    await query(
      'INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)',
      [req.session.userId, targetUserId]
    );

    // Update counts
    await query(
      'UPDATE users SET follower_count = follower_count + 1 WHERE id = $1',
      [targetUserId]
    );
    await query(
      'UPDATE users SET following_count = following_count + 1 WHERE id = $1',
      [req.session.userId]
    );

    logger.debug({ followerId: req.session.userId, followingId: targetUserId }, 'User followed');

    res.json({ message: 'Followed successfully', isFollowing: true });
  } catch (error) {
    logger.error({ error: (error as Error).message, username: req.params.username }, 'Follow error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Unfollow a user
router.delete('/:username/follow', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // Apply rate limiting
  const limiters = getLimiters();
  if (limiters?.follow) {
    limiters.follow(req, res, async () => {
      await handleUnfollow(req, res, next);
    });
    return;
  }
  await handleUnfollow(req, res, next);
});

async function handleUnfollow(req: Request, res: Response, _next: NextFunction): Promise<void> {
  try {
    const { username } = req.params;

    // Get target user
    const userResult = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const targetUserId = (userResult.rows[0] as { id: number }).id;

    // Delete follow
    const deleteResult = await query(
      'DELETE FROM follows WHERE follower_id = $1 AND following_id = $2 RETURNING id',
      [req.session.userId, targetUserId]
    );

    if (deleteResult.rows.length === 0) {
      res.status(404).json({ error: 'Not following this user' });
      return;
    }

    // Update counts
    await query(
      'UPDATE users SET follower_count = GREATEST(follower_count - 1, 0) WHERE id = $1',
      [targetUserId]
    );
    await query(
      'UPDATE users SET following_count = GREATEST(following_count - 1, 0) WHERE id = $1',
      [req.session.userId]
    );

    logger.debug({ followerId: req.session.userId, followingId: targetUserId }, 'User unfollowed');

    res.json({ message: 'Unfollowed successfully', isFollowing: false });
  } catch (error) {
    logger.error({ error: (error as Error).message, username: req.params.username }, 'Unfollow error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Get user's followers
router.get('/:username/followers', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const userResult = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const result = await query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.follower_count
       FROM follows f
       JOIN users u ON f.follower_id = u.id
       WHERE f.following_id = $1
       ORDER BY f.created_at DESC
       LIMIT $2 OFFSET $3`,
      [(userResult.rows[0] as { id: number }).id, limit, offset]
    );

    res.json({
      followers: result.rows.map((user: UserRow) => ({
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        followerCount: user.follower_count,
      })),
      hasMore: result.rows.length === limit,
    });
  } catch (error) {
    logger.error({ error: (error as Error).message, username: req.params.username }, 'Get followers error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's following
router.get('/:username/following', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const userResult = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const result = await query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.follower_count
       FROM follows f
       JOIN users u ON f.following_id = u.id
       WHERE f.follower_id = $1
       ORDER BY f.created_at DESC
       LIMIT $2 OFFSET $3`,
      [(userResult.rows[0] as { id: number }).id, limit, offset]
    );

    res.json({
      following: result.rows.map((user: UserRow) => ({
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        followerCount: user.follower_count,
      })),
      hasMore: result.rows.length === limit,
    });
  } catch (error) {
    logger.error({ error: (error as Error).message, username: req.params.username }, 'Get following error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
