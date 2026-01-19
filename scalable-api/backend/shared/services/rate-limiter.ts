import type { Request, Response, NextFunction } from 'express';
import type { Redis } from 'ioredis';
import { getRedisClient } from './cache.js';
import { generateId } from '../utils/index.js';
import config, { type Config } from '../config/index.js';
import type { AuthenticatedRequest, RateLimitResult } from '../types.js';

interface RateLimitTier {
  requests: number;
  windowMs: number;
}

/**
 * Distributed Rate Limiter using Redis sliding window
 */
export class RateLimiter {
  private redis: Redis;
  private config: Config['rateLimit'];

  constructor(redis: Redis | null = null) {
    this.redis = redis || getRedisClient();
    this.config = config.rateLimit;
  }

  /**
   * Get identifier for rate limiting (API key or IP)
   */
  getIdentifier(req: AuthenticatedRequest): string {
    if (req.user?.apiKey) {
      return `key:${req.user.apiKey}`;
    }
    // Use X-Forwarded-For if behind proxy, otherwise use IP
    const forwardedFor = req.headers['x-forwarded-for'];
    const forwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const ip = forwarded?.split(',')[0] || req.ip || (req as unknown as { connection?: { remoteAddress?: string } }).connection?.remoteAddress;
    return `ip:${ip}`;
  }

  /**
   * Get rate limit configuration for request
   */
  getLimit(req: AuthenticatedRequest): RateLimitTier {
    const tier = req.user?.tier || 'anonymous';
    return this.config.limits[tier] || this.config.limits['anonymous'];
  }

  /**
   * Check if request is within rate limit
   */
  async checkLimit(identifier: string, limit: RateLimitTier): Promise<RateLimitResult> {
    const key = `ratelimit:${identifier}`;
    const now = Date.now();
    const windowStart = now - limit.windowMs;

    try {
      // Use pipeline for atomic operations
      const pipeline = this.redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart); // Remove old entries
      pipeline.zcard(key); // Count current entries
      pipeline.zadd(key, now, `${now}:${generateId()}`); // Add current request
      pipeline.expire(key, Math.ceil(limit.windowMs / 1000)); // Set expiry

      const results = await pipeline.exec();
      const currentCount = (results?.[1]?.[1] as number) || 0;

      if (currentCount >= limit.requests) {
        // Get oldest entry to calculate retry-after
        const oldest = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
        const oldestScore = oldest[1] ?? '';
        const retryAfter = oldestScore
          ? Math.ceil((parseInt(oldestScore, 10) + limit.windowMs - now) / 1000)
          : Math.ceil(limit.windowMs / 1000);

        return {
          allowed: false,
          remaining: 0,
          resetAt: Math.ceil((now + limit.windowMs) / 1000),
          retryAfter,
          limit: limit.requests,
        };
      }

      return {
        allowed: true,
        remaining: limit.requests - currentCount - 1,
        resetAt: Math.ceil((now + limit.windowMs) / 1000),
        limit: limit.requests,
      };
    } catch (error) {
      console.error('Rate limiter error:', (error as Error).message);
      // Fail open on Redis errors to prevent service disruption
      return {
        allowed: true,
        remaining: limit.requests,
        resetAt: Math.ceil((now + limit.windowMs) / 1000),
        limit: limit.requests,
        error: true,
      };
    }
  }

  /**
   * Express middleware for rate limiting
   */
  middleware(): (req: Request, res: Response, next: NextFunction) => Promise<void | Response> {
    return async (req: Request, res: Response, next: NextFunction): Promise<void | Response> => {
      const authReq = req as AuthenticatedRequest;
      const identifier = this.getIdentifier(authReq);
      const limit = this.getLimit(authReq);

      const result = await this.checkLimit(identifier, limit);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', result.limit);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', result.resetAt);

      if (!result.allowed) {
        res.setHeader('Retry-After', result.retryAfter || 60);
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: `Too many requests. Please try again in ${result.retryAfter} seconds.`,
          retryAfter: result.retryAfter,
        });
      }

      // Attach rate limit info to request for logging
      authReq.rateLimit = result;
      next();
    };
  }

  /**
   * Get current rate limit status for an identifier
   */
  async getStatus(identifier: string): Promise<{
    identifier: string;
    currentCount: number;
    limit: number;
    remaining: number;
    windowMs: number;
  } | null> {
    const key = `ratelimit:${identifier}`;
    const now = Date.now();
    const limit = this.config.limits['anonymous'];
    const windowStart = now - limit.windowMs;

    try {
      await this.redis.zremrangebyscore(key, 0, windowStart);
      const count = await this.redis.zcard(key);

      return {
        identifier,
        currentCount: count,
        limit: limit.requests,
        remaining: Math.max(0, limit.requests - count),
        windowMs: limit.windowMs,
      };
    } catch (error) {
      console.error('Rate limiter status error:', (error as Error).message);
      return null;
    }
  }
}

export default RateLimiter;
