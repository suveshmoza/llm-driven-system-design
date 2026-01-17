/**
 * @fileoverview Sliding Window Counter Rate Limiting Algorithm.
 *
 * An improvement over Fixed Window that smooths out the boundary burst issue
 * by considering a weighted combination of the current and previous windows.
 *
 * How it works:
 * 1. Maintain counters for both current and previous windows
 * 2. Calculate a weighted count: previous_count * (1 - position) + current_count
 * 3. Position is how far into the current window we are (0.0 to 1.0)
 *
 * Trade-offs:
 * - Pros: Smooth limiting, memory efficient (two counters), ~1-2% accuracy
 * - Cons: Not perfectly accurate (but close enough for most use cases)
 *
 * This is the recommended default algorithm for most rate limiting needs.
 */

import Redis from 'ioredis';
import { RateLimitResult } from '../types/index.js';
import { RateLimiter } from './base.js';

/**
 * Sliding Window Counter rate limiter implementation.
 * Uses weighted average of current and previous window counts for smooth limiting.
 */
export class SlidingWindowLimiter implements RateLimiter {
  private redis: Redis;
  private keyPrefix: string;

  /**
   * Creates a new Sliding Window rate limiter.
   *
   * @param redis - Redis client instance for distributed state storage
   * @param keyPrefix - Prefix for Redis keys to avoid collisions
   */
  constructor(redis: Redis, keyPrefix: string = 'ratelimit:sliding:') {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
  }

  /**
   * Check if a request is allowed using weighted window calculation.
   * Reads both windows in a pipeline, calculates weighted count, then increments.
   *
   * @param identifier - Unique ID for the rate limit subject
   * @param limit - Maximum requests allowed per window
   * @param windowSeconds - Window duration in seconds
   * @returns Rate limit result indicating if request is allowed
   */
  async check(identifier: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const currentWindow = Math.floor(now / windowMs);
    const previousWindow = currentWindow - 1;

    // Position within current window (0.0 to 1.0)
    const position = (now % windowMs) / windowMs;

    const currentKey = `${this.keyPrefix}${identifier}:${currentWindow}`;
    const previousKey = `${this.keyPrefix}${identifier}:${previousWindow}`;

    // Get both counts in a pipeline for efficiency
    const pipeline = this.redis.pipeline();
    pipeline.get(currentKey);
    pipeline.get(previousKey);
    const results = await pipeline.exec();

    const currentCount = parseInt(results?.[0]?.[1] as string || '0', 10);
    const previousCount = parseInt(results?.[1]?.[1] as string || '0', 10);

    // Weighted count using sliding window formula
    const weightedCount = previousCount * (1 - position) + currentCount;

    const resetTime = (currentWindow + 1) * windowMs;

    if (weightedCount >= limit) {
      return {
        allowed: false,
        remaining: 0,
        limit,
        resetTime,
        retryAfter: Math.ceil((resetTime - now) / 1000),
      };
    }

    // Increment current window counter atomically
    await this.redis.multi()
      .incr(currentKey)
      .pexpire(currentKey, windowMs * 2)
      .exec();

    return {
      allowed: true,
      remaining: Math.max(0, Math.floor(limit - weightedCount - 1)),
      limit,
      resetTime,
    };
  }

  /**
   * Get current weighted state without consuming a request slot.
   *
   * @param identifier - Unique ID for the rate limit subject
   * @param limit - Maximum requests allowed per window
   * @param windowSeconds - Window duration in seconds
   * @returns Current rate limit state
   */
  async getState(identifier: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const currentWindow = Math.floor(now / windowMs);
    const previousWindow = currentWindow - 1;
    const position = (now % windowMs) / windowMs;

    const currentKey = `${this.keyPrefix}${identifier}:${currentWindow}`;
    const previousKey = `${this.keyPrefix}${identifier}:${previousWindow}`;

    const pipeline = this.redis.pipeline();
    pipeline.get(currentKey);
    pipeline.get(previousKey);
    const results = await pipeline.exec();

    const currentCount = parseInt(results?.[0]?.[1] as string || '0', 10);
    const previousCount = parseInt(results?.[1]?.[1] as string || '0', 10);
    const weightedCount = previousCount * (1 - position) + currentCount;

    const resetTime = (currentWindow + 1) * windowMs;

    return {
      allowed: weightedCount < limit,
      remaining: Math.max(0, Math.floor(limit - weightedCount)),
      limit,
      resetTime,
    };
  }

  /**
   * Reset rate limit state by deleting all keys for the identifier.
   *
   * @param identifier - Unique ID to reset
   */
  async reset(identifier: string): Promise<void> {
    const pattern = `${this.keyPrefix}${identifier}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}
