import { pool } from './db.js';
import { logger } from './logger.js';
import { idempotencyHits } from './metrics.js';

export interface IdempotencyResult {
  found: boolean;
  response?: unknown;
}

/** Checks whether an idempotency key has a cached response within its TTL. */
export async function checkIdempotencyKey(key: string): Promise<IdempotencyResult> {
  const result = await pool.query(
    `SELECT response FROM idempotency_keys
     WHERE key = $1 AND expires_at > NOW()`,
    [key],
  );

  if (result.rows.length > 0) {
    idempotencyHits.inc();
    logger.info({ key }, 'Idempotency key hit');
    return { found: true, response: result.rows[0].response };
  }

  return { found: false };
}

/** Stores an idempotency key with its response, optionally within an existing transaction. */
export async function storeIdempotencyKey(
  key: string,
  response: unknown,
  client?: import('pg').PoolClient,
): Promise<void> {
  const queryRunner = client || pool;
  await queryRunner.query(
    `INSERT INTO idempotency_keys (key, response)
     VALUES ($1, $2)
     ON CONFLICT (key) DO NOTHING`,
    [key, JSON.stringify(response)],
  );
}

/** Removes expired idempotency keys from the database and returns the count deleted. */
export async function cleanExpiredIdempotencyKeys(): Promise<number> {
  const result = await pool.query(
    'DELETE FROM idempotency_keys WHERE expires_at < NOW()',
  );
  const count = result.rowCount || 0;
  if (count > 0) {
    logger.info({ count }, 'Cleaned expired idempotency keys');
  }
  return count;
}
