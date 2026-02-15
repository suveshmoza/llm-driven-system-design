import Redis from 'ioredis';

/** Redis client instance for plugin metadata caching. */
export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redis.on('error', (err) => {
  console.error('Redis connection error:', err);
});

/** Retrieves a cached value by key, returning null on cache miss. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const value = await redis.get(key);
  if (!value) return null;
  return JSON.parse(value) as T;
}

/** Stores a value in cache with a configurable TTL (default 5 minutes). */
export async function cacheSet(key: string, value: unknown, ttlSeconds = 300): Promise<void> {
  await redis.setex(key, ttlSeconds, JSON.stringify(value));
}

/** Removes a single cached value by key. */
export async function cacheDelete(key: string): Promise<void> {
  await redis.del(key);
}

/** Removes all cached values matching a glob pattern (e.g., "plugin:*"). */
export async function cacheDeletePattern(pattern: string): Promise<void> {
  const keys = await redis.keys(pattern);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}
