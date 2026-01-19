import { createClient, RedisClientType } from 'redis';
import config from '../config/index.js';

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

// Session management
export async function setSession(
  sessionId: string,
  data: SessionData,
  ttlSeconds: number = 86400
): Promise<void> {
  await client.set(`session:${sessionId}`, JSON.stringify(data), {
    EX: ttlSeconds,
  });
}

export async function getSession(sessionId: string): Promise<SessionData | null> {
  const data = await client.get(`session:${sessionId}`);
  return data ? JSON.parse(data) : null;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await client.del(`session:${sessionId}`);
}

// Domain to store mapping cache
export async function setDomainMapping(
  domain: string,
  storeId: number,
  ttlSeconds: number = 3600
): Promise<void> {
  await client.set(`domain:${domain}`, String(storeId), {
    EX: ttlSeconds,
  });
}

export async function getDomainMapping(domain: string): Promise<number | null> {
  const storeId = await client.get(`domain:${domain}`);
  return storeId ? parseInt(storeId, 10) : null;
}

// Cart management
export async function setCart(
  cartId: string,
  data: CartData,
  ttlSeconds: number = 604800
): Promise<void> {
  await client.set(`cart:${cartId}`, JSON.stringify(data), {
    EX: ttlSeconds,
  });
}

export async function getCart(cartId: string): Promise<CartData | null> {
  const data = await client.get(`cart:${cartId}`);
  return data ? JSON.parse(data) : null;
}

export async function deleteCart(cartId: string): Promise<void> {
  await client.del(`cart:${cartId}`);
}

export default client;
