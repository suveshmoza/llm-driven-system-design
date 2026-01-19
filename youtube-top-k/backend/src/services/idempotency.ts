/**
 * Idempotency service for preventing duplicate view event processing
 *
 * Uses Redis to track processed idempotency keys with configurable TTL.
 * This prevents the same view event from being counted multiple times
 * due to network retries, duplicate requests, or client-side issues.
 *
 * WHY IDEMPOTENCY MATTERS:
 * 1. Network retries: Clients may retry requests on timeout, causing duplicate views
 * 2. Double-clicks: Users may accidentally trigger multiple view events
 * 3. Client bugs: Frontend code may fire events multiple times
 * 4. Load balancer retries: Some LBs retry on backend failures
 *
 * Without idempotency, a video's view count could be artificially inflated,
 * leading to incorrect trending rankings.
 */

import { getRedisClient } from '../services/redis.js';
import { IDEMPOTENCY_CONFIG } from '../shared/config.js';
import { logIdempotencyCheck } from '../shared/logger.js';
import { duplicateViewEvents } from '../shared/metrics.js';

export interface IdempotencyCheckResult {
  isDuplicate: boolean;
  key: string;
}

export interface ProcessViewResult {
  processed: boolean;
  duplicate: boolean;
  key: string;
}

export interface IdempotencyOptions {
  sessionId?: string;
  requestId?: string;
}

export interface IdempotencyStats {
  keyCount: number;
  prefix: string;
  ttlSeconds: number;
}

/**
 * Generate an idempotency key for a view event
 */
export function generateIdempotencyKey(
  videoId: string,
  sessionId?: string,
  requestId?: string
): string {
  // If a request ID is provided (e.g., from X-Request-Id header), use it
  if (requestId) {
    return `${IDEMPOTENCY_CONFIG.keyPrefix}${requestId}`;
  }

  // Otherwise, generate a key based on video + session + timestamp bucket
  // Use 10-second buckets to allow some time tolerance for duplicates
  const timeBucket = Math.floor(Date.now() / 10000);
  return `${IDEMPOTENCY_CONFIG.keyPrefix}${videoId}:${sessionId || 'anon'}:${timeBucket}`;
}

/**
 * Check if a view event is a duplicate and mark it as processed
 *
 * Uses Redis SETNX (SET if Not eXists) for atomic check-and-set.
 * This is a common pattern for distributed idempotency.
 */
export async function checkAndMarkProcessed(
  idempotencyKey: string
): Promise<IdempotencyCheckResult> {
  const client = await getRedisClient();

  // Use SET with NX (only set if not exists) and EX (expiration)
  // Returns 'OK' if the key was set, null if it already existed
  const result = await client.set(idempotencyKey, '1', {
    NX: true, // Only set if not exists
    EX: IDEMPOTENCY_CONFIG.keyTtlSeconds, // Expire after TTL
  });

  const isDuplicate = result === null;

  logIdempotencyCheck(idempotencyKey, isDuplicate);

  return {
    isDuplicate,
    key: idempotencyKey,
  };
}

/**
 * Check if a view event is a duplicate (without marking)
 *
 * Useful for read-only checks or reporting.
 */
export async function isDuplicate(idempotencyKey: string): Promise<boolean> {
  const client = await getRedisClient();
  const exists = await client.exists(idempotencyKey);
  return exists === 1;
}

/**
 * Process a view event with idempotency check
 *
 * This is the main function to use for view event processing.
 * It wraps the idempotency check and provides a clean interface.
 */
export async function processViewWithIdempotency(
  videoId: string,
  category: string,
  options: IdempotencyOptions,
  processCallback: () => Promise<void>
): Promise<ProcessViewResult> {
  const { sessionId, requestId } = options;

  // Generate idempotency key
  const key = generateIdempotencyKey(videoId, sessionId, requestId);

  // Check if duplicate
  const result = await checkAndMarkProcessed(key);

  if (result.isDuplicate) {
    // Track duplicate for metrics
    duplicateViewEvents.inc({ category: category || 'all' });

    return {
      processed: false,
      duplicate: true,
      key,
    };
  }

  // Not a duplicate - process the view
  await processCallback();

  return {
    processed: true,
    duplicate: false,
    key,
  };
}

/**
 * Clear an idempotency key (for testing or rollback)
 */
export async function clearIdempotencyKey(idempotencyKey: string): Promise<boolean> {
  const client = await getRedisClient();
  const result = await client.del(idempotencyKey);
  return result === 1;
}

/**
 * Get statistics about idempotency keys (for monitoring)
 */
export async function getIdempotencyStats(): Promise<IdempotencyStats> {
  const client = await getRedisClient();

  // Count idempotency keys
  const keys = await client.keys(`${IDEMPOTENCY_CONFIG.keyPrefix}*`);

  return {
    keyCount: keys.length,
    prefix: IDEMPOTENCY_CONFIG.keyPrefix,
    ttlSeconds: IDEMPOTENCY_CONFIG.keyTtlSeconds,
  };
}

export default {
  generateIdempotencyKey,
  checkAndMarkProcessed,
  isDuplicate,
  processViewWithIdempotency,
  clearIdempotencyKey,
  getIdempotencyStats,
};
