import { redis } from './redis.js';
import { logger } from './logger.js';

const PRESENCE_TTL = 60; // seconds
const PRESENCE_PREFIX = 'presence:';

/** Sets a user's presence to online with a 60-second TTL in Redis. */
export async function setUserOnline(userId: string): Promise<void> {
  try {
    await redis.setex(`${PRESENCE_PREFIX}${userId}`, PRESENCE_TTL, Date.now().toString());
  } catch (err) {
    logger.error({ err, userId }, 'Failed to set user online');
  }
}

/** Removes a user's presence key from Redis (sets offline). */
export async function setUserOffline(userId: string): Promise<void> {
  try {
    await redis.del(`${PRESENCE_PREFIX}${userId}`);
  } catch (err) {
    logger.error({ err, userId }, 'Failed to set user offline');
  }
}

/** Checks if a single user is currently online via Redis key existence. */
export async function isUserOnline(userId: string): Promise<boolean> {
  try {
    const result = await redis.exists(`${PRESENCE_PREFIX}${userId}`);
    return result === 1;
  } catch (err) {
    logger.error({ err, userId }, 'Failed to check user presence');
    return false;
  }
}

/** Batch-checks presence for multiple users using Redis pipeline for efficiency. */
export async function getOnlineUsers(userIds: string[]): Promise<Record<string, boolean>> {
  if (userIds.length === 0) return {};

  try {
    const pipeline = redis.pipeline();
    for (const userId of userIds) {
      pipeline.exists(`${PRESENCE_PREFIX}${userId}`);
    }
    const results = await pipeline.exec();

    const presence: Record<string, boolean> = {};
    for (let i = 0; i < userIds.length; i++) {
      presence[userIds[i]] = results?.[i]?.[1] === 1;
    }
    return presence;
  } catch (err) {
    logger.error({ err }, 'Failed to get online users');
    return {};
  }
}
