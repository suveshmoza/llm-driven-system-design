import express, { Request, Response, Router } from 'express';
import { query, getClient } from '../services/database.js';
import { getSession, getRedisClient } from '../services/redis.js';
import { logger } from '../utils/logger.js';
import { incSubscription } from '../utils/metrics.js';
import { checkSubscriptionIdempotency, storeSubscriptionResult } from '../utils/idempotency.js';
import { withRetry } from '../utils/retry.js';

const router: Router = express.Router();

interface ChannelRow {
  id: number;
  name: string;
  title: string;
  description: string | null;
  is_live: boolean;
  current_viewers: number;
  follower_count: number;
  subscriber_count: number;
  thumbnail_url: string | null;
  offline_banner_url: string | null;
  stream_key: string;
  user_id: number;
  created_at: Date;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  category_id: number | null;
  category_name: string | null;
  category_slug: string | null;
}

interface ChannelListRow {
  id: number;
  name: string;
  title: string;
  is_live: boolean;
  current_viewers: number;
  follower_count: number;
  thumbnail_url: string | null;
  username: string;
  display_name: string;
  avatar_url: string | null;
  category_name: string | null;
  category_slug: string | null;
}

interface ChannelParams {
  name: string;
}

interface ChannelQuery {
  category?: string;
  limit?: string;
  offset?: string;
}

interface UpdateChannelBody {
  title?: string;
  description?: string;
  categoryId?: number;
}

interface SubscribeBody {
  tier?: number;
}

