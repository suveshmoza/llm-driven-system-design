import redis from '../services/redis.js';
import logger from '../services/logger.js';

export interface CursorData {
  userId: string;
  username: string;
  x: number;
  y: number;
  color: string;
}

const CURSOR_TTL = 30; // seconds
const CURSOR_KEY_PREFIX = 'presence:cursors:';

/**
 * Update a user's cursor position in a drawing room.
 * Stored in Redis with a 30-second TTL so stale cursors auto-expire.
 */
export const updateCursor = async (
  drawingId: string,
  userId: string,
  username: string,
  x: number,
  y: number,
  color: string
): Promise<void> => {
  const key = `${CURSOR_KEY_PREFIX}${drawingId}`;
  const cursorData: CursorData = { userId, username, x, y, color };

  try {
    await redis.hset(key, userId, JSON.stringify(cursorData));
    await redis.expire(key, CURSOR_TTL);
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message, drawingId, userId }, 'Failed to update cursor');
  }
};

/**
 * Get all cursor positions for a drawing room.
 * Returns an array of cursor data, excluding the requesting user.
 */
export const getCursors = async (
  drawingId: string,
  excludeUserId?: string
): Promise<CursorData[]> => {
  const key = `${CURSOR_KEY_PREFIX}${drawingId}`;

  try {
    const cursors = await redis.hgetall(key);
    const result: CursorData[] = [];

    for (const [userId, data] of Object.entries(cursors)) {
      if (excludeUserId && userId === excludeUserId) continue;
      try {
        result.push(JSON.parse(data) as CursorData);
      } catch {
        // Skip malformed cursor data
      }
    }

    return result;
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message, drawingId }, 'Failed to get cursors');
    return [];
  }
};

/**
 * Remove a user's cursor from a drawing room (on disconnect).
 */
export const removeCursor = async (drawingId: string, userId: string): Promise<void> => {
  const key = `${CURSOR_KEY_PREFIX}${drawingId}`;

  try {
    await redis.hdel(key, userId);
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message, drawingId, userId }, 'Failed to remove cursor');
  }
};

export default {
  updateCursor,
  getCursors,
  removeCursor,
};
