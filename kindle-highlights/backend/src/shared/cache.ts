/**
 * Redis cache client
 * @module shared/cache
 */
import { createClient } from 'redis'

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

/** Redis client instance */
export const redis = createClient({ url: redisUrl })

redis.on('error', (err) => console.error('Redis Client Error', err))

/** Initialize Redis connection */
/** Connects to Redis and logs connection status. */
export async function initRedis(): Promise<void> {
  if (!redis.isOpen) {
    await redis.connect()
    console.log('Redis connected')
  }
}

/**
 * Get a value from cache
 * @param key - Cache key
 * @returns Cached value or null
 */
/** Retrieves a cached JSON value from Redis by key. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const value = await redis.get(key)
  return value ? JSON.parse(value) : null
}

/**
 * Set a value in cache with optional TTL
 * @param key - Cache key
 * @param value - Value to cache
 * @param ttlSeconds - Time to live in seconds
 */
/** Stores a JSON value in Redis with an optional TTL. */
export async function cacheSet<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  const serialized = JSON.stringify(value)
  if (ttlSeconds) {
    await redis.setEx(key, ttlSeconds, serialized)
  } else {
    await redis.set(key, serialized)
  }
}

/**
 * Delete a cache key
 * @param key - Cache key to delete
 */
/** Removes a cached value from Redis. */
export async function cacheDel(key: string): Promise<void> {
  await redis.del(key)
}

/**
 * Increment a hash field
 * @param key - Hash key
 * @param field - Field name
 * @param increment - Increment value
 */
/** Increments a field in a Redis hash by the given amount. */
export async function hashIncr(key: string, field: string, increment = 1): Promise<number> {
  return await redis.hIncrBy(key, field, increment)
}

/**
 * Get all fields from a hash
 * @param key - Hash key
 */
/** Returns all fields and values from a Redis hash. */
export async function hashGetAll(key: string): Promise<Record<string, string>> {
  return await redis.hGetAll(key)
}
