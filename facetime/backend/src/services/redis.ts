import { createClient, RedisClientType } from 'redis';

/** Singleton Redis client instance */
let redisClient: RedisClientType | null = null;

/**
 * Returns the singleton Redis client, creating it if necessary.
 * Used for session management, presence tracking, and call state storage.
 * Ensures only one connection is maintained throughout the application.
 *
 * @returns Promise resolving to the connected Redis client
 */
export async function getRedisClient(): Promise<RedisClientType> {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });

    redisClient.on('error', (err) => {
      console.error('Redis Client Error', err);
    });

    redisClient.on('connect', () => {
      console.log('Redis connected');
    });

    await redisClient.connect();
  }
  return redisClient;
}

/**
 * Closes the Redis connection gracefully.
 * Called during server shutdown to ensure clean resource cleanup.
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

/**
 * Marks a user's device as online in Redis.
 * Used for presence tracking so other users can see availability.
 * Sets a 1-hour TTL to auto-expire stale presence data.
 *
 * @param userId - The user ID to mark as online
 * @param deviceId - The specific device that came online
 */
export async function setUserOnline(userId: string, deviceId: string): Promise<void> {
  const client = await getRedisClient();
  const key = `presence:${userId}`;
  await client.hSet(key, deviceId, JSON.stringify({
    online: true,
    lastSeen: Date.now(),
  }));
  await client.expire(key, 3600); // 1 hour TTL
}

/**
 * Removes a device from a user's presence record.
 * Called when a WebSocket connection closes to update availability.
 *
 * @param userId - The user ID whose device went offline
 * @param deviceId - The specific device to remove from presence
 */
export async function setUserOffline(userId: string, deviceId: string): Promise<void> {
  const client = await getRedisClient();
  const key = `presence:${userId}`;
  await client.hDel(key, deviceId);
}

/**
 * Retrieves all online devices for a user.
 * Returns a hash of deviceId to presence info for determining
 * which devices can receive incoming calls.
 *
 * @param userId - The user ID to look up
 * @returns Promise resolving to a record of device presence data
 */
export async function getUserPresence(userId: string): Promise<Record<string, unknown>> {
  const client = await getRedisClient();
  const key = `presence:${userId}`;
  return await client.hGetAll(key);
}

/**
 * Checks if a user has any online devices.
 * Used to determine if calls can be delivered to the user.
 *
 * @param userId - The user ID to check
 * @returns Promise resolving to true if user has at least one online device
 */
export async function isUserOnline(userId: string): Promise<boolean> {
  const presence = await getUserPresence(userId);
  return Object.keys(presence).length > 0;
}

/**
 * Stores active call state in Redis.
 * Enables fast lookup of call participants and state during
 * signaling without database queries. Has a 2-hour TTL.
 *
 * @param callId - Unique identifier for the call
 * @param state - Call state object including participants and status
 */
export async function setCallState(callId: string, state: Record<string, unknown>): Promise<void> {
  const client = await getRedisClient();
  await client.set(`call:${callId}`, JSON.stringify(state), { EX: 7200 }); // 2 hour TTL
}

/**
 * Retrieves call state from Redis.
 * Used to route signaling messages and verify call participants.
 *
 * @param callId - Unique identifier for the call
 * @returns Promise resolving to call state object or null if not found
 */
export async function getCallState(callId: string): Promise<Record<string, unknown> | null> {
  const client = await getRedisClient();
  const data = await client.get(`call:${callId}`);
  return data ? JSON.parse(data) : null;
}

/**
 * Removes call state from Redis when a call ends.
 * Called during call cleanup to free Redis memory.
 *
 * @param callId - Unique identifier for the call to delete
 */
export async function deleteCallState(callId: string): Promise<void> {
  const client = await getRedisClient();
  await client.del(`call:${callId}`);
}