// Get all live channels
router.get('/', async (req: Request<object, object, object, ChannelQuery>, res: Response): Promise<void> => {
  try {
    const { category, limit = '20', offset = '0' } = req.query;

    let sql = `
      SELECT c.id, c.name, c.title, c.is_live, c.current_viewers,
             c.follower_count, c.thumbnail_url,
             u.username, u.display_name, u.avatar_url,
             cat.name as category_name, cat.slug as category_slug
      FROM channels c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN categories cat ON c.category_id = cat.id
    `;

    const params: (string | number)[] = [];
    const conditions: string[] = [];

    if (category) {
      params.push(category);
      conditions.push(`cat.slug = $${params.length}`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY c.is_live DESC, c.current_viewers DESC';

    params.push(parseInt(limit));
    sql += ` LIMIT $${params.length}`;

    params.push(parseInt(offset));
    sql += ` OFFSET $${params.length}`;

    const result = await query<ChannelListRow>(sql, params);

    res.json({
      channels: result.rows.map(row => ({
        id: row.id,
        name: row.name,
        title: row.title,
        isLive: row.is_live,
        viewerCount: row.current_viewers,
        followerCount: row.follower_count,
        thumbnailUrl: row.thumbnail_url,
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
    logger.error({ error: (error as Error).message }, 'Get channels error');
    res.status(500).json({ error: 'Failed to get channels' });
  }
});

// Get live channels only
router.get('/live', async (req: Request<object, object, object, { limit?: string; offset?: string }>, res: Response): Promise<void> => {
  try {
    const { limit = '20', offset = '0' } = req.query;

    const result = await query<ChannelListRow>(`
      SELECT c.id, c.name, c.title, c.is_live, c.current_viewers,
             c.follower_count, c.thumbnail_url,
             u.username, u.display_name, u.avatar_url,
             cat.name as category_name, cat.slug as category_slug
      FROM channels c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN categories cat ON c.category_id = cat.id
      WHERE c.is_live = TRUE
      ORDER BY c.current_viewers DESC
      LIMIT $1 OFFSET $2
    `, [parseInt(limit), parseInt(offset)]);

    res.json({
      channels: result.rows.map(row => ({
        id: row.id,
        name: row.name,
        title: row.title,
        isLive: row.is_live,
        viewerCount: row.current_viewers,
        followerCount: row.follower_count,
        thumbnailUrl: row.thumbnail_url,
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
    logger.error({ error: (error as Error).message }, 'Get live channels error');
    res.status(500).json({ error: 'Failed to get live channels' });
  }
});

// Get single channel by name
router.get('/:name', async (req: Request<ChannelParams>, res: Response): Promise<void> => {
  try {
    const { name } = req.params;

    const result = await query<ChannelRow>(`
      SELECT c.id, c.name, c.title, c.description, c.is_live, c.current_viewers,
             c.follower_count, c.subscriber_count, c.thumbnail_url, c.offline_banner_url,
             c.stream_key, c.user_id, c.created_at,
             u.username, u.display_name, u.avatar_url, u.bio,
             cat.id as category_id, cat.name as category_name, cat.slug as category_slug
      FROM channels c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN categories cat ON c.category_id = cat.id
      WHERE c.name = $1
    `, [name]);

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const row = result.rows[0];

    // Check if current user follows this channel
    let isFollowing = false;
    let isSubscribed = false;

    const sessionId = req.cookies.session as string | undefined;
    if (sessionId) {
      const userId = await getSession(sessionId);
      if (userId) {
        const followCheck = await query(
          'SELECT 1 FROM followers WHERE user_id = $1 AND channel_id = $2',
          [userId, row.id]
        );
        isFollowing = followCheck.rows.length > 0;

        const subCheck = await query<{ tier: number }>(
          'SELECT tier FROM subscriptions WHERE user_id = $1 AND channel_id = $2 AND expires_at > NOW()',
          [userId, row.id]
        );
        isSubscribed = subCheck.rows.length > 0;
      }
    }

    res.json({
      channel: {
        id: row.id,
        name: row.name,
        title: row.title,
        description: row.description,
        isLive: row.is_live,
        viewerCount: row.current_viewers,
        followerCount: row.follower_count,
        subscriberCount: row.subscriber_count,
        thumbnailUrl: row.thumbnail_url,
        offlineBannerUrl: row.offline_banner_url,
        createdAt: row.created_at,
        user: {
          id: row.user_id,
          username: row.username,
          displayName: row.display_name,
          avatarUrl: row.avatar_url,
          bio: row.bio
        },
        category: row.category_id ? {
          id: row.category_id,
          name: row.category_name,
          slug: row.category_slug
        } : null,
        isFollowing,
        isSubscribed
      }
    });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Get channel error');
    res.status(500).json({ error: 'Failed to get channel' });
  }
});

// Follow a channel
router.post('/:name/follow', async (req: Request<ChannelParams>, res: Response): Promise<void> => {
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

    const { name } = req.params;

    const channelResult = await query<{ id: number }>('SELECT id FROM channels WHERE name = $1', [name]);
    if (channelResult.rows.length === 0) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const channelId = channelResult.rows[0].id;

    // Check if already following
    const existing = await query(
      'SELECT 1 FROM followers WHERE user_id = $1 AND channel_id = $2',
      [userId, channelId]
    );

    if (existing.rows.length > 0) {
      res.json({ success: true, message: 'Already following' });
      return;
    }

    await query(
      'INSERT INTO followers (user_id, channel_id) VALUES ($1, $2)',
      [userId, channelId]
    );

    await query(
      'UPDATE channels SET follower_count = follower_count + 1 WHERE id = $1',
      [channelId]
    );

    logger.info({ user_id: userId, channel_id: channelId }, 'User followed channel');
    res.json({ success: true });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Follow channel error');
    res.status(500).json({ error: 'Failed to follow channel' });
  }
});

// Unfollow a channel
router.delete('/:name/follow', async (req: Request<ChannelParams>, res: Response): Promise<void> => {
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

    const { name } = req.params;

    const channelResult = await query<{ id: number }>('SELECT id FROM channels WHERE name = $1', [name]);
    if (channelResult.rows.length === 0) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const channelId = channelResult.rows[0].id;

    const result = await query<{ id: number }>(
      'DELETE FROM followers WHERE user_id = $1 AND channel_id = $2 RETURNING id',
      [userId, channelId]
    );

    if (result.rows.length > 0) {
      await query(
        'UPDATE channels SET follower_count = GREATEST(0, follower_count - 1) WHERE id = $1',
        [channelId]
      );
    }

    logger.info({ user_id: userId, channel_id: channelId }, 'User unfollowed channel');
    res.json({ success: true });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Unfollow channel error');
    res.status(500).json({ error: 'Failed to unfollow channel' });
  }
});

// Subscribe to a channel (with idempotency support)
router.post('/:name/subscribe', async (req: Request<ChannelParams, object, SubscribeBody>, res: Response): Promise<void> => {
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

    const { name } = req.params;
    const { tier = 1 } = req.body;

    // Check for idempotency key (to prevent double-charging)
    const idempotencyKey = req.idempotencyKey;
    if (idempotencyKey) {
      const redis = getRedisClient();
      const { isDuplicate, cachedResult } = await checkSubscriptionIdempotency(redis, idempotencyKey);

      if (isDuplicate && cachedResult) {
        logger.info({
          idempotency_key: idempotencyKey,
          user_id: userId
        }, 'Returning cached subscription result');
        res.json(cachedResult);
        return;
      }
    }

    const channelResult = await query<{ id: number }>('SELECT id FROM channels WHERE name = $1', [name]);
    if (channelResult.rows.length === 0) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const channelId = channelResult.rows[0].id;

    // Check if already subscribed
    const existing = await query(
      'SELECT id FROM subscriptions WHERE user_id = $1 AND channel_id = $2 AND expires_at > NOW()',
      [userId, channelId]
    );

    if (existing.rows.length > 0) {
      const result = { success: true, message: 'Already subscribed' };

      // Cache result for idempotency
      if (idempotencyKey) {
        const redis = getRedisClient();
        await storeSubscriptionResult(redis, idempotencyKey, result);
      }

      res.json(result);
      return;
    }

    // Create subscription (expires in 30 days) with retry logic
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Use retry for the subscription creation (handles transient failures)
    await withRetry(async () => {
      const client = await getClient();
      try {
        await client.query('BEGIN');

        await client.query(`
          INSERT INTO subscriptions (user_id, channel_id, tier, expires_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id, channel_id)
          DO UPDATE SET tier = $3, expires_at = $4, started_at = NOW()
        `, [userId, channelId, tier, expiresAt]);

        await client.query(
          'UPDATE channels SET subscriber_count = subscriber_count + 1 WHERE id = $1',
          [channelId]
        );

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }, { maxRetries: 3 });

    const result = { success: true, expiresAt, tier };

    // Cache result for idempotency
    if (idempotencyKey) {
      const redis = getRedisClient();
      await storeSubscriptionResult(redis, idempotencyKey, result);
    }

    // Update metrics
    incSubscription(tier);

    logger.info({
      user_id: userId,
      channel_id: channelId,
      tier,
      expires_at: expiresAt,
      idempotency_key: idempotencyKey
    }, 'User subscribed to channel');

    res.json(result);
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Subscribe channel error');
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// Update channel (for owner)
router.patch('/:name', async (req: Request<ChannelParams, object, UpdateChannelBody>, res: Response): Promise<void> => {
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

    const { name } = req.params;
    const { title, description, categoryId } = req.body;

    // Check ownership
    const channelResult = await query<{ id: number }>(
      'SELECT id FROM channels WHERE name = $1 AND user_id = $2',
      [name, userId]
    );

    if (channelResult.rows.length === 0) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    const updates: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (title !== undefined) {
      params.push(title);
      updates.push(`title = $${paramIndex++}`);
    }

    if (description !== undefined) {
      params.push(description);
      updates.push(`description = $${paramIndex++}`);
    }

    if (categoryId !== undefined) {
      params.push(categoryId);
      updates.push(`category_id = $${paramIndex++}`);
    }

    if (updates.length === 0) {
      res.json({ success: true, message: 'Nothing to update' });
      return;
    }

    params.push(channelResult.rows[0].id);
    await query(`
      UPDATE channels
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${paramIndex}
    `, params);

    logger.info({ user_id: userId, channel_name: name }, 'Channel updated');
    res.json({ success: true });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Update channel error');
    res.status(500).json({ error: 'Failed to update channel' });
  }
});

export default router;
