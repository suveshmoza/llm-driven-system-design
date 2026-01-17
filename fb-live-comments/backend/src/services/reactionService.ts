/**
 * Reaction Service Module
 *
 * Handles emoji reactions on streams and comments. Reactions are high-volume
 * (potentially thousands per second during popular streams), so counts are
 * aggregated in Redis for real-time display and persisted to PostgreSQL
 * for durability.
 *
 * @module services/reactionService
 */

import { query } from '../db/index.js';
import { Reaction, ReactionType, ReactionCount } from '../types/index.js';
import { redis, checkRateLimit } from '../utils/redis.js';

/**
 * Service class for reaction management operations.
 * Handles high-volume reaction tracking with Redis aggregation.
 */
export class ReactionService {
  /**
   * Adds a reaction to a stream or comment.
   * Uses upsert semantics to prevent duplicate reactions.
   * Rate limited to 100 reactions per minute per user per stream.
   *
   * @param streamId - Stream receiving the reaction
   * @param userId - User adding the reaction
   * @param reactionType - Type of reaction (like, love, haha, wow, sad, angry)
   * @param commentId - Optional comment ID for comment-specific reactions
   * @throws Error if rate limit exceeded
   */
  async addReaction(
    streamId: string,
    userId: string,
    reactionType: ReactionType,
    commentId?: string
  ): Promise<void> {
    // Rate limit reactions (more lenient than comments)
    const allowed = await checkRateLimit(
      `ratelimit:reaction:${streamId}:${userId}`,
      100, // 100 reactions per minute
      60
    );
    if (!allowed) {
      throw new Error('Rate limit exceeded: too many reactions');
    }

    // Insert or ignore duplicate
    await query(
      `INSERT INTO reactions (stream_id, user_id, reaction_type, comment_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, comment_id, reaction_type) DO NOTHING`,
      [streamId, userId, reactionType, commentId || null]
    );

    // Update reaction counter in Redis for real-time aggregation
    const key = commentId
      ? `reactions:comment:${commentId}`
      : `reactions:stream:${streamId}`;
    await redis.hincrby(key, reactionType, 1);
  }

  /**
   * Removes a user's reaction from a comment.
   * Decrements the Redis counter to keep real-time counts accurate.
   *
   * @param userId - User removing their reaction
   * @param reactionType - Type of reaction to remove
   * @param commentId - Comment to remove reaction from
   */
  async removeReaction(
    userId: string,
    reactionType: ReactionType,
    commentId: string
  ): Promise<void> {
    const result = await query<Reaction>(
      `DELETE FROM reactions
       WHERE user_id = $1 AND reaction_type = $2 AND comment_id = $3
       RETURNING stream_id`,
      [userId, reactionType, commentId]
    );

    if (result.length > 0) {
      const key = `reactions:comment:${commentId}`;
      await redis.hincrby(key, reactionType, -1);
    }
  }

  /**
   * Gets aggregated reaction counts for a stream.
   * Returns counts for all reaction types on stream-level reactions.
   * Tries Redis cache first, falls back to database aggregation.
   *
   * @param streamId - Stream to get reaction counts for
   * @returns Object mapping reaction types to their counts
   */
  async getReactionCounts(streamId: string): Promise<ReactionCount> {
    // Try cache first
    const cached = await redis.hgetall(`reactions:stream:${streamId}`);
    if (Object.keys(cached).length > 0) {
      const counts: ReactionCount = {};
      for (const [key, value] of Object.entries(cached)) {
        counts[key] = parseInt(value, 10) || 0;
      }
      return counts;
    }

    // Fall back to database
    const rows = await query<{ reaction_type: string; count: string }>(
      `SELECT reaction_type, COUNT(*) as count
       FROM reactions
       WHERE stream_id = $1 AND comment_id IS NULL
       GROUP BY reaction_type`,
      [streamId]
    );

    const counts: ReactionCount = {};
    for (const row of rows) {
      counts[row.reaction_type] = parseInt(row.count, 10);
    }

    return counts;
  }

  /**
   * Gets aggregated reaction counts for a specific comment.
   * Used to display reaction totals on individual comments.
   *
   * @param commentId - Comment to get reaction counts for
   * @returns Object mapping reaction types to their counts
   */
  async getCommentReactionCounts(commentId: string): Promise<ReactionCount> {
    const cached = await redis.hgetall(`reactions:comment:${commentId}`);
    if (Object.keys(cached).length > 0) {
      const counts: ReactionCount = {};
      for (const [key, value] of Object.entries(cached)) {
        counts[key] = parseInt(value, 10) || 0;
      }
      return counts;
    }

    const rows = await query<{ reaction_type: string; count: string }>(
      `SELECT reaction_type, COUNT(*) as count
       FROM reactions
       WHERE comment_id = $1
       GROUP BY reaction_type`,
      [commentId]
    );

    const counts: ReactionCount = {};
    for (const row of rows) {
      counts[row.reaction_type] = parseInt(row.count, 10);
    }

    return counts;
  }
}

/** Singleton reaction service instance */
export const reactionService = new ReactionService();
