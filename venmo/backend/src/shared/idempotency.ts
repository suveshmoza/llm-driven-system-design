/**
 * Idempotency Middleware for Payment Operations
 *
 * WHY idempotency is CRITICAL for money transfers:
 *
 * 1. NETWORK FAILURES: If a user's network drops after clicking "Send" but
 *    before receiving the response, they don't know if the transfer succeeded.
 *    They'll likely retry. Without idempotency, they could send money twice.
 *
 * 2. CLIENT RETRIES: Mobile apps automatically retry failed requests. A timeout
 *    doesn't mean the request failed - the server may have processed it. Each
 *    retry without idempotency could create another transfer.
 *
 * 3. ACCIDENTAL DOUBLE-CLICKS: Users sometimes click buttons multiple times.
 *    Without idempotency, this could result in multiple charges.
 *
 * 4. LOAD BALANCER RETRIES: Infrastructure like load balancers may retry
 *    requests that appear failed. The backend needs to detect these duplicates.
 *
 * How it works:
 * - Client generates a unique idempotency key (UUID) for each logical operation
 * - Server stores the key with the request result
 * - If same key is seen again, return the cached result instead of processing again
 * - Keys expire after 24 hours to prevent unbounded storage growth
 *
 * Key format: Client generates UUID v4 (e.g., "550e8400-e29b-41d4-a716-446655440000")
 * The key should be generated when user clicks "Send", not on page load.
 */

import type { Request, Response, NextFunction } from 'express';
import type pg from 'pg';
import { redis } from '../db/redis.js';
import { logger } from './logger.js';
import { idempotencyCacheHits } from './metrics.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

// Idempotency key prefix and TTL
const IDEMPOTENCY_PREFIX = 'idempotency:';
const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 hours in seconds

