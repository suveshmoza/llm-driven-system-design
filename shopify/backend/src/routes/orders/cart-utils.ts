import { PoolClient } from 'pg';
import type { CartItem } from './types.js';

/**
 * Recalculate subtotal for cart items by fetching variant prices
 */
export async function recalculateSubtotal(client: PoolClient, items: CartItem[]): Promise<number> {
  let subtotal = 0;
  for (const item of items) {
    const v = await client.query('SELECT price FROM variants WHERE id = $1', [item.variant_id]);
    if (v.rows.length > 0) {
      subtotal += (v.rows[0] as { price: number }).price * item.quantity;
    }
  }
  return subtotal;
}

/**
 * Generate a new cart session ID
 */
export function generateCartSessionId(): string {
  return `cart_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

/**
 * Extract cart session ID from request
 */
export function getCartSessionFromRequest(req: { cookies?: { cartSession?: string }; headers: Record<string, unknown> }): string | undefined {
  return req.cookies?.cartSession || req.headers['x-cart-session'] as string | undefined;
}
