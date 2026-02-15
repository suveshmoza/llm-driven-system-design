import Redis from 'ioredis';
import config from '../config/index.js';

const redis = new Redis.default({
  host: config.redis.host,
  port: config.redis.port,
  retryStrategy: (times: number): number => Math.min(times * 100, 3000),
  maxRetriesPerRequest: 3,
});

redis.on('error', (err: Error) => {
  console.error('Redis connection error:', err);
});

redis.on('connect', () => {
  console.log('Connected to Redis');
});

// Cache helpers
/** Retrieves and deserializes a cached JSON value from Redis. */
export const cacheGet = async <T = unknown>(key: string): Promise<T | null> => {
  const data = await redis.get(key);
  return data ? (JSON.parse(data) as T) : null;
};

/** Serializes and stores a value in Redis with an expiration in seconds. */
export const cacheSet = async (key: string, value: unknown, ttlSeconds: number = 3600): Promise<void> => {
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
};

/** Removes a cached value from Redis by key. */
export const cacheDel = async (key: string): Promise<void> => {
  await redis.del(key);
};

export default redis;
