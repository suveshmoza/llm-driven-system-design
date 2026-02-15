import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

/** Redis client instance for session storage and balance caching. */
export const redis = new Redis.default({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

// Session management
const SESSION_PREFIX = 'session:';
const SESSION_TTL = 24 * 60 * 60; // 24 hours

/** Stores a user session in Redis with a 24-hour TTL. */
export const setSession = async (sessionId: string, userId: string): Promise<void> => {
  await redis.set(`${SESSION_PREFIX}${sessionId}`, userId, 'EX', SESSION_TTL);
};

/** Retrieves the user ID associated with a session, or null if expired/missing. */
export const getSession = async (sessionId: string): Promise<string | null> => {
  return await redis.get(`${SESSION_PREFIX}${sessionId}`);
};

/** Removes a session from Redis, effectively logging the user out. */
export const deleteSession = async (sessionId: string): Promise<void> => {
  await redis.del(`${SESSION_PREFIX}${sessionId}`);
};

// Balance cache
const BALANCE_PREFIX = 'balance:';
const BALANCE_TTL = 60; // 1 minute

/** Returns the cached wallet balance in cents, or null on cache miss. */
export const getCachedBalance = async (userId: string): Promise<number | null> => {
  const cached = await redis.get(`${BALANCE_PREFIX}${userId}`);
  return cached ? parseInt(cached) : null;
};

/** Caches a user's wallet balance in Redis with a 1-minute TTL. */
export const setCachedBalance = async (userId: string, balance: number): Promise<void> => {
  await redis.set(`${BALANCE_PREFIX}${userId}`, balance, 'EX', BALANCE_TTL);
};

/** Evicts the cached balance for a user, forcing a fresh database read on next access. */
export const invalidateBalanceCache = async (userId: string): Promise<void> => {
  await redis.del(`${BALANCE_PREFIX}${userId}`);
};
