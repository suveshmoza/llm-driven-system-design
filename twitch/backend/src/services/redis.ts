import { createClient, RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;
let subscriberClient: RedisClientType | null = null;

/** Initializes Redis main and subscriber clients for commands and pub/sub. */
async function initRedis(): Promise<RedisClientType> {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';

  // Main client for commands
  redisClient = createClient({ url });
  redisClient.on('error', (err: Error) => console.error('Redis Client Error:', err));
  await redisClient.connect();

  // Separate client for subscriptions
  subscriberClient = redisClient.duplicate();
  await subscriberClient.connect();

  return redisClient;
}

/** Returns the initialized Redis command client. */
function getRedisClient(): RedisClientType {
  if (!redisClient) throw new Error('Redis not initialized');
  return redisClient;
}

/** Returns the dedicated Redis subscriber client for pub/sub operations. */
function getSubscriberClient(): RedisClientType {
  if (!subscriberClient) throw new Error('Redis not initialized');
  return subscriberClient;
}

/** Publishes a JSON-serialized message to a Redis pub/sub channel. */
async function publishMessage(channel: string, message: unknown): Promise<number> {
  if (!redisClient) throw new Error('Redis not initialized');
  return redisClient.publish(channel, JSON.stringify(message));
}

/** Subscribes to a Redis pub/sub channel and invokes the callback on each message. */
async function subscribe(channel: string, callback: (message: unknown) => void): Promise<void> {
  if (!subscriberClient) throw new Error('Redis not initialized');
  await subscriberClient.subscribe(channel, (message: string) => {
    try {
      callback(JSON.parse(message));
    } catch {
      callback(message);
    }
  });
}

/** Unsubscribes from a Redis pub/sub channel. */
async function unsubscribe(channel: string): Promise<void> {
  if (!subscriberClient) throw new Error('Redis not initialized');
  await subscriberClient.unsubscribe(channel);
}

// Rate limiting
interface RateLimitResult {
  allowed: boolean;
  waitMs?: number;
}

/** Enforces per-user per-channel chat rate limiting using Redis key expiration. */
async function checkRateLimit(
  userId: string | number,
  channelId: string | number,
  cooldownSeconds: number = 1
): Promise<RateLimitResult> {
  if (!redisClient) throw new Error('Redis not initialized');
  const key = `ratelimit:${channelId}:${userId}`;
  const lastMessage = await redisClient.get(key);

  if (lastMessage) {
    const elapsed = Date.now() - parseInt(lastMessage);
    if (elapsed < cooldownSeconds * 1000) {
      return { allowed: false, waitMs: (cooldownSeconds * 1000) - elapsed };
    }
  }

  await redisClient.set(key, Date.now().toString(), { EX: cooldownSeconds });
  return { allowed: true };
}

// Session management
/** Stores a user session ID mapped to a user ID with configurable TTL. */
async function setSession(sessionId: string, userId: number, ttlSeconds: number = 86400): Promise<void> {
  if (!redisClient) throw new Error('Redis not initialized');
  await redisClient.set(`session:${sessionId}`, userId.toString(), { EX: ttlSeconds });
}

/** Retrieves the user ID associated with a session ID from Redis. */
async function getSession(sessionId: string): Promise<number | null> {
  if (!redisClient) throw new Error('Redis not initialized');
  const userId = await redisClient.get(`session:${sessionId}`);
  return userId ? parseInt(userId) : null;
}

/** Deletes a user session from Redis on logout. */
async function deleteSession(sessionId: string): Promise<void> {
  if (!redisClient) throw new Error('Redis not initialized');
  await redisClient.del(`session:${sessionId}`);
}

// Viewer counts
/** Updates the cached viewer count for a channel in Redis. */
async function updateViewerCount(channelId: string | number, count: number): Promise<void> {
  if (!redisClient) throw new Error('Redis not initialized');
  await redisClient.set(`viewers:${channelId}`, count.toString());
}

/** Retrieves the current viewer count for a channel from Redis. */
async function getViewerCount(channelId: string | number): Promise<number> {
  if (!redisClient) throw new Error('Redis not initialized');
  const count = await redisClient.get(`viewers:${channelId}`);
  return count ? parseInt(count) : 0;
}

export {
  initRedis,
  getRedisClient,
  getSubscriberClient,
  publishMessage,
  subscribe,
  unsubscribe,
  checkRateLimit,
  setSession,
  getSession,
  deleteSession,
  updateViewerCount,
  getViewerCount
};
