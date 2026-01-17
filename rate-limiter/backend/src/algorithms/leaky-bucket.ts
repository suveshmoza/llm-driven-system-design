/**
 * @fileoverview Leaky Bucket Rate Limiting Algorithm.
 *
 * Provides the smoothest output rate by processing requests at a fixed rate.
 * Imagine a bucket with a hole in the bottom:
 * - Requests (water) enter the bucket
 * - Water leaks out at a constant rate (leakRate requests/second)
 * - If the bucket is full, new requests overflow (are rejected)
 *
 * How it works:
 * 1. Calculate how much "water" has leaked since last request
 * 2. Subtract leaked amount from current water level
 * 3. If bucket has room, add the request (add water)
 * 4. Otherwise, reject and calculate when space will be available
 *
 * Trade-offs:
 * - Pros: Smoothest output rate, prevents bursts entirely, protects downstream services
 * - Cons: Requests may effectively queue (higher latency), no burst allowance
 *
 * Best for: Protecting backend services with strict rate requirements,
 * or when you need to prevent any burst behavior.
 */

import Redis from 'ioredis';
import { RateLimitResult } from '../types/index.js';
import { RateLimiter } from './base.js';

/**
 * Configuration options specific to Leaky Bucket algorithm.
 */
export interface LeakyBucketOptions {
  /** Maximum requests the bucket can hold (queue size) */
  burstCapacity?: number;
  /** Rate at which requests "leak" out (requests per second) */
  leakRate?: number;
}

/**
 * Leaky Bucket rate limiter implementation.
 * Uses Redis hash to store water level and last leak timestamp.
 * All operations use Lua scripts for atomicity in distributed environments.
 */
export class LeakyBucketLimiter implements RateLimiter {
  private redis: Redis;
  private keyPrefix: string;

  /**
   * Creates a new Leaky Bucket rate limiter.
   *
   * @param redis - Redis client instance for distributed state storage
   * @param keyPrefix - Prefix for Redis keys to avoid collisions
   */
  constructor(redis: Redis, keyPrefix: string = 'ratelimit:leaky:') {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
  }

  /**
   * Check if a request is allowed and add it to the bucket if there's room.
   * Uses atomic Lua script to handle leak calculation and water addition.
   *
   * @param identifier - Unique ID for the rate limit subject
   * @param limit - Used as default bucket size if burstCapacity not specified
   * @param windowSeconds - Used to calculate default leak rate
   * @param options - Leaky bucket specific options (burstCapacity, leakRate)
   * @returns Rate limit result indicating if request is allowed
   */
  async check(
    identifier: string,
    limit: number,
    windowSeconds: number,
    options: LeakyBucketOptions = {}
  ): Promise<RateLimitResult> {
    const bucketSize = options.burstCapacity || limit;
    // Default leak rate: empty bucket in windowSeconds
    const leakRate = options.leakRate || limit / windowSeconds;

    const now = Date.now();
    const key = `${this.keyPrefix}${identifier}`;

    // Lua script for atomic leaky bucket operations
    const luaScript = `
      local key = KEYS[1]
      local bucket_size = tonumber(ARGV[1])
      local leak_rate = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])
      local expiry = tonumber(ARGV[4])

      -- Get current bucket state
      local bucket = redis.call('HMGET', key, 'water', 'last_leak')
      local water = tonumber(bucket[1]) or 0
      local last_leak = tonumber(bucket[2]) or now

      -- Leak water based on time passed
      local elapsed = (now - last_leak) / 1000  -- convert to seconds
      local leaked = elapsed * leak_rate
      water = math.max(0, water - leaked)

      -- Try to add water (new request)
      if water < bucket_size then
        water = water + 1
        redis.call('HMSET', key, 'water', water, 'last_leak', now)
        redis.call('PEXPIRE', key, expiry)
        local remaining = math.floor(bucket_size - water)
        return {1, remaining, 0}  -- allowed, remaining, retry_after
      else
        -- Calculate time until space is available
        local retry_after = (water - bucket_size + 1) / leak_rate
        return {0, 0, retry_after}  -- denied
      end
    `;

    // Set expiry long enough for bucket to drain completely
    const expiryMs = Math.ceil(bucketSize / leakRate * 1000) + 10000;

    const result = await this.redis.eval(
      luaScript,
      1,
      key,
      bucketSize.toString(),
      leakRate.toString(),
      now.toString(),
      expiryMs.toString()
    ) as [number, number, number];

    const allowed = result[0] === 1;
    const remaining = result[1];
    const retryAfterSec = result[2];

    // Reset time is when bucket would be empty
    const resetTime = now + (bucketSize / leakRate) * 1000;

    return {
      allowed,
      remaining: Math.max(0, remaining),
      limit: bucketSize,
      resetTime: Math.ceil(resetTime),
      retryAfter: allowed ? undefined : Math.max(1, Math.ceil(retryAfterSec)),
    };
  }

  /**
   * Get current bucket state without adding a request.
   * Calculates current water level based on leak since last access.
   *
   * @param identifier - Unique ID for the rate limit subject
   * @param limit - Used as default bucket size if burstCapacity not specified
   * @param windowSeconds - Used to calculate default leak rate
   * @param options - Leaky bucket specific options
   * @returns Current rate limit state
   */
  async getState(
    identifier: string,
    limit: number,
    windowSeconds: number,
    options: LeakyBucketOptions = {}
  ): Promise<RateLimitResult> {
    const bucketSize = options.burstCapacity || limit;
    const leakRate = options.leakRate || limit / windowSeconds;

    const now = Date.now();
    const key = `${this.keyPrefix}${identifier}`;

    const bucket = await this.redis.hmget(key, 'water', 'last_leak');
    let water = parseFloat(bucket[0] || '0');
    const lastLeak = parseInt(bucket[1] || now.toString(), 10);

    // Leak water based on time passed
    const elapsed = (now - lastLeak) / 1000;
    water = Math.max(0, water - elapsed * leakRate);

    const remaining = Math.floor(bucketSize - water);
    const resetTime = now + (bucketSize / leakRate) * 1000;

    return {
      allowed: water < bucketSize,
      remaining: Math.max(0, remaining),
      limit: bucketSize,
      resetTime: Math.ceil(resetTime),
    };
  }

  /**
   * Reset bucket state by deleting the hash.
   *
   * @param identifier - Unique ID to reset
   */
  async reset(identifier: string): Promise<void> {
    const key = `${this.keyPrefix}${identifier}`;
    await this.redis.del(key);
  }
}
