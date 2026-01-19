/**
 * Redis Cache Module with Cache-Aside Pattern
 *
 * Cache-aside (lazy loading) pattern:
 * 1. Check cache first
 * 2. On cache miss, fetch from database
 * 3. Store result in cache with TTL
 * 4. Return result
 *
 * Benefits:
 * - Reduces database load for read-heavy workloads
 * - Only caches data that is actually requested
 * - Graceful degradation if cache is unavailable
 */

import redisClient from '../redis.js';
import { metrics } from './metrics.js';

// TTL constants (in seconds)
export const CACHE_TTL = {
  LISTING: 900,        // 15 minutes - listing details change infrequently
  AVAILABILITY: 60,    // 1 minute - availability changes with bookings
  SEARCH: 300,         // 5 minutes - search results can be slightly stale
  USER_SESSION: 86400, // 24 hours - session data
  REVIEW: 1800,        // 30 minutes - reviews change rarely
};

// Cache key prefixes for organization and easier invalidation
export const CACHE_PREFIX = {
  LISTING: 'listing',
  AVAILABILITY: 'availability',
  SEARCH: 'search',
  USER: 'user',
  REVIEW: 'review',
};

/**
 * Get value from cache
 * @param key - Cache key
 * @returns Cached value or null
 */
export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  try {
    const value = await redisClient.get(key);
    if (value) {
      metrics.cacheHits.inc({ cache_type: key.split(':')[0] });
      return JSON.parse(value) as T;
    }
    metrics.cacheMisses.inc({ cache_type: key.split(':')[0] });
    return null;
  } catch (error) {
    console.error('Cache get error:', error);
    metrics.cacheMisses.inc({ cache_type: key.split(':')[0] });
    return null;
  }
}

/**
 * Set value in cache with TTL
 * @param key - Cache key
 * @param value - Value to cache (will be JSON stringified)
 * @param ttl - Time to live in seconds
 */
export async function cacheSet(key: string, value: unknown, ttl: number): Promise<void> {
  try {
    await redisClient.setEx(key, ttl, JSON.stringify(value));
  } catch (error) {
    console.error('Cache set error:', error);
  }
}

/**
 * Delete a cache key
 * @param key - Cache key to delete
 */
export async function cacheDel(key: string): Promise<void> {
  try {
    await redisClient.del(key);
  } catch (error) {
    console.error('Cache delete error:', error);
  }
}

/**
 * Delete all keys matching a pattern
 * @param pattern - Pattern to match (e.g., 'listing:123:*')
 */
export async function cacheDelPattern(pattern: string): Promise<void> {
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  } catch (error) {
    console.error('Cache delete pattern error:', error);
  }
}

/**
 * Cache-aside helper - get from cache or fetch from source
 * @param key - Cache key
 * @param fetchFn - Async function to fetch data if cache miss
 * @param ttl - Time to live in seconds
 * @returns Data from cache or source
 */
export async function cacheAside<T>(key: string, fetchFn: () => Promise<T>, ttl: number): Promise<T> {
  // Try cache first
  const cached = await cacheGet<T>(key);
  if (cached !== null) {
    return cached;
  }

  // Cache miss - fetch from source
  const data = await fetchFn();

  // Store in cache (don't await to avoid blocking)
  if (data !== null && data !== undefined) {
    cacheSet(key, data, ttl);
  }

  return data;
}

// Specific cache functions for different data types

/**
 * Get listing from cache or database
 * @param listingId - Listing ID
 * @param fetchFn - Function to fetch from database
 */
export async function getCachedListing<T>(listingId: number | string, fetchFn: () => Promise<T>): Promise<T> {
  const key = `${CACHE_PREFIX.LISTING}:${listingId}`;
  return cacheAside(key, fetchFn, CACHE_TTL.LISTING);
}

/**
 * Invalidate listing cache
 * @param listingId - Listing ID
 */
export async function invalidateListingCache(listingId: number | string): Promise<void> {
  const key = `${CACHE_PREFIX.LISTING}:${listingId}`;
  await cacheDel(key);
  // Also invalidate related search caches
  await cacheDelPattern(`${CACHE_PREFIX.SEARCH}:*`);
}

/**
 * Get availability from cache or database
 * @param listingId - Listing ID
 * @param startDate - Start date
 * @param endDate - End date
 * @param fetchFn - Function to fetch from database
 */
export async function getCachedAvailability<T>(listingId: number | string, startDate: string, endDate: string, fetchFn: () => Promise<T>): Promise<T> {
  const key = `${CACHE_PREFIX.AVAILABILITY}:${listingId}:${startDate}:${endDate}`;
  return cacheAside(key, fetchFn, CACHE_TTL.AVAILABILITY);
}

/**
 * Invalidate availability cache for a listing
 * @param listingId - Listing ID
 */
export async function invalidateAvailabilityCache(listingId: number | string): Promise<void> {
  await cacheDelPattern(`${CACHE_PREFIX.AVAILABILITY}:${listingId}:*`);
}

/**
 * Get search results from cache
 * @param searchParams - Search parameters object
 * @param fetchFn - Function to fetch from database
 */
export async function getCachedSearchResults<T>(searchParams: Record<string, unknown>, fetchFn: () => Promise<T>): Promise<T> {
  // Create a hash of search params for the cache key
  const key = `${CACHE_PREFIX.SEARCH}:${Buffer.from(JSON.stringify(searchParams)).toString('base64').slice(0, 64)}`;
  return cacheAside(key, fetchFn, CACHE_TTL.SEARCH);
}

/**
 * Update cache hit ratio metrics
 * Call this periodically to update the gauge
 */
export async function updateCacheMetrics(): Promise<void> {
  try {
    const info = await redisClient.info('stats');
    const hitMatch = info.match(/keyspace_hits:(\d+)/);
    const missMatch = info.match(/keyspace_misses:(\d+)/);

    if (hitMatch && missMatch) {
      const hits = parseInt(hitMatch[1]);
      const misses = parseInt(missMatch[1]);
      const total = hits + misses;
      if (total > 0) {
        metrics.cacheHitRatio.set({ cache_type: 'overall' }, hits / total);
      }
    }
  } catch (error) {
    console.error('Failed to update cache metrics:', error);
  }
}

export default {
  cacheGet,
  cacheSet,
  cacheDel,
  cacheDelPattern,
  cacheAside,
  getCachedListing,
  invalidateListingCache,
  getCachedAvailability,
  invalidateAvailabilityCache,
  getCachedSearchResults,
  updateCacheMetrics,
  CACHE_TTL,
  CACHE_PREFIX,
};
