import { redis } from './redis.js';

const IDEMPOTENCY_TTL = 86400; // 24 hours

/** Result of an idempotency key lookup. */
export interface IdempotencyResult {
  exists: boolean;
  response?: string;
}

/**
 * Checks if an idempotency key has already been processed.
 * @param key - Unique idempotency key from the client.
 * @returns Whether the key exists and the cached response if available.
 */
export async function checkIdempotencyKey(key: string): Promise<IdempotencyResult> {
  const existing = await redis.get(`idempotency:${key}`);
  if (existing) {
    return { exists: true, response: existing };
  }
  return { exists: false };
}

/**
 * Stores the response for an idempotency key with a 24-hour TTL.
 * @param key - Unique idempotency key.
 * @param response - Response object to cache.
 */
export async function setIdempotencyKey(
  key: string,
  response: Record<string, unknown>
): Promise<void> {
  await redis.setex(`idempotency:${key}`, IDEMPOTENCY_TTL, JSON.stringify(response));
}

/** Removes an idempotency key from Redis. */
export async function deleteIdempotencyKey(key: string): Promise<void> {
  await redis.del(`idempotency:${key}`);
}
