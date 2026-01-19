import { query } from '../../db.js';
import { Order } from './types.js';

/**
 * Get order with full details including restaurant, driver, and items
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
 * Calculate match score for driver based on distance, rating, and experience
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
