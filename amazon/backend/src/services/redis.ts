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

export async function initializeRedis(): Promise<RedisClientType> {
  client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  });

  client.on('error', (err: Error) => console.error('Redis Client Error', err));
  client.on('connect', () => console.log('Redis connected'));

  await client.connect();
  return client;
}

export function getRedis(): RedisClientType {
  if (!client) {
    throw new Error('Redis not initialized');
  }
  return client;
}

// Session helpers
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

export async function getSession(sessionId: string): Promise<SessionData | null> {
  if (!client) {
    throw new Error('Redis not initialized');
  }
  const data = await client.get(`session:${sessionId}`);
  return data ? JSON.parse(data) : null;
}

export async function deleteSession(sessionId: string): Promise<void> {
  if (!client) {
    throw new Error('Redis not initialized');
  }
  await client.del(`session:${sessionId}`);
}

// Cache helpers
export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  if (!client) {
    throw new Error('Redis not initialized');
  }
  const data = await client.get(key);
  return data ? JSON.parse(data) : null;
}

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

export async function cacheDel(key: string): Promise<void> {
  if (!client) {
    throw new Error('Redis not initialized');
  }
  await client.del(key);
}

// Recommendations
export async function getRecommendations(productId: string | number): Promise<Recommendation[] | null> {
  if (!client) {
    throw new Error('Redis not initialized');
  }
  const data = await client.get(`recs:${productId}`);
  return data ? JSON.parse(data) : null;
}

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
