import { pool } from '../../database.js';
import type { Order, Execution } from './types.js';

/**
 * Retrieves all orders for a user, optionally filtered by status.
 * @param userId - ID of the order owner
 * @param status - Optional status filter (pending, filled, cancelled, etc.)
 * @returns Promise resolving to array of orders, newest first
 */
export async function getOrders(userId: string, status?: string): Promise<Order[]> {
  let query = 'SELECT * FROM orders WHERE user_id = $1';
  const params: (string | undefined)[] = [userId];

  if (status) {
    query += ' AND status = $2';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC';

  const result = await pool.query<Order>(query, params);
  return result.rows;
}

/**
 * Retrieves a specific order for a user.
 * @param userId - ID of the order owner
 * @param orderId - ID of the order to retrieve
 * @returns Promise resolving to the order or null if not found
 */
export async function getOrder(userId: string, orderId: string): Promise<Order | null> {
  const result = await pool.query<Order>(
    'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
    [orderId, userId]
  );
  return result.rows[0] || null;
}

/**
 * Retrieves all executions for an order.
 * @param orderId - ID of the order
 * @returns Promise resolving to array of executions, newest first
 */
export async function getExecutions(orderId: string): Promise<Execution[]> {
  const result = await pool.query<Execution>(
    'SELECT * FROM executions WHERE order_id = $1 ORDER BY executed_at DESC',
    [orderId]
  );
  return result.rows;
}
