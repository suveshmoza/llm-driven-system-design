/**
 * @fileoverview Sliding Window Log Rate Limiting Algorithm.
 *
 * The most accurate rate limiting algorithm. Stores the timestamp of every request
 * and counts how many fall within the sliding window.
 *
 * How it works:
 * 1. Store each request timestamp in a Redis sorted set (score = timestamp)
 * 2. Remove entries older than the window
 * 3. Count remaining entries to check if under limit
 * 4. Add new entry if allowed
 *
 * Trade-offs:
 * - Pros: Perfectly accurate sliding window, no boundary issues
 * - Cons: Memory-intensive (stores every request timestamp), higher latency
 *
 * Best for: Low-volume APIs where accuracy is critical, or debugging/auditing.
 * Avoid for: High-throughput APIs (memory usage grows linearly with requests).
 */

import Redis from 'ioredis';
import { RateLimitResult } from '../types/index.js';
import { RateLimiter } from './base.js';

/**
 * Sliding Log rate limiter implementation.
 * Uses Redis sorted sets to store request timestamps with atomic Lua script operations.
 */
export class SlidingLogLimiter implements RateLimiter {
  private redis: Redis;
  private keyPrefix: string;

  /**
   * Creates a new Sliding Log rate limiter.
   *
   * @param redis - Redis client instance for distributed state storage
   * @param keyPrefix - Prefix for Redis keys to avoid collisions
   */
  constructor(redis: Redis, keyPrefix: string = 'ratelimit:log:') {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
  }

  /**
   * Check if a request is allowed using a Lua script for atomicity.
   * The Lua script ensures that cleanup, check, and add happen atomically.
   *
   * @param identifier - Unique ID for the rate limit subject
   * @param limit - Maximum requests allowed in the sliding window
   * @param windowSeconds - Window duration in seconds
   * @returns Rate limit result indicating if request is allowed
   */
  async check(identifier: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;
    const key = `${this.keyPrefix}${identifier}`;

    // Use Lua script for atomic operations to prevent race conditions
    const luaScript = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local window_start = tonumber(ARGV[2])
      local limit = tonumber(ARGV[3])
      local window_seconds = tonumber(ARGV[4])

      -- Remove expired entries (outside the sliding window)
      redis.call('ZREMRANGEBYSCORE', key, 0, window_start)

      -- Get current count of requests in window
      local count = redis.call('ZCARD', key)

      if count >= limit then
        -- Get oldest entry to calculate accurate retry time
        local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
        local retry_after = 0
        if oldest[2] then
          retry_after = (tonumber(oldest[2]) + window_seconds * 1000 - now) / 1000
        end
        return {0, 0, retry_after}
      end

      -- Add new entry with unique member (timestamp + random suffix)
      redis.call('ZADD', key, now, now .. ':' .. math.random())
      redis.call('PEXPIRE', key, window_seconds * 1000 + 1000)

      return {1, limit - count - 1, 0}
    `;

    const result = await this.redis.eval(
      luaScript,
      1,
      key,
      now.toString(),
      windowStart.toString(),
      limit.toString(),
      windowSeconds.toString()
    ) as [number, number, number];

    const allowed = result[0] === 1;
    const remaining = result[1];
    const retryAfter = result[2];

    return {
      allowed,
      remaining: Math.max(0, remaining),
      limit,
      resetTime: now + windowSeconds * 1000,
      retryAfter: allowed ? undefined : Math.max(1, Math.ceil(retryAfter)),
    };
  }

  /**
   * Get current window state without adding a new entry.
   *
   * @param identifier - Unique ID for the rate limit subject
   * @param limit - Maximum requests allowed in the sliding window
   * @param windowSeconds - Window duration in seconds
   * @returns Current rate limit state
   */
  async getState(identifier: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;
    const key = `${this.keyPrefix}${identifier}`;

    // Remove expired entries and count remaining
    await this.redis.zremrangebyscore(key, 0, windowStart);
    const count = await this.redis.zcard(key);

    return {
      allowed: count < limit,
      remaining: Math.max(0, limit - count),
      limit,
      resetTime: now + windowSeconds * 1000,
    };
  }

  /**
   * Reset rate limit state by deleting the sorted set.
   *
   * @param identifier - Unique ID to reset
   */
  async reset(identifier: string): Promise<void> {
    const key = `${this.keyPrefix}${identifier}`;
    await this.redis.del(key);
  }
}
