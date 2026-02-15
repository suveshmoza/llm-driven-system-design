import { query } from './db.js';
import { cacheGet, cacheSet } from './redis.js';
import { feedCacheHits, feedCacheMisses, feedGenerationDuration } from './metrics.js';
import { logger } from './logger.js';
import { PinRow } from './pinService.js';

/**
 * Get the feed for a user: pins from followed users + popular pins.
 * Uses a simple pull model (fetch on read) with caching.
 */
export async function getFeed(
  userId: string,
  limit = 20,
  cursor?: string,
): Promise<{ pins: PinRow[]; nextCursor: string | null }> {
  const cacheKey = cursor ? `feed:${userId}:${cursor}` : `feed:${userId}`;

  // Check cache first
  const cached = await cacheGet<{ pins: PinRow[]; nextCursor: string | null }>(cacheKey);
  if (cached) {
    feedCacheHits.inc();
    return cached;
  }
  feedCacheMisses.inc();

  const start = Date.now();

  try {
    // Fetch pins from followed users + popular pins to fill the feed
    let result;
    if (cursor) {
      result = await query(
        `(
          SELECT p.*, u.username, u.display_name, u.avatar_url
          FROM pins p
          JOIN users u ON u.id = p.user_id
          JOIN follows f ON f.following_id = p.user_id
          WHERE f.follower_id = $1 AND p.status = 'published' AND p.created_at < $3
          ORDER BY p.created_at DESC
          LIMIT $2
        )
        UNION ALL
        (
          SELECT p.*, u.username, u.display_name, u.avatar_url
          FROM pins p
          JOIN users u ON u.id = p.user_id
          WHERE p.status = 'published'
            AND p.user_id != $1
            AND p.created_at < $3
            AND p.id NOT IN (
              SELECT p2.id FROM pins p2
              JOIN follows f2 ON f2.following_id = p2.user_id
              WHERE f2.follower_id = $1
            )
          ORDER BY p.save_count DESC, p.created_at DESC
          LIMIT $2
        )
        ORDER BY created_at DESC
        LIMIT $2`,
        [userId, limit + 1, cursor],
      );
    } else {
      result = await query(
        `(
          SELECT p.*, u.username, u.display_name, u.avatar_url
          FROM pins p
          JOIN users u ON u.id = p.user_id
          JOIN follows f ON f.following_id = p.user_id
          WHERE f.follower_id = $1 AND p.status = 'published'
          ORDER BY p.created_at DESC
          LIMIT $2
        )
        UNION ALL
        (
          SELECT p.*, u.username, u.display_name, u.avatar_url
          FROM pins p
          JOIN users u ON u.id = p.user_id
          WHERE p.status = 'published'
            AND p.user_id != $1
            AND p.id NOT IN (
              SELECT p2.id FROM pins p2
              JOIN follows f2 ON f2.following_id = p2.user_id
              WHERE f2.follower_id = $1
            )
          ORDER BY p.save_count DESC, p.created_at DESC
          LIMIT $2
        )
        ORDER BY created_at DESC
        LIMIT $2`,
        [userId, limit + 1],
      );
    }

    const pins = result.rows;
    let nextCursor: string | null = null;

    if (pins.length > limit) {
      const lastPin = pins[limit - 1];
      nextCursor = lastPin.created_at.toISOString();
      pins.splice(limit);
    }

    const feedResult = { pins, nextCursor };

    // Cache for 60 seconds
    await cacheSet(cacheKey, feedResult, 60);

    const duration = (Date.now() - start) / 1000;
    feedGenerationDuration.observe(duration);

    return feedResult;
  } catch (err) {
    logger.error({ err, userId }, 'Error generating feed');
    return { pins: [], nextCursor: null };
  }
}

/**
 * Get a discover/explore feed with popular pins.
 */
export async function getDiscoverFeed(
  limit = 20,
  cursor?: string,
): Promise<{ pins: PinRow[]; nextCursor: string | null }> {
  const cacheKey = cursor ? `discover:${cursor}` : 'discover';

  const cached = await cacheGet<{ pins: PinRow[]; nextCursor: string | null }>(cacheKey);
  if (cached) {
    feedCacheHits.inc();
    return cached;
  }
  feedCacheMisses.inc();

  let result;
  if (cursor) {
    result = await query(
      `SELECT p.*, u.username, u.display_name, u.avatar_url
       FROM pins p
       JOIN users u ON u.id = p.user_id
       WHERE p.status = 'published' AND p.created_at < $2
       ORDER BY p.save_count DESC, p.created_at DESC
       LIMIT $1`,
      [limit + 1, cursor],
    );
  } else {
    result = await query(
      `SELECT p.*, u.username, u.display_name, u.avatar_url
       FROM pins p
       JOIN users u ON u.id = p.user_id
       WHERE p.status = 'published'
       ORDER BY p.save_count DESC, p.created_at DESC
       LIMIT $1`,
      [limit + 1],
    );
  }

  const pins = result.rows;
  let nextCursor: string | null = null;

  if (pins.length > limit) {
    const lastPin = pins[limit - 1];
    nextCursor = lastPin.created_at.toISOString();
    pins.splice(limit);
  }

  const feedResult = { pins, nextCursor };
  await cacheSet(cacheKey, feedResult, 60);

  return feedResult;
}
