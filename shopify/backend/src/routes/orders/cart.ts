import { Request, Response } from 'express';
import { queryWithTenant, getClientWithTenant } from '../../services/db.js';
import { recalculateSubtotal, generateCartSessionId, getCartSessionFromRequest } from './cart-utils.js';
import type { Cart, CartItem } from './types.js';

// Get or create cart
export async function getCart(req: Request, res: Response): Promise<void | Response> {
  const { storeId } = req;
  const sessionId = getCartSessionFromRequest(req);

  if (!storeId) {
    return res.status(404).json({ error: 'Store not found' });
  }

  if (!sessionId) {
    return res.json({ cart: null });
  }

  const result = await queryWithTenant(
    storeId,
    `SELECT c.*,
            (SELECT json_agg(json_build_object(
              'variant_id', v.id, 'product_id', p.id, 'product_title', p.title, 'variant_title', v.title,
              'price', v.price, 'image', (p.images->0->>'url'),
              'quantity', (SELECT (item->>'quantity')::int FROM jsonb_array_elements(c.items) item WHERE (item->>'variant_id')::int = v.id LIMIT 1)
            )) FROM jsonb_array_elements(c.items) item
            JOIN variants v ON v.id = (item->>'variant_id')::int JOIN products p ON p.id = v.product_id) as line_items
     FROM carts c WHERE c.session_id = $1`,
    [sessionId]
  );

  if (result.rows.length === 0) {
    return res.json({ cart: null });
  }

  res.json({ cart: result.rows[0] });
}

// Add item to cart
export async function addToCart(req: Request, res: Response): Promise<void | Response> {
  const { storeId } = req;
  const { variantId, quantity = 1 } = req.body;
  let sessionId = getCartSessionFromRequest(req);

  if (!storeId) return res.status(404).json({ error: 'Store not found' });
  if (!variantId) return res.status(400).json({ error: 'Variant ID required' });

  const variant = await queryWithTenant(storeId, 'SELECT id, price, inventory_quantity FROM variants WHERE id = $1', [variantId]);
  if (variant.rows.length === 0) return res.status(404).json({ error: 'Variant not found' });

  const variantData = variant.rows[0] as { id: number; price: number; inventory_quantity: number };
  if (variantData.inventory_quantity < quantity) return res.status(400).json({ error: 'Insufficient inventory' });

  const client = await getClientWithTenant(storeId);

  try {
    await client.query('BEGIN');

    let cart: Cart | undefined;
    if (sessionId) {
      const existing = await client.query('SELECT * FROM carts WHERE session_id = $1', [sessionId]);
      cart = existing.rows[0] as Cart | undefined;
    }

    if (!cart) {
      sessionId = generateCartSessionId();
      const result = await client.query(
        `INSERT INTO carts (store_id, session_id, items, subtotal) VALUES ($1, $2, $3, $4) RETURNING *`,
        [storeId, sessionId, JSON.stringify([{ variant_id: variantId, quantity }]), variantData.price * quantity]
      );
      cart = result.rows[0] as Cart;
    } else {
      const items: CartItem[] = cart.items || [];
      const existingIndex = items.findIndex((i: CartItem) => i.variant_id === variantId);

      if (existingIndex >= 0) {
        items[existingIndex].quantity += quantity;
      } else {
        items.push({ variant_id: variantId, quantity });
      }

      const subtotal = await recalculateSubtotal(client, items);
      const result = await client.query(
        `UPDATE carts SET items = $1, subtotal = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
        [JSON.stringify(items), subtotal, cart.id]
      );
      cart = result.rows[0] as Cart;
    }

    await client.query('COMMIT');
    res.cookie('cartSession', sessionId, { httpOnly: true, sameSite: 'lax', maxAge: 604800000 });
    res.json({ cart, sessionId });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Update cart item quantity
export async function updateCartItem(req: Request, res: Response): Promise<void | Response> {
  const { storeId } = req;
  const { variantId, quantity } = req.body;
  const sessionId = getCartSessionFromRequest(req);

  if (!storeId) return res.status(404).json({ error: 'Store not found' });
  if (!sessionId) return res.status(400).json({ error: 'No cart session' });

  const client = await getClientWithTenant(storeId);

  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT * FROM carts WHERE session_id = $1', [sessionId]);
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cart not found' });
    }

    const cart = existing.rows[0] as Cart;
    let items: CartItem[] = cart.items || [];

    if (quantity <= 0) {
      items = items.filter((i: CartItem) => i.variant_id !== variantId);
    } else {
      const index = items.findIndex((i: CartItem) => i.variant_id === variantId);
      if (index >= 0) items[index].quantity = quantity;
    }

    const subtotal = await recalculateSubtotal(client, items);
    const result = await client.query(
      `UPDATE carts SET items = $1, subtotal = $2, updated_at = NOW() WHERE session_id = $3 RETURNING *`,
      [JSON.stringify(items), subtotal, sessionId]
    );

    await client.query('COMMIT');
    res.json({ cart: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
