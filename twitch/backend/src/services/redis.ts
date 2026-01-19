import { createClient, RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;
let subscriberClient: RedisClientType | null = null;

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

function getRedisClient(): RedisClientType {
  if (!redisClient) throw new Error('Redis not initialized');
  return redisClient;
}

function getSubscriberClient(): RedisClientType {
  if (!subscriberClient) throw new Error('Redis not initialized');
  return subscriberClient;
}

async function publishMessage(channel: string, message: unknown): Promise<number> {
  if (!redisClient) throw new Error('Redis not initialized');
  return redisClient.publish(channel, JSON.stringify(message));
}

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

async function unsubscribe(channel: string): Promise<void> {
  if (!subscriberClient) throw new Error('Redis not initialized');
  await subscriberClient.unsubscribe(channel);
}

// Rate limiting
interface RateLimitResult {
  allowed: boolean;
  waitMs?: number;
}

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
async function setSession(sessionId: string, userId: number, ttlSeconds: number = 86400): Promise<void> {
  if (!redisClient) throw new Error('Redis not initialized');
  await redisClient.set(`session:${sessionId}`, userId.toString(), { EX: ttlSeconds });
}

async function getSession(sessionId: string): Promise<number | null> {
  if (!redisClient) throw new Error('Redis not initialized');
  const userId = await redisClient.get(`session:${sessionId}`);
  return userId ? parseInt(userId) : null;
}

async function deleteSession(sessionId: string): Promise<void> {
  if (!redisClient) throw new Error('Redis not initialized');
  await redisClient.del(`session:${sessionId}`);
}

// Viewer counts
async function updateViewerCount(channelId: string | number, count: number): Promise<void> {
  if (!redisClient) throw new Error('Redis not initialized');
  await redisClient.set(`viewers:${channelId}`, count.toString());
}

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
