/**
 * Order status update module.
 * Handles status transitions and timestamp updates.
 *
 * @module services/order/status
 */
import { queryOne } from '../../utils/db.js';
import { publisher } from '../../utils/redis.js';
import type { Order, OrderStatus } from './types.js';

/**
 * Updates an order's status and records relevant timestamps.
 * Publishes status change via Redis for real-time client updates.
 *
 * @param id - The order's UUID
 * @param status - New status value
 * @param additionalFields - Optional extra fields to update (e.g., cancellation_reason)
 * @returns Updated order or null if not found
 */
export async function updateOrderStatus(
  id: string,
  status: OrderStatus,
  additionalFields?: Record<string, unknown>
): Promise<Order | null> {
  const fields = ['status = $1'];
  const values: unknown[] = [status];
  let paramIndex = 2;

  // Add timestamp fields based on status
  switch (status) {
    case 'confirmed':
      fields.push(`confirmed_at = NOW()`);
      break;
    case 'picked_up':
      fields.push(`picked_up_at = NOW()`);
      break;
    case 'delivered':
      fields.push(`delivered_at = NOW()`, `actual_delivery_time = NOW()`);
      break;
    case 'cancelled':
      fields.push(`cancelled_at = NOW()`);
      if (additionalFields?.cancellation_reason) {
        fields.push(`cancellation_reason = $${paramIndex++}`);
        values.push(additionalFields.cancellation_reason);
      }
      break;
  }

  // Add any additional fields
  if (additionalFields) {
    for (const [key, value] of Object.entries(additionalFields)) {
      if (key !== 'cancellation_reason') {
        fields.push(`${key} = $${paramIndex++}`);
        values.push(value);
      }
    }
  }

  values.push(id);

  const order = await queryOne<Order>(
    `UPDATE orders SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  if (order) {
    // Publish status update
    await publisher.publish(
      `order:${id}:status`,
      JSON.stringify({ status, timestamp: new Date().toISOString() })
    );
  }

  return order;
}
