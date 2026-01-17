import Redis from "ioredis";

/**
 * Redis client for caching, pub/sub, rate limiting, and session management.
 * Uses lazy connection to avoid blocking startup if Redis is temporarily unavailable.
 */
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  lazyConnect: true,
});

redis.on("error", (err) => {
  console.error("Redis connection error:", err);
});

redis.on("connect", () => {
  console.log("Connected to Redis");
});

/**
 * Implements rate limiting using Redis INCR with TTL.
 * Uses a sliding window approach where each key expires after windowSeconds.
 *
 * @param key - Unique identifier for the rate limit (e.g., "ratelimit:ip:192.168.1.1")
 * @param limit - Maximum allowed requests in the window
 * @param windowSeconds - Time window duration in seconds
 * @returns Object indicating if request is allowed and remaining quota
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, windowSeconds);
  }

  return {
    allowed: current <= limit,
    remaining: Math.max(0, limit - current),
  };
}

/**
 * Records that a device is connected to a specific server instance.
 * Used for routing notifications to the correct server via pub/sub.
 *
 * @param deviceId - Device ID that connected
 * @param serverId - Server identifier handling this device's WebSocket
 */
export async function setDeviceConnected(
  deviceId: string,
  serverId: string
): Promise<void> {
  await redis.hset("device:connections", deviceId, serverId);
  await redis.expire("device:connections", 3600); // 1 hour TTL
}

/**
 * Looks up which server a device is connected to.
 *
 * @param deviceId - Device ID to look up
 * @returns Server ID if device is connected, null if offline
 */
export async function getDeviceServer(deviceId: string): Promise<string | null> {
  return redis.hget("device:connections", deviceId);
}

/**
 * Removes a device's connection record when it disconnects.
 *
 * @param deviceId - Device ID that disconnected
 */
export async function removeDeviceConnection(deviceId: string): Promise<void> {
  await redis.hdel("device:connections", deviceId);
}

/**
 * Publishes a notification to a Redis channel for cross-server delivery.
 * Used when the device is connected to a different server than the one
 * receiving the send request.
 *
 * @param channel - Redis channel name (e.g., "notifications:server-3001")
 * @param message - Message object to publish (will be JSON stringified)
 */
export async function publishNotification(
  channel: string,
  message: unknown
): Promise<void> {
  await redis.publish(channel, JSON.stringify(message));
}

/**
 * Subscribes to a notification channel for receiving push requests.
 * Creates a duplicate Redis connection for pub/sub (required by ioredis).
 *
 * @param channel - Redis channel to subscribe to
 * @param callback - Function called with parsed message when notification arrives
 * @returns The subscriber Redis instance (for cleanup on shutdown)
 */
export function subscribeToNotifications(
  channel: string,
  callback: (message: unknown) => void
): Redis {
  const subscriber = redis.duplicate();
  subscriber.subscribe(channel);
  subscriber.on("message", (ch, message) => {
    if (ch === channel) {
      try {
        callback(JSON.parse(message));
      } catch (error) {
        console.error("Failed to parse notification message:", error);
      }
    }
  });
  return subscriber;
}

/**
 * Stores session data in Redis with automatic expiration.
 * Used for admin dashboard authentication.
 *
 * @param token - Session token (used as key)
 * @param data - Session data to store (will be JSON stringified)
 * @param ttlSeconds - Time-to-live in seconds
 */
export async function setSession(
  token: string,
  data: unknown,
  ttlSeconds: number
): Promise<void> {
  await redis.setex(`session:${token}`, ttlSeconds, JSON.stringify(data));
}

/**
 * Retrieves session data from Redis.
 *
 * @param token - Session token to look up
 * @returns Parsed session data or null if expired/not found
 */
export async function getSession<T>(token: string): Promise<T | null> {
  const data = await redis.get(`session:${token}`);
  if (!data) return null;
  return JSON.parse(data) as T;
}

/**
 * Deletes a session from Redis (logout).
 *
 * @param token - Session token to delete
 */
export async function deleteSession(token: string): Promise<void> {
  await redis.del(`session:${token}`);
}

/**
 * Adds a notification to a priority queue for background processing.
 * Different priority levels use separate queues for fair scheduling.
 *
 * @param priority - Notification priority (1, 5, or 10)
 * @param notification - Notification data to queue
 */
export async function enqueueNotification(
  priority: number,
  notification: unknown
): Promise<void> {
  const queue = `notification:queue:${priority}`;
  await redis.lpush(queue, JSON.stringify(notification));
}

/**
 * Removes and returns a notification from a priority queue.
 * Uses RPOP for FIFO ordering within each priority level.
 *
 * @param priority - Priority queue to dequeue from
 * @returns Parsed notification or null if queue is empty
 */
export async function dequeueNotification(
  priority: number
): Promise<unknown | null> {
  const queue = `notification:queue:${priority}`;
  const data = await redis.rpop(queue);
  if (!data) return null;
  return JSON.parse(data);
}

/**
 * Increments a statistics counter in Redis.
 * Used for tracking metrics like notifications sent, deliveries, etc.
 *
 * @param key - Stat key name (will be prefixed with "stats:")
 */
export async function incrementStat(key: string): Promise<void> {
  await redis.incr(`stats:${key}`);
}

/**
 * Retrieves a statistics counter value.
 *
 * @param key - Stat key name (will be prefixed with "stats:")
 * @returns Current counter value, or 0 if not set
 */
export async function getStat(key: string): Promise<number> {
  const value = await redis.get(`stats:${key}`);
  return value ? parseInt(value, 10) : 0;
}

/**
 * Verifies Redis connectivity by sending a PING command.
 * Used for health checks.
 *
 * @returns True if Redis is reachable, false otherwise
 */
export async function checkConnection(): Promise<boolean> {
  try {
    await redis.ping();
    return true;
  } catch (error) {
    console.error("Redis connection failed:", error);
    return false;
  }
}

export default redis;
