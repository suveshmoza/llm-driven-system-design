import { Request } from 'express';
import { PoolClient } from 'pg';
import { query, getClient } from '../db/index.js';
import logger from './logger.js';
import { idempotencyDuplicates } from './metrics.js';

/**
 * Idempotency handling for PR and Issue creation
 *
 * Prevents duplicate resources from:
 * - Webhook retries
 * - Network timeouts with client retries
 * - Double-clicks in UI
 *
 * How it works:
 * 1. Client provides idempotency key in request header
 * 2. Server checks if key exists in database
 * 3. If exists: return cached response
 * 4. If not: execute operation and store result
 *
 * Keys are automatically cleaned up after 24 hours
 */

const IDEMPOTENCY_TTL_HOURS = 24;

interface IdempotencyResult<T> {
  cached: boolean;
  response: T;
}

interface OperationResult<T> {
  resourceId: number;
  response: T;
}

/**
 * Check if an idempotency key already exists
 */
export async function checkIdempotencyKey<T>(key: string): Promise<T | null> {
  if (!key) return null;

  try {
    const result = await query(
      `SELECT resource_id, response_body, operation_type
       FROM idempotency_keys
       WHERE key = $1 AND created_at > NOW() - INTERVAL '${IDEMPOTENCY_TTL_HOURS} hours'`,
      [key]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0] as { resource_id: number; response_body: T; operation_type: string };
      logger.info({ key, operationType: row.operation_type, resourceId: row.resource_id }, 'Idempotency key hit');
      idempotencyDuplicates.inc({ operation: row.operation_type });
      return row.response_body;
    }

    return null;
  } catch (err) {
    logger.error({ err, key }, 'Error checking idempotency key');
    return null;
  }
}

/**
 * Store an idempotency key with the operation result
 */
export async function storeIdempotencyKey<T>(
  key: string,
  operationType: string,
  resourceId: number,
  responseBody: T
): Promise<void> {
  if (!key) return;

  try {
    await query(
      `INSERT INTO idempotency_keys (key, operation_type, resource_id, response_body)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO NOTHING`,
      [key, operationType, resourceId, JSON.stringify(responseBody)]
    );

    logger.debug({ key, operationType, resourceId }, 'Stored idempotency key');
  } catch (err) {
    logger.error({ err, key, operationType }, 'Error storing idempotency key');
  }
}

/**
 * Execute an operation with idempotency protection
 */
export async function withIdempotency<T>(
  idempotencyKey: string,
  operationType: string,
  operation: () => Promise<OperationResult<T>>
): Promise<IdempotencyResult<T>> {
  // Check for existing operation with this key
  const cached = await checkIdempotencyKey<T>(idempotencyKey);
  if (cached) {
    return { cached: true, response: cached };
  }

  // Execute the operation
  const result = await operation();

  // Store the idempotency key
  if (idempotencyKey) {
    await storeIdempotencyKey(idempotencyKey, operationType, result.resourceId, result.response);
  }

  return { cached: false, response: result.response };
}

/**
 * Execute an operation with idempotency in a transaction
 * This ensures atomicity - either both the operation and key storage succeed, or neither does
 */
export async function withIdempotencyTransaction<T>(
  idempotencyKey: string,
  operationType: string,
  operation: (tx: PoolClient) => Promise<OperationResult<T>>
): Promise<IdempotencyResult<T>> {
  // Check for existing operation first (outside transaction)
  const cached = await checkIdempotencyKey<T>(idempotencyKey);
  if (cached) {
    return { cached: true, response: cached };
  }

  // Get a client for transaction
  const client = await getClient();

  try {
    await client.query('BEGIN');

    // Execute the operation
    const result = await operation(client);

    // Store idempotency key in same transaction
    if (idempotencyKey) {
      await client.query(
        `INSERT INTO idempotency_keys (key, operation_type, resource_id, response_body)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO NOTHING`,
        [idempotencyKey, operationType, result.resourceId, JSON.stringify(result.response)]
      );
    }

    await client.query('COMMIT');
    return { cached: false, response: result.response };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Extract idempotency key from request
 */
export function getIdempotencyKey(req: Request): string | null {
  return (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string) || null;
}

/**
 * Clean up expired idempotency keys
 * This should be run periodically (e.g., via cron job)
 */
export async function cleanupExpiredKeys(): Promise<number> {
  try {
    const result = await query(
      `DELETE FROM idempotency_keys WHERE created_at < NOW() - INTERVAL '${IDEMPOTENCY_TTL_HOURS} hours'`
    );

    logger.info({ deletedCount: result.rowCount }, 'Cleaned up expired idempotency keys');
    return result.rowCount || 0;
  } catch (err) {
    logger.error({ err }, 'Error cleaning up idempotency keys');
    return 0;
  }
}

export default {
  checkIdempotencyKey,
  storeIdempotencyKey,
  withIdempotency,
  withIdempotencyTransaction,
  getIdempotencyKey,
  cleanupExpiredKeys,
};
