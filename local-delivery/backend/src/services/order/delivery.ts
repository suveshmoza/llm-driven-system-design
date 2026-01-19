/**
 * Delivery completion module.
 * Handles marking orders as delivered and updating driver state.
 *
 * @module services/order/delivery
 */
import { removeDriverOrder } from '../../utils/redis.js';
import { incrementDriverDeliveries, updateDriverStatus } from '../driverService.js';
import { getOrderById, getDriverOrders } from './tracking.js';
import { updateOrderStatus } from './status.js';
import type { Order } from './types.js';

/**
 * Marks an order as delivered and updates driver state.
 * Removes order from driver's active set, increments delivery count,
 * and sets driver to available if no other orders.
 *
 * @param orderId - The order's UUID
 * @returns Updated order or null if not found
 */
export async function completeDelivery(orderId: string): Promise<Order | null> {
  const order = await getOrderById(orderId);
  if (!order || !order.driver_id) return null;

  const updatedOrder = await updateOrderStatus(orderId, 'delivered');

  if (updatedOrder) {
    // Remove order from driver's active orders
    await removeDriverOrder(order.driver_id, orderId);

    // Increment driver's delivery count
    await incrementDriverDeliveries(order.driver_id);

    // Check if driver has more orders, if not set to available
    const remainingOrders = await getDriverOrders(order.driver_id);
    if (remainingOrders.length === 0) {
      await updateDriverStatus(order.driver_id, 'available');
    }
  }

  return updatedOrder;
}
