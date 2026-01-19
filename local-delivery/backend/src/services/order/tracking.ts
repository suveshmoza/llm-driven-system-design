/**
 * Order tracking module.
 * Handles retrieving orders and order statistics.
 *
 * @module services/order/tracking
 */
import { query, queryOne } from '../../utils/db.js';
import { getMerchantById } from '../merchantService.js';
import type { Order, OrderWithDetails, OrderItem } from './types.js';

/**
 * Retrieves a basic order by its unique identifier.
 *
 * @param id - The order's UUID
 * @returns Order record or null if not found
 */
export async function getOrderById(id: string): Promise<Order | null> {
  return queryOne<Order>(`SELECT * FROM orders WHERE id = $1`, [id]);
}

/**
 * Retrieves an order with all related data for display.
 * Includes order items, merchant, driver, and customer information.
 *
 * @param id - The order's UUID
 * @returns Order with full details or null if not found
 */
export async function getOrderWithDetails(id: string): Promise<OrderWithDetails | null> {
  const order = await getOrderById(id);
  if (!order) return null;

  const items = await query<OrderItem>(
    `SELECT * FROM order_items WHERE order_id = $1`,
    [id]
  );

  const merchant = order.merchant_id
    ? await getMerchantById(order.merchant_id)
    : undefined;

  const driver = order.driver_id
    ? await queryOne<{ id: string; name: string; vehicle_type: string; rating: number }>(
        `SELECT d.id, u.name, d.vehicle_type, d.rating
         FROM drivers d
         JOIN users u ON d.id = u.id
         WHERE d.id = $1`,
        [order.driver_id]
      )
    : undefined;

  const customer = order.customer_id
    ? await queryOne<{ name: string; phone: string | null }>(
        `SELECT name, phone FROM users WHERE id = $1`,
        [order.customer_id]
      )
    : undefined;

  return {
    ...order,
    items,
    merchant: merchant || undefined,
    driver: driver ? { ...driver, status: 'busy' as const } as never : undefined,
    customer: customer || undefined,
  };
}

/**
 * Retrieves all orders placed by a customer.
 * Returns newest orders first for the order history page.
 *
 * @param customerId - The customer's UUID
 * @returns Array of customer's orders
 */
export async function getCustomerOrders(customerId: string): Promise<Order[]> {
  return query<Order>(
    `SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC`,
    [customerId]
  );
}

/**
 * Retrieves all active orders assigned to a driver.
 * Only includes orders in pickup/transit states, not delivered or cancelled.
 *
 * @param driverId - The driver's UUID
 * @returns Array of active orders with full details
 */
export async function getDriverOrders(driverId: string): Promise<OrderWithDetails[]> {
  const orders = await query<Order>(
    `SELECT * FROM orders
     WHERE driver_id = $1
     AND status IN ('driver_assigned', 'picked_up', 'in_transit')
     ORDER BY created_at`,
    [driverId]
  );

  const ordersWithDetails = await Promise.all(
    orders.map((o) => getOrderWithDetails(o.id))
  );

  return ordersWithDetails.filter((o): o is OrderWithDetails => o !== null);
}

/**
 * Retrieves aggregate order statistics for the admin dashboard.
 * Includes counts by status and orders created today.
 *
 * @returns Object with order counts by status category
 */
export async function getOrderStats(): Promise<{
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  cancelled: number;
  today: number;
}> {
  const result = await queryOne<{
    total: string;
    pending: string;
    in_progress: string;
    completed: string;
    cancelled: string;
    today: string;
  }>(`
    SELECT
      COUNT(*)::text as total,
      COUNT(*) FILTER (WHERE status = 'pending')::text as pending,
      COUNT(*) FILTER (WHERE status IN ('confirmed', 'preparing', 'ready_for_pickup', 'driver_assigned', 'picked_up', 'in_transit'))::text as in_progress,
      COUNT(*) FILTER (WHERE status = 'delivered')::text as completed,
      COUNT(*) FILTER (WHERE status = 'cancelled')::text as cancelled,
      COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE)::text as today
    FROM orders
  `);

  return {
    total: parseInt(result?.total || '0'),
    pending: parseInt(result?.pending || '0'),
    in_progress: parseInt(result?.in_progress || '0'),
    completed: parseInt(result?.completed || '0'),
    cancelled: parseInt(result?.cancelled || '0'),
    today: parseInt(result?.today || '0'),
  };
}

/**
 * Retrieves the most recent orders for admin monitoring.
 *
 * @param limit - Maximum number of orders to return (default 20)
 * @returns Array of recent orders, newest first
 */
export async function getRecentOrders(limit: number = 20): Promise<Order[]> {
  return query<Order>(
    `SELECT * FROM orders ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
}
