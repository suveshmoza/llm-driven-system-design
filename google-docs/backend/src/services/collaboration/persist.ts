/**
 * @fileoverview Database persistence logic for collaborative editing.
 * @description Handles debounced persistence of operations with circuit breaker protection.
 * Manages saving document operations to PostgreSQL and creating version snapshots.
 * @module services/collaboration/persist
 */

import type { Operation } from '../../types/index.js';
import pool from '../../utils/db.js';
import { redisPub } from '../../utils/redis.js';
import logger from '../../shared/logger.js';
import { createCircuitBreaker, OT_SYNC_OPTIONS, isCircuitOpen } from '../../shared/circuitBreaker.js';
import { persistTimers } from './state.js';

/**
 * Persists an operation to the database.
 *
 * @description Stores the operation in the operations table, updates the document's
 * current version, and creates a snapshot every 100 versions for efficient history
 * retrieval. Uses upsert semantics to handle duplicate operations gracefully.
 *
 * @param {string} documentId - UUID of the document
 * @param {number} version - Version number of the operation
 * @param {Operation[]} operation - Array of operations to persist
 * @param {string} userId - UUID of the user who performed the operation
 * @returns {Promise<void>} Resolves when persistence is complete
 * @throws {Error} Database errors if the insert or update fails
 *
 * @example
 * await persistOperationToDb(
 *   'doc-456',
 *   43,
 *   [{ type: 'insert', pos: 10, text: 'Hello' }],
 *   'user-123'
 * );
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

/**
 * Circuit breaker for database persistence.
 *
 * @description Wraps persistOperationToDb with circuit breaker protection to prevent
 * cascading failures when the database is slow or unavailable. Opens the circuit
 * after repeated failures and automatically attempts recovery.
 *
 * @type {CircuitBreaker}
 */
export const persistCircuitBreaker = createCircuitBreaker(
  'db-persist',
  persistOperationToDb,
  OT_SYNC_OPTIONS
);

/**
 * Publishes a message to a Redis channel.
 *
 * @description Internal helper function used by the Redis circuit breaker.
 * Wraps the Redis publish call for circuit breaker integration.
 *
 * @param {string} channel - Redis channel name to publish to
 * @param {string} message - JSON-stringified message to publish
 * @returns {Promise<void>} Resolves when the message is published
 * @throws {Error} Redis connection errors
 */
async function publishToRedis(channel: string, message: string): Promise<void> {
  await redisPub.publish(channel, message);
}

/**
 * Circuit breaker for Redis publishing.
 *
 * @description Wraps Redis publish operations with circuit breaker protection.
 * Prevents overwhelming Redis during outages and enables graceful degradation.
 *
 * @type {CircuitBreaker}
 */
export const redisPublishCircuitBreaker = createCircuitBreaker(
  'redis-publish',
  publishToRedis,
  OT_SYNC_OPTIONS
);

/**
 * Debounces database persistence of operations.
 *
 * @description Batches rapid edits to reduce database writes. When called multiple
 * times for the same document within the debounce window (1 second), only the last
 * call is executed. Uses circuit breaker to protect against slow/failing database.
 * If the circuit is open, automatically retries after the reset timeout.
 *
 * @param {string} documentId - UUID of the document
 * @param {number} version - Version number of the operation
 * @param {Operation[]} operation - Array of operations to persist
 * @param {string} userId - UUID of the user who performed the operation
 * @returns {void}
 *
 * @example
 * // Called on every keystroke, but only persists after 1 second of inactivity
 * debouncedPersist('doc-456', 43, [{ type: 'insert', pos: 10, text: 'H' }], 'user-123');
 * debouncedPersist('doc-456', 44, [{ type: 'insert', pos: 11, text: 'e' }], 'user-123');
 * debouncedPersist('doc-456', 45, [{ type: 'insert', pos: 12, text: 'l' }], 'user-123');
 * // Only version 45 is persisted after 1 second
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