// Status values for idempotency entries
export const STATUS = {
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type IdempotencyStatus = typeof STATUS[keyof typeof STATUS];

export interface IdempotencyResponse {
  status: IdempotencyStatus;
  timestamp: number;
  response?: unknown;
  statusCode?: number;
}

export interface IdempotencyCheckResult {
  isNew: boolean;
  existingResponse: IdempotencyResponse | null;
}

export interface IdempotencyOptions {
  required?: boolean;
}

/**
 * Get the idempotency key from request headers
 */
export function getIdempotencyKey(req: Request): string | null {
  // Check multiple header names (different client conventions)
  return (
    (req.headers['idempotency-key'] as string | undefined) ||
    (req.headers['x-idempotency-key'] as string | undefined) ||
    (req.headers['x-request-id'] as string | undefined) ||
    null
  );
}

/**
 * Build Redis key for idempotency
 */
function buildRedisKey(userId: string, key: string, operation: string): string {
  return `${IDEMPOTENCY_PREFIX}${operation}:${userId}:${key}`;
}

/**
 * Check and set idempotency status (atomic operation)
 *
 * Uses Redis SET NX (set if not exists) for atomic check-and-set.
 * This prevents race conditions when two concurrent requests arrive
 * with the same idempotency key.
 */
export async function checkIdempotency(
  userId: string,
  key: string,
  operation: string
): Promise<IdempotencyCheckResult> {
  const redisKey = buildRedisKey(userId, key, operation);

  // Try to set the key with NX (only if not exists)
  // This is atomic - only one request can succeed
  const setResult = await redis.set(
    redisKey,
    JSON.stringify({ status: STATUS.PROCESSING, timestamp: Date.now() }),
    'EX',
    IDEMPOTENCY_TTL,
    'NX'
  );

  if (setResult === 'OK') {
    // This is a new request - we got the lock
    return { isNew: true, existingResponse: null };
  }

  // Key already exists - check the status
  const existingData = await redis.get(redisKey);

  if (!existingData) {
    // Key expired between our operations (extremely rare)
    // Retry the set
    return checkIdempotency(userId, key, operation);
  }

  const parsed = JSON.parse(existingData) as IdempotencyResponse;

  // Update metrics
  idempotencyCacheHits.inc();

  logger.info({
    event: 'idempotency_cache_hit',
    userId,
    operation,
    idempotencyKey: key,
    cachedStatus: parsed.status,
  });

  return { isNew: false, existingResponse: parsed };
}

/**
 * Store the result of an idempotent operation
 */
export async function storeIdempotencyResult(
  userId: string,
  key: string,
  operation: string,
  status: IdempotencyStatus,
  response: unknown
): Promise<void> {
  const redisKey = buildRedisKey(userId, key, operation);

  await redis.set(
    redisKey,
    JSON.stringify({
      status,
      timestamp: Date.now(),
      response,
    }),
    'EX',
    IDEMPOTENCY_TTL
  );
}

/**
 * Express middleware factory for idempotent operations
 *
 * Usage:
 *   router.post('/send', authMiddleware, idempotencyMiddleware('transfer'), async (req, res) => {
 *     // Your handler
 *   });
 */
export function idempotencyMiddleware(
  operation: string,
  options: IdempotencyOptions = {}
) {
  const { required = true } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const idempotencyKey = getIdempotencyKey(req);

    // Check if key is required but not provided
    if (!idempotencyKey) {
      if (required) {
        logger.warn({
          event: 'idempotency_key_missing',
          operation,
          userId: authReq.user?.id,
          path: req.path,
        });
        res.status(400).json({
          error: 'Idempotency-Key header is required for this operation',
          code: 'IDEMPOTENCY_KEY_REQUIRED',
        });
        return;
      }
      // Not required, proceed without idempotency
      next();
      return;
    }

    // Validate key format (should be UUID-like or at least reasonable length)
    if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      res.status(400).json({
        error: 'Invalid Idempotency-Key format',
        code: 'INVALID_IDEMPOTENCY_KEY',
      });
      return;
    }

    // Store key in request for later use
    authReq.idempotencyKey = idempotencyKey;

    try {
      const { isNew, existingResponse } = await checkIdempotency(
        authReq.user.id,
        idempotencyKey,
        operation
      );

      if (!isNew && existingResponse) {
        // Duplicate request detected
        if (existingResponse.status === STATUS.PROCESSING) {
          // Previous request is still processing - return conflict
          res.status(409).json({
            error: 'A request with this Idempotency-Key is currently being processed',
            code: 'REQUEST_IN_PROGRESS',
          });
          return;
        }

        if (existingResponse.status === STATUS.COMPLETED) {
          // Return cached successful response
          res.status(200).json({
            ...(existingResponse.response as object),
            _cached: true,
          });
          return;
        }

        if (existingResponse.status === STATUS.FAILED) {
          // Return cached error response
          // We return the same error so client knows the original result
          const failedResponse = existingResponse.response as { statusCode?: number };
          res.status(failedResponse?.statusCode || 400).json({
            ...(existingResponse.response as object),
            _cached: true,
          });
          return;
        }
      }

      // Store reference to storeIdempotencyResult for handler to use
      authReq.storeIdempotencyResult = async (status: string, response: unknown) => {
        await storeIdempotencyResult(
          authReq.user.id,
          idempotencyKey,
          operation,
          status as IdempotencyStatus,
          response
        );
      };

      next();
    } catch (error) {
      logger.error({
        event: 'idempotency_check_failed',
        error: (error as Error).message,
        operation,
        userId: authReq.user?.id,
      });

      // If Redis is down, we should still process the request
      // but log this as a critical issue
      logger.error({
        event: 'idempotency_redis_failure',
        error: (error as Error).message,
        warning: 'Processing request without idempotency protection',
      });

      // Add a flag so the handler knows idempotency check failed
      authReq.idempotencyFailed = true;
      next();
    }
  };
}

/**
 * Also store idempotency in database for persistence beyond cache TTL
 * Used for critical operations that need long-term duplicate detection
 */
export async function checkDatabaseIdempotency(
  pool: pg.Pool,
  tableName: string,
  userId: string,
  idempotencyKey: string
): Promise<{ id: string; status: string; created_at: Date } | null> {
  // Check for existing record with this idempotency key
  const existing = await pool.query(
    `SELECT id, status, created_at FROM ${tableName}
     WHERE sender_id = $1 AND idempotency_key = $2`,
    [userId, idempotencyKey]
  );

  return existing.rows[0] || null;
}
