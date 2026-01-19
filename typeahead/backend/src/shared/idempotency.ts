/**
 * Idempotency handler for write operations.
 *
 * WHY idempotency is CRITICAL for typeahead index updates:
 * - Prevents duplicate phrase count increments on retry
 * - Enables safe replay of failed operations
 * - Supports at-least-once delivery semantics
 * - Allows clients to safely retry without side effects
 */
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Redis } from 'ioredis';
import logger, { auditLogger } from './logger.js';
import { idempotencyMetrics } from './metrics.js';

interface IdempotencyEntry {
  result: CachedResult;
  timestamp: number;
}

interface CachedResult {
  statusCode: number;
  body: unknown;
}

interface IdempotencyHandlerOptions {
  prefix?: string;
  expirySeconds?: number;
}

interface ProcessResult<T> {
  processed: boolean;
  duplicate: boolean;
  result: T;
}

// Extend Express Request to include idempotencyKey
declare global {
  namespace Express {
    interface Request {
      idempotencyKey?: string;
    }
  }
}

/**
 * In-memory idempotency store with TTL
 * For production, use Redis for distributed deduplication
 */
class IdempotencyStore {
  private store: Map<string, IdempotencyEntry> = new Map();
  private expiryMs: number = 5 * 60 * 1000; // 5 minute TTL
  private cleanupInterval: number = 60 * 1000; // Clean up every minute
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Periodic cleanup
    this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupInterval);
  }

  set(key: string, result: CachedResult): void {
    this.store.set(key, {
      result,
      timestamp: Date.now(),
    });
  }

  get(key: string): CachedResult | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp > this.expiryMs) {
      this.store.delete(key);
      return null;
    }

    return entry.result;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.timestamp > this.expiryMs) {
        this.store.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}

// Global in-memory store
const inMemoryStore = new IdempotencyStore();

/**
 * Generate an idempotency key from request data
 */
export function generateIdempotencyKey(operation: string, data: Record<string, unknown>): string {
  const payload = JSON.stringify({
    operation,
    ...data,
    // Don't include timestamp for idempotency
  });

  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

/**
 * Middleware to handle idempotency for POST/PUT/DELETE requests
 * Uses X-Idempotency-Key header or generates one from request body
 */
export function idempotencyMiddleware(
  operation: string
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Get or generate idempotency key
    let idempotencyKey = req.headers['x-idempotency-key'] as string | undefined;

    if (!idempotencyKey) {
      // Generate from request body for implicit idempotency
      idempotencyKey = generateIdempotencyKey(operation, req.body as Record<string, unknown>);
    }

    req.idempotencyKey = idempotencyKey;

    // Check if we've already processed this request
    const cachedResult = inMemoryStore.get(idempotencyKey);
    if (cachedResult) {
      auditLogger.logIdempotencySkip(idempotencyKey, operation);
      idempotencyMetrics.duplicates.inc({ operation });

      logger.info({
        event: 'idempotency_duplicate',
        idempotencyKey,
        operation,
      });

      // Return cached result
      res.status(cachedResult.statusCode).json(cachedResult.body);
      return;
    }

    // Store the original json method
    const originalJson = res.json.bind(res);

    // Override json to capture the response
    res.json = (body: unknown): Response => {
      // Store the result for idempotency
      inMemoryStore.set(idempotencyKey!, {
        statusCode: res.statusCode,
        body,
      });

      idempotencyMetrics.processed.inc({ operation });

      logger.debug({
        event: 'idempotency_stored',
        idempotencyKey,
        operation,
        statusCode: res.statusCode,
      });

      return originalJson(body);
    };

    next();
  };
}

/**
 * Redis-based idempotency handler for distributed deployments
 */
export class RedisIdempotencyHandler {
  private redis: Redis;
  private prefix: string;
  private expirySeconds: number;

  constructor(redis: Redis, options: IdempotencyHandlerOptions = {}) {
    this.redis = redis;
    this.prefix = options.prefix || 'idem';
    this.expirySeconds = options.expirySeconds || 300; // 5 minutes
  }

  /**
   * Check if operation was already processed
   */
  async check(idempotencyKey: string): Promise<{ result: unknown } | null> {
    try {
      const result = await this.redis.get(`${this.prefix}:${idempotencyKey}`);
      if (result) {
        return JSON.parse(result);
      }
    } catch (error) {
      logger.error({
        event: 'idempotency_check_error',
        idempotencyKey,
        error: (error as Error).message,
      });
    }
    return null;
  }

  /**
   * Store operation result
   */
  async store(idempotencyKey: string, operation: string, result: unknown): Promise<void> {
    try {
      await this.redis.setex(
        `${this.prefix}:${idempotencyKey}`,
        this.expirySeconds,
        JSON.stringify({
          operation,
          result,
          timestamp: Date.now(),
        })
      );

      logger.debug({
        event: 'idempotency_stored_redis',
        idempotencyKey,
        operation,
      });
    } catch (error) {
      logger.error({
        event: 'idempotency_store_error',
        idempotencyKey,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Process operation with idempotency
   */
  async process<T>(
    idempotencyKey: string,
    operation: string,
    fn: () => Promise<T>
  ): Promise<ProcessResult<T>> {
    // Check if already processed
    const cached = await this.check(idempotencyKey);
    if (cached) {
      auditLogger.logIdempotencySkip(idempotencyKey, operation);
      idempotencyMetrics.duplicates.inc({ operation });

      return {
        processed: false,
        duplicate: true,
        result: cached.result as T,
      };
    }

    // Try to acquire lock using SETNX
    const lockKey = `${this.prefix}:lock:${idempotencyKey}`;
    const acquired = await this.redis.set(lockKey, '1', 'EX', 30, 'NX');

    if (!acquired) {
      // Another process is handling this
      logger.info({
        event: 'idempotency_lock_failed',
        idempotencyKey,
        operation,
      });

      // Wait and check for result
      await new Promise((r) => setTimeout(r, 100));
      const retryResult = await this.check(idempotencyKey);
      if (retryResult) {
        return {
          processed: false,
          duplicate: true,
          result: retryResult.result as T,
        };
      }

      // Still no result, let it proceed (edge case)
    }

    try {
      // Execute the operation
      const result = await fn();

      // Store result
      await this.store(idempotencyKey, operation, result);
      idempotencyMetrics.processed.inc({ operation });

      return {
        processed: true,
        duplicate: false,
        result,
      };
    } finally {
      // Release lock
      await this.redis.del(lockKey);
    }
  }
}

/**
 * Create idempotency handler from Redis client
 */
export function createRedisIdempotencyHandler(
  redis: Redis,
  options: IdempotencyHandlerOptions = {}
): RedisIdempotencyHandler {
  return new RedisIdempotencyHandler(redis, options);
}

/**
 * Cleanup function for graceful shutdown
 */
export function cleanup(): void {
  inMemoryStore.destroy();
}

export default {
  generateIdempotencyKey,
  idempotencyMiddleware,
  createRedisIdempotencyHandler,
  cleanup,
};
