import { PoolClient } from 'pg';
import { getClientWithTenant } from '../../services/db.js';
import logger from '../../services/logger.js';
import { logInventoryChange, logOrderCreated, logPaymentEvent, AuditContext } from '../../services/audit.js';
import { publishOrderCreated, publishInventoryUpdated, queueEmailNotification } from '../../services/rabbitmq.js';
import { processPayment } from '../../services/circuit-breaker.js';
import {
  orderValue,
  ordersCreated,
  inventoryLevel,
  inventoryLow,
  inventoryOutOfStock,
} from '../../services/metrics.js';
import config from '../../config/index.js';
import type { Order, Cart, CartItem, Variant, LineItem, Address } from './types.js';

/**
 * Internal checkout processing with transaction, inventory updates, and audit logging
 */
export async function processCheckoutInternal(
  storeId: number,
  sessionId: string,
  email: string,
  shippingAddress: Address | undefined,
  billingAddress: Address | undefined,
  auditContext: AuditContext
): Promise<Order> {
  const client = await getClientWithTenant(storeId);

  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

    const cart = await getAndValidateCart(client, sessionId);
    const items: CartItem[] = cart.items || [];

    const lineItems = await reserveInventory(client, storeId, items, sessionId, auditContext);

    const { subtotal, shippingCost, tax, total } = calculateTotals(lineItems);

    const paymentResult = await processPayment({
      amount: Math.round(total * 100),
      storeId,
      cartId: sessionId,
      email,
    });

    await logPaymentEvent(auditContext, paymentResult.success, {
      amount: total,
      paymentIntentId: paymentResult.paymentIntentId,
      orderId: null,
    });

    if (!paymentResult.success && !paymentResult.deferred) {
      await rollbackInventory(client, lineItems, auditContext);
      throw new Error('Payment failed');
    }

    const order = await createOrder(client, storeId, email, subtotal, shippingCost, tax, total, shippingAddress, billingAddress, paymentResult);
    await createOrderItems(client, storeId, order.id, lineItems);
    await client.query('DELETE FROM carts WHERE session_id = $1', [sessionId]);
    await client.query('COMMIT');

    await publishOrderEvents(order, lineItems, email, auditContext, storeId, total);

    logger.info({ storeId, orderId: order.id, orderNumber: order.order_number, total }, 'Order created successfully');

    return order;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getAndValidateCart(client: PoolClient, sessionId: string): Promise<Cart> {
  const cartResult = await client.query('SELECT * FROM carts WHERE session_id = $1', [sessionId]);
  if (cartResult.rows.length === 0) {
    throw new Error('Cart not found');
  }

  const cart = cartResult.rows[0] as Cart;
  if (!cart.items || cart.items.length === 0) {
    throw new Error('Cart is empty');
  }

  return cart;
}

async function reserveInventory(
  client: PoolClient,
  storeId: number,
  items: CartItem[],
  sessionId: string,
  auditContext: AuditContext
): Promise<LineItem[]> {
  const lineItems: LineItem[] = [];

  for (const item of items) {
    const variant = await client.query(
      `SELECT v.*, p.title as product_title FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1 FOR UPDATE`,
      [item.variant_id]
    );

    if (variant.rows.length === 0) {
      throw new Error(`Variant ${item.variant_id} no longer exists`);
    }

    const variantData = variant.rows[0] as Variant;
    const oldQuantity = variantData.inventory_quantity;

    if (oldQuantity < item.quantity) {
      throw new Error(`${variantData.product_title} is out of stock (requested: ${item.quantity}, available: ${oldQuantity})`);
    }

    lineItems.push({
      variant: variantData,
      quantity: item.quantity,
      price: variantData.price,
      total: variantData.price * item.quantity,
      oldQuantity,
    });

    const newQuantity = oldQuantity - item.quantity;
    await client.query('UPDATE variants SET inventory_quantity = $1, updated_at = NOW() WHERE id = $2', [newQuantity, item.variant_id]);

    await logInventoryChange(auditContext, item.variant_id, oldQuantity, newQuantity, `checkout_reserve:${sessionId}`);

    inventoryLevel.set({ store_id: storeId.toString(), variant_id: item.variant_id.toString(), sku: variantData.sku || '' }, newQuantity);

    if (newQuantity === 0) {
      inventoryOutOfStock.inc({ store_id: storeId.toString(), variant_id: item.variant_id.toString() });
    } else if (newQuantity < config.inventory.lowStockThreshold) {
      inventoryLow.inc({ store_id: storeId.toString(), variant_id: item.variant_id.toString() });
    }

    await publishInventoryUpdated(storeId, item.variant_id, oldQuantity, newQuantity);
  }

  return lineItems;
}

function calculateTotals(lineItems: LineItem[]): { subtotal: number; shippingCost: number; tax: number; total: number } {
  const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
  const shippingCost = 0;
  const tax = subtotal * 0.1;
  const total = subtotal + shippingCost + tax;
  return { subtotal, shippingCost, tax, total };
}

async function rollbackInventory(client: PoolClient, lineItems: LineItem[], auditContext: AuditContext): Promise<void> {
  for (const item of lineItems) {
    await client.query('UPDATE variants SET inventory_quantity = $1, updated_at = NOW() WHERE id = $2', [item.oldQuantity, item.variant.id]);
    await logInventoryChange(auditContext, item.variant.id, item.oldQuantity - item.quantity, item.oldQuantity, 'checkout_payment_failed:rollback');
  }
}

async function createOrder(
  client: PoolClient,
  storeId: number,
  email: string,
  subtotal: number,
  shippingCost: number,
  tax: number,
  total: number,
  shippingAddress: Address | undefined,
  billingAddress: Address | undefined,
  paymentResult: { deferred?: boolean; paymentIntentId?: string }
): Promise<Order> {
  const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}`;

  const orderResult = await client.query(
    `INSERT INTO orders (store_id, order_number, customer_email, subtotal, shipping_cost, tax, total,
                        payment_status, fulfillment_status, shipping_address, billing_address, stripe_payment_intent_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [storeId, orderNumber, email, subtotal, shippingCost, tax, total, paymentResult.deferred ? 'pending' : 'paid', 'unfulfilled',
      JSON.stringify(shippingAddress || {}), JSON.stringify(billingAddress || shippingAddress || {}), paymentResult.paymentIntentId || null]
  );

  return orderResult.rows[0] as Order;
}

async function createOrderItems(client: PoolClient, storeId: number, orderId: number, lineItems: LineItem[]): Promise<void> {
  for (const item of lineItems) {
    await client.query(
      `INSERT INTO order_items (order_id, store_id, variant_id, title, variant_title, sku, quantity, price, total) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [orderId, storeId, item.variant.id, item.variant.product_title, item.variant.title, item.variant.sku, item.quantity, item.price, item.total]
    );
  }
}

async function publishOrderEvents(order: Order, lineItems: LineItem[], email: string, auditContext: AuditContext, storeId: number, total: number): Promise<void> {
  ordersCreated.inc({ store_id: storeId.toString() });
  orderValue.observe({ store_id: storeId.toString() }, total);
  await logOrderCreated(auditContext, { ...order, items: lineItems.map(i => ({ variantId: i.variant.id, quantity: i.quantity, price: i.price })) });
  await publishOrderCreated({ ...order, items: lineItems.map(i => ({ variantId: i.variant.id, title: i.variant.product_title, quantity: i.quantity, price: i.price })) });
  await queueEmailNotification(email, 'order_confirmation', { orderNumber: order.order_number, total: order.total, items: lineItems.length });
}
