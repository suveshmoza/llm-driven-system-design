/**
 * Database persistence logic for collaborative editing.
 * Handles debounced persistence of operations with circuit breaker protection.
 */

import type { Operation } from '../../types/index.js';
import pool from '../../utils/db.js';
import { redisPub } from '../../utils/redis.js';
import logger from '../../shared/logger.js';
import { createCircuitBreaker, OT_SYNC_OPTIONS, isCircuitOpen } from '../../shared/circuitBreaker.js';
import { persistTimers } from './state.js';

/**
 * Persists an operation to the database.
 * Creates snapshots every 100 versions for efficient history retrieval.
 */
async function persistOperationToDb(
  documentId: string,
  version: number,
  operation: Operation[],
  userId: string
): Promise<void> {
  // Store operation
  await pool.query(
    `INSERT INTO operations (document_id, version_number, operation, user_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (document_id, version_number) DO NOTHING`,
    [documentId, version, JSON.stringify(operation), userId]
  );

  // Update document version
  await pool.query(
    `UPDATE documents SET current_version = $1, updated_at = NOW() WHERE id = $2`,
    [version, documentId]
  );

  // Create snapshot every 100 versions
  if (version % 100 === 0) {
    const docResult = await pool.query(
      'SELECT content FROM documents WHERE id = $1',
      [documentId]
    );

    if (docResult.rows.length > 0) {
      await pool.query(
        `INSERT INTO document_versions (document_id, version_number, content, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (document_id, version_number) DO NOTHING`,
        [documentId, version, docResult.rows[0].content, userId]
      );
    }
  }
}

/** Circuit breaker for database persistence */
export const persistCircuitBreaker = createCircuitBreaker(
  'db-persist',
  persistOperationToDb,
  OT_SYNC_OPTIONS
);

/**
 * Publishes a message to a Redis channel.
 */
async function publishToRedis(channel: string, message: string): Promise<void> {
  await redisPub.publish(channel, message);
}

/** Circuit breaker for Redis publishing */
export const redisPublishCircuitBreaker = createCircuitBreaker(
  'redis-publish',
  publishToRedis,
  OT_SYNC_OPTIONS
);

/**
 * Debounces database persistence of operations.
 * Batches rapid edits to reduce database writes.
 * Uses circuit breaker to protect against slow/failing database.
 */
export function debouncedPersist(
  documentId: string,
  version: number,
  operation: Operation[],
  userId: string
): void {
  const existingTimer = persistTimers.get(documentId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  persistTimers.set(documentId, setTimeout(async () => {
    try {
      await persistCircuitBreaker.fire(documentId, version, operation, userId);
      logger.debug({ documentId, version }, 'Operation persisted to database');
    } catch (error) {
      if (isCircuitOpen(error)) {
        logger.warn({ documentId, version }, 'Database persist circuit open, operation queued');
        // Retry after circuit reset
        setTimeout(() => {
          debouncedPersist(documentId, version, operation, userId);
        }, 15000);
      } else {
        logger.error({ error, documentId, version }, 'Failed to persist operation');
      }
    }

    persistTimers.delete(documentId);
  }, 1000));
}
