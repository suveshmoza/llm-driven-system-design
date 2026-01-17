/**
 * @fileoverview Token Bucket Rate Limiting Algorithm.
 *
 * A flexible algorithm that allows controlled bursts while enforcing a long-term rate.
 * Imagine a bucket that holds tokens:
 * - Tokens are added at a constant rate (refillRate tokens/second)
 * - Each request consumes one token
 * - If no tokens are available, the request is denied
 * - The bucket has a maximum capacity (burstCapacity)
 *
 * How it works:
 * 1. Calculate how many tokens should have been added since last request
 * 2. Add tokens (up to capacity)
 * 3. If tokens >= 1, consume one and allow the request
 * 4. Otherwise, deny and calculate when a token will be available
 *
 * Trade-offs:
 * - Pros: Allows bursts, smooth rate limiting, configurable burst vs sustained rate
 * - Cons: More complex state (tokens + timestamp), harder to explain to users
 *
 * Best for: APIs where occasional bursts are acceptable (e.g., batch uploads).
 */

import Redis from 'ioredis';
import { RateLimitResult } from '../types/index.js';
import { RateLimiter } from './base.js';

/**
 * Configuration options specific to Token Bucket algorithm.
 */
export interface TokenBucketOptions {
  /** Maximum tokens the bucket can hold (burst capacity) */
  burstCapacity?: number;
  /** Rate at which tokens are added (tokens per second) */
  refillRate?: number;
}

/**
 * Token Bucket rate limiter implementation.
 * Uses Redis hash to store token count and last refill timestamp.
 * All operations use Lua scripts for atomicity in distributed environments.
 */
export class TokenBucketLimiter implements RateLimiter {
  private redis: Redis;
  private keyPrefix: string;

  /**
   * Creates a new Token Bucket rate limiter.
   *
   * @param redis - Redis client instance for distributed state storage
   * @param keyPrefix - Prefix for Redis keys to avoid collisions
   */
  constructor(redis: Redis, keyPrefix: string = 'ratelimit:token:') {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
  }

  /**
   * Check if a request is allowed and consume a token if available.
   * Uses atomic Lua script to handle refill calculation and token consumption.
   *
   * @param identifier - Unique ID for the rate limit subject
   * @param limit - Used as default bucket capacity if burstCapacity not specified
   * @param windowSeconds - Used to calculate default refill rate
   * @param options - Token bucket specific options (burstCapacity, refillRate)
   * @returns Rate limit result indicating if request is allowed
   */
  async check(
    identifier: string,
    limit: number,
    windowSeconds: number,
    options: TokenBucketOptions = {}
  ): Promise<RateLimitResult> {
    const capacity = options.burstCapacity || limit;
    // Default refill rate: fill entire bucket in windowSeconds
    const refillRate = options.refillRate || limit / windowSeconds;

    const now = Date.now();
    const key = `${this.keyPrefix}${identifier}`;

    // Lua script for atomic token bucket operations
    const luaScript = `
      local key = KEYS[1]
      local capacity = tonumber(ARGV[1])
      local refill_rate = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])
      local expiry = tonumber(ARGV[4])

      -- Get current bucket state
      local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
      local tokens = tonumber(bucket[1])
      local last_refill = tonumber(bucket[2])

      -- Initialize if this is a new bucket (start full)
      if tokens == nil then
        tokens = capacity
        last_refill = now
      end

      -- Calculate tokens to add based on elapsed time
      local elapsed = (now - last_refill) / 1000  -- convert to seconds
      local refill = elapsed * refill_rate
      tokens = math.min(capacity, tokens + refill)

      -- Try to consume one token
      if tokens >= 1 then
        tokens = tokens - 1
        redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
        redis.call('PEXPIRE', key, expiry)
        return {1, math.floor(tokens), 0}  -- allowed, remaining, retry_after
      else
        -- Calculate time until 1 token is available
        local retry_after = (1 - tokens) / refill_rate
        return {0, 0, retry_after}  -- denied
      end
    `;

    // Set expiry long enough for bucket to refill completely
    const expiryMs = Math.ceil(capacity / refillRate * 1000) + 10000;

    const result = await this.redis.eval(
      luaScript,
      1,
      key,
      capacity.toString(),
      refillRate.toString(),
      now.toString(),
      expiryMs.toString()
    ) as [number, number, number];

    const allowed = result[0] === 1;
    const remaining = result[1];
    const retryAfterSec = result[2];

    // Reset time is when bucket would be full again
    const tokensNeeded = capacity - remaining;
    const resetTime = now + (tokensNeeded / refillRate) * 1000;

    return {
      allowed,
      remaining: Math.max(0, remaining),
      limit: capacity,
      resetTime: Math.ceil(resetTime),
      retryAfter: allowed ? undefined : Math.max(1, Math.ceil(retryAfterSec)),
    };
  }

  /**
   * Get current bucket state without consuming a token.
   * Calculates current tokens based on refill since last access.
   *
   * @param identifier - Unique ID for the rate limit subject
   * @param limit - Used as default bucket capacity if burstCapacity not specified
   * @param windowSeconds - Used to calculate default refill rate
   * @param options - Token bucket specific options
   * @returns Current rate limit state
   */
  async getState(
    identifier: string,
    limit: number,
    windowSeconds: number,
    options: TokenBucketOptions = {}
  ): Promise<RateLimitResult> {
    const capacity = options.burstCapacity || limit;
    const refillRate = options.refillRate || limit / windowSeconds;

    const now = Date.now();
    const key = `${this.keyPrefix}${identifier}`;

    const bucket = await this.redis.hmget(key, 'tokens', 'last_refill');
    let tokens = parseFloat(bucket[0] || capacity.toString());
    const lastRefill = parseInt(bucket[1] || now.toString(), 10);

    // Calculate refill based on elapsed time
    const elapsed = (now - lastRefill) / 1000;
    tokens = Math.min(capacity, tokens + elapsed * refillRate);

    const tokensNeeded = capacity - tokens;
    const resetTime = now + (tokensNeeded / refillRate) * 1000;

    return {
      allowed: tokens >= 1,
      remaining: Math.floor(tokens),
      limit: capacity,
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
