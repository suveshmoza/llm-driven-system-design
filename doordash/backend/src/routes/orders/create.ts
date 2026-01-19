import { Router, Request, Response } from 'express';
import { query } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { broadcast } from '../../websocket.js';
import logger from '../../shared/logger.js';
import { ordersTotal, ordersActive, orderPlacementDuration } from '../../shared/metrics.js';
import { auditOrderCreated, ACTOR_TYPES } from '../../shared/audit.js';
import { idempotencyMiddleware, IDEMPOTENCY_KEYS, clearIdempotencyKey } from '../../shared/idempotency.js';
import { publishOrderEvent } from '../../shared/kafka.js';
import { TAX_RATE, OrderItem, MenuItem, RequestOrderItem } from './types.js';
import { getOrderWithDetails } from './helpers.js';

const router = Router();

// Place a new order - with idempotency to prevent duplicate orders
router.post(
  '/',
  requireAuth,
  idempotencyMiddleware(IDEMPOTENCY_KEYS.ORDER_CREATE),
  async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();

    try {
      const { restaurantId, items, deliveryAddress, deliveryInstructions, tip = 0 } = req.body;

      if (!restaurantId || !items || !items.length || !deliveryAddress) {
        await clearIdempotencyKey(IDEMPOTENCY_KEYS.ORDER_CREATE, req.idempotencyKey);
        res.status(400).json({ error: 'Restaurant, items, and delivery address are required' });
        return;
      }

      if (!deliveryAddress.lat || !deliveryAddress.lon || !deliveryAddress.address) {
        await clearIdempotencyKey(IDEMPOTENCY_KEYS.ORDER_CREATE, req.idempotencyKey);
        res.status(400).json({ error: 'Delivery address must include lat, lon, and address' });
        return;
      }

      // Get restaurant
      const restaurantResult = await query('SELECT * FROM restaurants WHERE id = $1', [restaurantId]);
      if (restaurantResult.rows.length === 0) {
        await clearIdempotencyKey(IDEMPOTENCY_KEYS.ORDER_CREATE, req.idempotencyKey);
        res.status(404).json({ error: 'Restaurant not found' });
        return;
      }
      const restaurant = restaurantResult.rows[0];

      // Get menu items
      const itemIds = items.map((i: RequestOrderItem) => i.menuItemId);
      const menuResult = await query(
        `SELECT id, name, price, is_available FROM menu_items
       WHERE id = ANY($1) AND restaurant_id = $2`,
        [itemIds, restaurantId]
      );

      const menuItems = new Map<number, MenuItem>(
        menuResult.rows.map((i: MenuItem) => [i.id, i])
      );

      // Validate all items exist and are available
      let subtotal = 0;
      const orderItems: OrderItem[] = [];
      for (const item of items as RequestOrderItem[]) {
        const menuItem = menuItems.get(item.menuItemId);
        if (!menuItem) {
          await clearIdempotencyKey(IDEMPOTENCY_KEYS.ORDER_CREATE, req.idempotencyKey);
          res.status(400).json({ error: `Menu item ${item.menuItemId} not found` });
          return;
        }
        if (!menuItem.is_available) {
          await clearIdempotencyKey(IDEMPOTENCY_KEYS.ORDER_CREATE, req.idempotencyKey);
          res.status(400).json({ error: `${menuItem.name} is not available` });
          return;
        }

        const quantity = item.quantity || 1;
        subtotal += parseFloat(menuItem.price) * quantity;
        orderItems.push({
          menuItemId: menuItem.id,
          name: menuItem.name,
          price: parseFloat(menuItem.price),
          quantity,
          specialInstructions: item.specialInstructions,
        });
      }

      // Check minimum order
      if (subtotal < parseFloat(restaurant.min_order)) {
        await clearIdempotencyKey(IDEMPOTENCY_KEYS.ORDER_CREATE, req.idempotencyKey);
        res.status(400).json({
          error: `Minimum order is $${restaurant.min_order}`,
        });
        return;
      }

      const deliveryFee = parseFloat(restaurant.delivery_fee);
      const tax = subtotal * TAX_RATE;
      const total = subtotal + deliveryFee + tax + parseFloat(tip);

      // Create order
      const orderResult = await query(
        `INSERT INTO orders (customer_id, restaurant_id, subtotal, delivery_fee, tax, tip, total, delivery_address, delivery_instructions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
        [
          req.user!.id,
          restaurantId,
          subtotal.toFixed(2),
          deliveryFee.toFixed(2),
          tax.toFixed(2),
          parseFloat(tip).toFixed(2),
          total.toFixed(2),
          JSON.stringify(deliveryAddress),
          deliveryInstructions,
        ]
      );

      const order = orderResult.rows[0];

      // Insert order items
      for (const item of orderItems) {
        await query(
          `INSERT INTO order_items (order_id, menu_item_id, name, price, quantity, special_instructions)
         VALUES ($1, $2, $3, $4, $5, $6)`,
          [order.id, item.menuItemId, item.name, item.price, item.quantity, item.specialInstructions]
        );
      }

      // Get full order details
      const fullOrder = await getOrderWithDetails(order.id);
      if (fullOrder) {
        fullOrder.items = orderItems;
      }

      // Record metrics
      ordersTotal.inc({ status: 'PLACED', restaurant_id: restaurantId.toString() });
      ordersActive.inc({ status: 'PLACED' });
      orderPlacementDuration.observe((Date.now() - startTime) / 1000);

      // Create audit log
      await auditOrderCreated(
        fullOrder!,
        { type: ACTOR_TYPES.CUSTOMER, id: req.user!.id },
        {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          idempotencyKey: req.idempotencyKey,
        }
      );

      logger.info(
        {
          orderId: order.id,
          customerId: req.user!.id,
          restaurantId,
          total: order.total,
          itemCount: orderItems.length,
        },
        'Order placed'
      );

      // Publish order created event to Kafka
      publishOrderEvent(order.id.toString(), 'created', {
        customerId: req.user!.id,
        restaurantId,
        total: order.total,
        itemCount: orderItems.length,
        deliveryAddress,
      });

      // Notify restaurant via WebSocket
      broadcast(`restaurant:${restaurantId}:orders`, {
        type: 'new_order',
        order: fullOrder,
      });

      res.status(201).json({ order: fullOrder });
    } catch (err) {
      const error = err as Error;
      await clearIdempotencyKey(IDEMPOTENCY_KEYS.ORDER_CREATE, req.idempotencyKey);
      logger.error({ error: error.message, stack: error.stack }, 'Place order error');
      res.status(500).json({ error: 'Failed to place order' });
    }
  }
);

export default router;
