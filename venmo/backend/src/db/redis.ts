import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

export const redis = new Redis.default({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

// Session management
const SESSION_PREFIX = 'session:';
const SESSION_TTL = 24 * 60 * 60; // 24 hours

export const setSession = async (sessionId: string, userId: string): Promise<void> => {
  await redis.set(`${SESSION_PREFIX}${sessionId}`, userId, 'EX', SESSION_TTL);
};

export const getSession = async (sessionId: string): Promise<string | null> => {
  return await redis.get(`${SESSION_PREFIX}${sessionId}`);
};

export const deleteSession = async (sessionId: string): Promise<void> => {
  await redis.del(`${SESSION_PREFIX}${sessionId}`);
};

// Balance cache
const BALANCE_PREFIX = 'balance:';
const BALANCE_TTL = 60; // 1 minute

export const getCachedBalance = async (userId: string): Promise<number | null> => {
  const cached = await redis.get(`${BALANCE_PREFIX}${userId}`);
  return cached ? parseInt(cached) : null;
};

export const setCachedBalance = async (userId: string, balance: number): Promise<void> => {
  await redis.set(`${BALANCE_PREFIX}${userId}`, balance, 'EX', BALANCE_TTL);
};

export const invalidateBalanceCache = async (userId: string): Promise<void> => {
  await redis.del(`${BALANCE_PREFIX}${userId}`);
};
