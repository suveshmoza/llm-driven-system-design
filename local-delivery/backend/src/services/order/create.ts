/**
 * Order creation module.
 * Handles creating new orders from customer cart data.
 *
 * @module services/order/create
 * @description Processes customer order submissions by validating merchant and
 * menu items, calculating pricing (subtotal, delivery fee, tip, total), and
 * estimating delivery time based on preparation time and distance.
 */
import { query as _query, queryOne } from '../../utils/db.js';
import { haversineDistance, calculateDeliveryFee, calculateETA } from '../../utils/geo.js';
import { getMerchantById, getMenuItemsByIds } from '../merchantService.js';
import type {
  Order,
  OrderWithDetails,
  OrderItem,
  CreateOrderInput,
} from './types.js';

/**
 * Creates a new order from customer cart data.
 *
 * @description Performs the complete order creation workflow:
 * 1. Validates merchant exists and is available
 * 2. Validates all menu items exist
 * 3. Calculates subtotal from item prices and quantities
 * 4. Calculates delivery fee based on distance using Haversine formula
 * 5. Computes total (subtotal + delivery fee + tip)
 * 6. Estimates delivery time based on prep time + travel time
 * 7. Creates order record with status 'pending'
 * 8. Creates order item records linking to menu items
 *
 * @param {string} customerId - The ordering customer's UUID
 * @param {CreateOrderInput} input - Order details including:
 *   - merchant_id: UUID of the restaurant/store
 *   - items: Array of {menu_item_id, quantity, special_instructions}
 *   - delivery_address: Full delivery address string
 *   - delivery_lat: Delivery latitude coordinate
 *   - delivery_lng: Delivery longitude coordinate
 *   - delivery_instructions: Optional delivery notes
 *   - tip: Optional tip amount in dollars
 * @returns {Promise<OrderWithDetails>} Complete order with items and merchant info
 * @throws {Error} 'Merchant not found' if merchant_id is invalid
 * @throws {Error} 'One or more menu items not found' if any menu_item_id is invalid
 * @throws {Error} 'Failed to create order' if database insert fails
 * @example
 * const order = await createOrder(customerId, {
 *   merchant_id: 'merchant-uuid',
 *   items: [
 *     { menu_item_id: 'item-1', quantity: 2 },
 *     { menu_item_id: 'item-2', quantity: 1, special_instructions: 'No onions' }
 *   ],
 *   delivery_address: '123 Main St, San Francisco, CA 94102',
 *   delivery_lat: 37.7749,
 *   delivery_lng: -122.4194,
 *   tip: 5.00
 * });
 * console.log(`Order ${order.id} total: $${order.total}`);
 */
export async function createOrder(
  customerId: string,
  input: CreateOrderInput
): Promise<OrderWithDetails> {
  // Get merchant details
  const merchant = await getMerchantById(input.merchant_id);
  if (!merchant) {
    throw new Error('Merchant not found');
  }

  // Get menu items and calculate subtotal
  const menuItemIds = input.items.map((i) => i.menu_item_id);
  const menuItems = await getMenuItemsByIds(menuItemIds);

  if (menuItems.length !== menuItemIds.length) {
    throw new Error('One or more menu items not found');
  }

  // Calculate subtotal
  let subtotal = 0;
  for (const item of input.items) {
    const menuItem = menuItems.find((m) => m.id === item.menu_item_id);
    if (!menuItem) {
      throw new Error(`Menu item ${item.menu_item_id} not found`);
    }
    subtotal += menuItem.price * item.quantity;
  }

  // Calculate delivery fee
  const deliveryDistance = haversineDistance(
    { lat: merchant.lat, lng: merchant.lng },
    { lat: input.delivery_lat, lng: input.delivery_lng }
  );
  const deliveryFee = calculateDeliveryFee(deliveryDistance);

  // Calculate total
  const tip = input.tip || 0;
  const total = subtotal + deliveryFee + tip;

  // Calculate estimated delivery time
  const prepTimeMinutes = merchant.avg_prep_time_minutes;
  const deliveryEtaSeconds = calculateETA(deliveryDistance);
  const estimatedDeliveryTime = new Date();
  estimatedDeliveryTime.setMinutes(estimatedDeliveryTime.getMinutes() + prepTimeMinutes);
  estimatedDeliveryTime.setSeconds(estimatedDeliveryTime.getSeconds() + deliveryEtaSeconds);

  // Create order
  const order = await queryOne<Order>(
    `INSERT INTO orders (
      customer_id, merchant_id, status, delivery_address, delivery_lat, delivery_lng,
      delivery_instructions, subtotal, delivery_fee, tip, total,
      estimated_prep_time_minutes, estimated_delivery_time
    )
    VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *`,
    [
      customerId,
      input.merchant_id,
      input.delivery_address,
      input.delivery_lat,
      input.delivery_lng,
      input.delivery_instructions || null,
      subtotal,
      deliveryFee,
      tip,
      total,
      prepTimeMinutes,
      estimatedDeliveryTime,
    ]
  );

  if (!order) {
    throw new Error('Failed to create order');
  }

  // Create order items
  const orderItems: OrderItem[] = [];
  for (const item of input.items) {
    const menuItem = menuItems.find((m) => m.id === item.menu_item_id);
    if (!menuItem) continue;

    const orderItem = await queryOne<OrderItem>(
      `INSERT INTO order_items (order_id, menu_item_id, name, quantity, unit_price, special_instructions)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        order.id,
        item.menu_item_id,
        menuItem.name,
        item.quantity,
        menuItem.price,
        item.special_instructions || null,
      ]
    );

    if (orderItem) {
      orderItems.push(orderItem);
    }
  }

  return {
    ...order,
    items: orderItems,
    merchant,
  };
}
