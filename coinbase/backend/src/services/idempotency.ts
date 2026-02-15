import { redis } from './redis.js';

const IDEMPOTENCY_TTL = 86400; // 24 hours

export interface IdempotencyResult {
  exists: boolean;
  response?: string;
}

export async function checkIdempotencyKey(key: string): Promise<IdempotencyResult> {
  const existing = await redis.get(`idempotency:${key}`);
  if (existing) {
    return { exists: true, response: existing };
  }
  return { exists: false };
}

export async function setIdempotencyKey(
  key: string,
  response: Record<string, unknown>
): Promise<void> {
  await redis.setex(`idempotency:${key}`, IDEMPOTENCY_TTL, JSON.stringify(response));
}

export async function deleteIdempotencyKey(key: string): Promise<void> {
  await redis.del(`idempotency:${key}`);
}
