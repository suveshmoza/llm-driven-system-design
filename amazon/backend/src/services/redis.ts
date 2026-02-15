import { createClient, RedisClientType } from 'redis';

let client: RedisClientType | null = null;

export interface SessionData {
  userId: number;
  [key: string]: unknown;
}

export interface Recommendation {
  product_id: number;
  frequency?: number;
  score?: number;
}

/** Initializes the Redis client and establishes a connection. */
export async function initializeRedis(): Promise<RedisClientType> {
  client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  });

  client.on('error', (err: Error) => console.error('Redis Client Error', err));
  client.on('connect', () => console.log('Redis connected'));

  await client.connect();
  return client;
}

/** Returns the initialized Redis client. Throws if not yet initialized. */
export function getRedis(): RedisClientType {
  if (!client) {
    throw new Error('Redis not initialized');
  }
  return client;
}

/** Stores session data in Redis with a configurable TTL (default 24 hours). */
export async function setSession(
  sessionId: string,
  data: SessionData,
  expiresInSeconds: number = 86400
): Promise<void> {
  if (!client) {
    throw new Error('Redis not initialized');
  }
  await client.set(`session:${sessionId}`, JSON.stringify(data), {
    EX: expiresInSeconds
  });
}

/** Retrieves session data from Redis by session ID. */
export async function getSession(sessionId: string): Promise<SessionData | null> {
  if (!client) {
    throw new Error('Redis not initialized');
  }
  const data = await client.get(`session:${sessionId}`);
  return data ? JSON.parse(data) : null;
}

/** Deletes a session from Redis by session ID. */
export async function deleteSession(sessionId: string): Promise<void> {
  if (!client) {
    throw new Error('Redis not initialized');
  }
  await client.del(`session:${sessionId}`);
}

/** Retrieves a cached value from Redis by key, deserializing from JSON. */
export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  if (!client) {
    throw new Error('Redis not initialized');
  }
  const data = await client.get(key);
  return data ? JSON.parse(data) : null;
}

/** Stores a value in Redis cache with a configurable TTL (default 1 hour). */
export async function cacheSet(
  key: string,
  value: unknown,
  expiresInSeconds: number = 3600
): Promise<void> {
  if (!client) {
    throw new Error('Redis not initialized');
  }
  await client.set(key, JSON.stringify(value), {
    EX: expiresInSeconds
  });
}

/** Deletes a cached value from Redis by key. */
export async function cacheDel(key: string): Promise<void> {
  if (!client) {
    throw new Error('Redis not initialized');
  }
  await client.del(key);
}

/** Retrieves cached product recommendations (co-purchase data) from Redis. */
export async function getRecommendations(productId: string | number): Promise<Recommendation[] | null> {
  if (!client) {
    throw new Error('Redis not initialized');
  }
  const data = await client.get(`recs:${productId}`);
  return data ? JSON.parse(data) : null;
}

/** Caches product recommendations in Redis with a configurable TTL (default 24 hours). */
export async function setRecommendations(
  productId: string | number,
  recommendations: Recommendation[],
  expiresInSeconds: number = 86400
): Promise<void> {
  if (!client) {
    throw new Error('Redis not initialized');
  }
  await client.set(`recs:${productId}`, JSON.stringify(recommendations), {
    EX: expiresInSeconds
  });
}
