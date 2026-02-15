import { createClient, RedisClientType } from 'redis';
import config from '../config/index.js';

/** Redis client for session storage, domain mapping cache, and shopping cart persistence. */
const client: RedisClientType = createClient({
  url: config.redis.url,
});

client.on('error', (err: Error) => console.error('Redis Client Error', err));
client.on('connect', () => console.log('Connected to Redis'));

await client.connect();

// Session data interface
export interface SessionData {
  user: {
    id: number;
    email: string;
    name: string;
    role: string;
  };
}

// Cart item interface
export interface CartItem {
  variant_id: number;
  quantity: number;
}

export interface CartData {
  id: number;
  store_id: number;
  session_id: string;
  items: CartItem[];
  subtotal: number;
}

/** Stores session data in Redis with a configurable TTL (default 24 hours). */
export async function setSession(
  sessionId: string,
  data: SessionData,
  ttlSeconds: number = 86400
): Promise<void> {
  await client.set(`session:${sessionId}`, JSON.stringify(data), {
    EX: ttlSeconds,
  });
}

/** Retrieves session data from Redis by session ID. */
export async function getSession(sessionId: string): Promise<SessionData | null> {
  const data = await client.get(`session:${sessionId}`);
  return data ? JSON.parse(data) : null;
}

/** Removes a session from Redis on logout. */
export async function deleteSession(sessionId: string): Promise<void> {
  await client.del(`session:${sessionId}`);
}

/** Caches a custom domain to store ID mapping for fast subdomain/domain resolution. */
export async function setDomainMapping(
  domain: string,
  storeId: number,
  ttlSeconds: number = 3600
): Promise<void> {
  await client.set(`domain:${domain}`, String(storeId), {
    EX: ttlSeconds,
  });
}

/** Resolves a domain to a store ID from the Redis cache. */
export async function getDomainMapping(domain: string): Promise<number | null> {
  const storeId = await client.get(`domain:${domain}`);
  return storeId ? parseInt(storeId, 10) : null;
}

/** Persists a shopping cart to Redis with a configurable TTL (default 7 days). */
export async function setCart(
  cartId: string,
  data: CartData,
  ttlSeconds: number = 604800
): Promise<void> {
  await client.set(`cart:${cartId}`, JSON.stringify(data), {
    EX: ttlSeconds,
  });
}

/** Retrieves a shopping cart from Redis by cart ID. */
export async function getCart(cartId: string): Promise<CartData | null> {
  const data = await client.get(`cart:${cartId}`);
  return data ? JSON.parse(data) : null;
}

/** Removes a shopping cart from Redis after checkout completion. */
export async function deleteCart(cartId: string): Promise<void> {
  await client.del(`cart:${cartId}`);
}

export default client;
