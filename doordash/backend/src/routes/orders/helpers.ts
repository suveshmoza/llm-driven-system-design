import { query } from '../../db.js';
import { Order } from './types.js';

/**
 * Retrieves a complete order with all related details including restaurant, driver, and items.
 * @description Fetches an order by ID and enriches it with associated restaurant data,
 * driver information (if assigned), and all order items. This is the primary method
 * for getting full order details for display or processing.
 *
 * @param orderId - The unique identifier of the order to retrieve
 * @returns The complete order object with all related data, or null if not found
 *
 * @example
 * ```typescript
 * const order = await getOrderWithDetails(123);
 * if (order) {
 *   console.log(`Order from ${order.restaurant?.name}: ${order.items?.length} items`);
 * }
 * ```
 */
export async function getOrderWithDetails(orderId: number): Promise<Order | null> {
  const orderResult = await query(
    `SELECT o.*,
            r.name as restaurant_name, r.address as restaurant_address,
            r.lat as restaurant_lat, r.lon as restaurant_lon,
            r.prep_time_minutes, r.image_url as restaurant_image, r.owner_id as restaurant_owner_id
     FROM orders o
     JOIN restaurants r ON o.restaurant_id = r.id
     WHERE o.id = $1`,
    [orderId]
  );

  if (orderResult.rows.length === 0) {
    return null;
  }

  const order = orderResult.rows[0];

  // Get items
  const itemsResult = await query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
  order.items = itemsResult.rows;

  // Get driver if assigned
  if (order.driver_id) {
    const driverResult = await query(
      `SELECT d.*, u.name, u.phone
       FROM drivers d
       JOIN users u ON d.user_id = u.id
       WHERE d.id = $1`,
      [order.driver_id]
    );
    if (driverResult.rows.length > 0) {
      order.driver = driverResult.rows[0];
    }
  }

  // Format restaurant info
  order.restaurant = {
    id: order.restaurant_id,
    name: order.restaurant_name,
    address: order.restaurant_address,
    lat: parseFloat(order.restaurant_lat),
    lon: parseFloat(order.restaurant_lon),
    prep_time_minutes: order.prep_time_minutes,
    image_url: order.restaurant_image,
    owner_id: order.restaurant_owner_id,
  };

  return order as Order;
}

/**
 * Calculates a match score for a driver based on multiple factors.
 * @description Uses a weighted scoring algorithm to determine how well-suited a driver
 * is for a particular order. Higher scores indicate better matches. The algorithm considers:
 * - Distance to restaurant (primary factor, closer is better)
 * - Driver rating (higher ratings score better)
 * - Experience level (more deliveries indicate reliability)
 *
 * @param driver - The driver to score, containing rating and delivery count
 * @param driver.rating - Driver's rating (number or string, defaults to 5 if not provided)
 * @param driver.total_deliveries - Total number of completed deliveries
 * @param _order - The order being matched (reserved for future order-specific matching)
 * @param distance - Distance from driver to restaurant in kilometers
 * @returns A numeric score where higher values indicate better matches
 *
 * @example
 * ```typescript
 * const score = calculateMatchScore(
 *   { rating: 4.8, total_deliveries: 150 },
 *   order,
 *   2.5 // 2.5 km away
 * );
 * // Returns approximately: 75 (distance) + 24 (rating) + 15 (experience) = 114
 * ```
 */
export function calculateMatchScore(
  driver: { rating?: number | string; total_deliveries: number },
  _order: Order,
  distance: number
): number {
  let score = 0;

  // Distance to restaurant (most important) - closer is better
  score += 100 - distance * 10;

  // Driver rating
  score += parseFloat((driver.rating || '5').toString()) * 5;

  // Experience (more deliveries = more reliable)
  score += Math.min(driver.total_deliveries / 10, 20);

  return score;
}
