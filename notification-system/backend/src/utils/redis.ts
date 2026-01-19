import { Redis } from 'ioredis';

export const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => Math.min(times * 100, 2000),
  lazyConnect: true,
});

redis.on('error', (err: Error) => {
  console.error('Redis connection error:', err);
});

redis.on('connect', () => {
  console.log('Redis connected');
});

// Helper functions for common operations
export async function cacheGet<T>(key: string): Promise<T | null> {
  const value = await redis.get(key);
  return value ? JSON.parse(value) as T : null;
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
  await redis.setex(key, ttlSeconds, JSON.stringify(value));
}

export async function cacheDelete(key: string): Promise<void> {
  await redis.del(key);
}

export async function incrementCounter(key: string, ttlSeconds: number = 3600): Promise<number> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, ttlSeconds);
  }
  return count;
}

export async function getCounter(key: string): Promise<number> {
  const value = await redis.get(key);
  return parseInt(value || '0') || 0;
}
