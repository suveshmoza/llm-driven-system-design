import { createClient } from 'redis';

/** Redis client instance for session management and signing session caching. */
export const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => {
  console.error('Redis error:', err);
});

/** Connects the Redis client to the server. */
export async function initializeRedis() {
  await redisClient.connect();
}

// Session management helpers
/** Stores a user session token in Redis with a configurable TTL (default 24 hours). */
export async function setSession(token: string, userId: string, expiresInSeconds: number = 86400): Promise<void> {
  await redisClient.setEx(`session:${token}`, expiresInSeconds, userId);
}

/** Retrieves the user ID associated with a session token. */
export async function getSession(token: string): Promise<string | null> {
  return await redisClient.get(`session:${token}`);
}

/** Removes a session token from Redis, invalidating the session. */
export async function deleteSession(token: string): Promise<void> {
  await redisClient.del(`session:${token}`);
}

// Signing session helpers
/** Caches signing session data in Redis with a configurable TTL (default 1 hour). */
export async function setSigningSession(token: string, data: unknown, expiresInSeconds: number = 3600): Promise<void> {
  await redisClient.setEx(`signing:${token}`, expiresInSeconds, JSON.stringify(data));
}

/** Retrieves cached signing session data for a given access token. */
export async function getSigningSession(token: string): Promise<unknown> {
  const data = await redisClient.get(`signing:${token}`);
  return data ? JSON.parse(data) : null;
}

// SMS verification codes
/** Stores an SMS verification code with a configurable TTL (default 5 minutes). */
export async function setSMSCode(recipientId: string, code: string, expiresInSeconds: number = 300): Promise<void> {
  await redisClient.setEx(`sms_code:${recipientId}`, expiresInSeconds, code);
}

/** Retrieves a pending SMS verification code for a recipient. */
export async function getSMSCode(recipientId: string): Promise<string | null> {
  return await redisClient.get(`sms_code:${recipientId}`);
}

/** Removes an SMS verification code after successful verification or expiration. */
export async function deleteSMSCode(recipientId: string): Promise<void> {
  await redisClient.del(`sms_code:${recipientId}`);
}
