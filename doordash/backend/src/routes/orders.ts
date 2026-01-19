import { Router, Request, Response } from 'express';
import { query } from '../db.js';
import redisClient from '../redis.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { haversineDistance, calculateETA, ETAResult } from '../utils/geo.js';
import { broadcast, broadcastToChannels } from '../websocket.js';

// Shared modules
import logger from '../shared/logger.js';
import {
  ordersTotal,
  ordersActive,
  orderStatusTransitions,
  orderPlacementDuration,
  deliveryDuration,
  etaAccuracy,
  driverMatchDuration,
  driverAssignmentsTotal,
} from '../shared/metrics.js';
import { auditOrderCreated, auditOrderStatusChange, auditDriverAssigned, ACTOR_TYPES } from '../shared/audit.js';
import { idempotencyMiddleware, IDEMPOTENCY_KEYS, clearIdempotencyKey } from '../shared/idempotency.js';
import { getDriverMatchCircuitBreaker, DriverMatchResult } from '../shared/circuit-breaker.js';
import { publishOrderEvent, publishDispatchEvent } from '../shared/kafka.js';

const router = Router();

const TAX_RATE = 0.0875; // 8.75% tax

interface OrderTransition {
  next: string[];
  actor: string | null;
}

// Order status flow
const ORDER_TRANSITIONS: Record<string, OrderTransition> = {
  PLACED: { next: ['CONFIRMED', 'CANCELLED'], actor: 'restaurant' },
  CONFIRMED: { next: ['PREPARING', 'CANCELLED'], actor: 'restaurant' },
  PREPARING: { next: ['READY_FOR_PICKUP'], actor: 'restaurant' },
  READY_FOR_PICKUP: { next: ['PICKED_UP'], actor: 'driver' },
  PICKED_UP: { next: ['DELIVERED'], actor: 'driver' },
  DELIVERED: { next: ['COMPLETED'], actor: 'system' },
  COMPLETED: { next: [], actor: null },
  CANCELLED: { next: [], actor: null },
};

interface DeliveryAddress {
  lat: number;
  lon: number;
  address: string;
}

interface OrderItem {
  menuItemId: number;
  name: string;
  price: number;
  quantity: number;
  specialInstructions?: string;
}

interface Order {
  id: number;
  customer_id: number;
  restaurant_id: number;
  driver_id?: number | null;
  status: string;
  subtotal: number;
  delivery_fee: number;
  tax: number;
  tip: number;
  total: number;
  delivery_address: DeliveryAddress;
  delivery_instructions?: string;
  placed_at?: string;
  confirmed_at?: string;
  preparing_at?: string;
  ready_at?: string;
  picked_up_at?: string;
  delivered_at?: string;
  cancelled_at?: string;
  cancel_reason?: string;
  estimated_delivery_at?: string;
  eta_breakdown?: ETAResult['breakdown'];
  items?: OrderItem[];
  restaurant?: {
    id: number;
    name: string;
    address: string;
    lat: number;
    lon: number;
    prep_time_minutes?: number;
    image_url?: string;
    owner_id?: number;
  };
  driver?: {
    id: number;
    user_id: number;
    name: string;
    phone?: string;
    current_lat?: number;
    current_lon?: number;
    rating?: number;
    vehicle_type?: string;
    total_deliveries?: number;
  };
}

interface NearbyDriver {
  id: number;
  distance: number;
}

interface ScoredDriver {
  driver: {
    id: number;
    name: string;
    rating?: number | string;
    total_deliveries: number;
    user_id: number;
  };
  score: number;
  distance: number;
}

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
        // Clear idempotency key on validation error so client can retry
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
      const itemIds = items.map((i: { menuItemId: number }) => i.menuItemId);
      const menuResult = await query(
        `SELECT id, name, price, is_available FROM menu_items
       WHERE id = ANY($1) AND restaurant_id = $2`,
        [itemIds, restaurantId]
      );

      const menuItems = new Map<number, { id: number; name: string; price: string; is_available: boolean }>(
        menuResult.rows.map((i: { id: number; name: string; price: string; is_available: boolean }) => [
          i.id,
          i,
        ])
      );

      // Validate all items exist and are available
      let subtotal = 0;
      const orderItems: OrderItem[] = [];
      for (const item of items) {
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
      // Clear idempotency key on error so client can retry
      await clearIdempotencyKey(IDEMPOTENCY_KEYS.ORDER_CREATE, req.idempotencyKey);
      logger.error({ error: error.message, stack: error.stack }, 'Place order error');
      res.status(500).json({ error: 'Failed to place order' });
    }
  }
);

// Get order by ID
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const order = await getOrderWithDetails(parseInt(id));

    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    // Check authorization
    const isCustomer = order.customer_id === req.user!.id;
    const isRestaurantOwner = order.restaurant?.owner_id === req.user!.id;
    const isDriver = order.driver?.user_id === req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    if (!isCustomer && !isRestaurantOwner && !isDriver && !isAdmin) {
      res.status(403).json({ error: 'Not authorized to view this order' });
      return;
    }

    res.json({ order });
  } catch (err) {
    const error = err as Error;
    logger.error({ error: error.message, orderId: req.params.id }, 'Get order error');
    res.status(500).json({ error: 'Failed to get order' });
  }
});

// Get customer's orders
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, limit = '20', offset = '0' } = req.query;

    let sql = `
      SELECT o.*, r.name as restaurant_name, r.image_url as restaurant_image
      FROM orders o
      JOIN restaurants r ON o.restaurant_id = r.id
      WHERE o.customer_id = $1
    `;
    const params: unknown[] = [req.user!.id];

    if (status) {
      params.push(status);
      sql += ` AND o.status = $${params.length}`;
    }

    sql += ' ORDER BY o.placed_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(parseInt(limit as string), parseInt(offset as string));

    const result = await query(sql, params);

    res.json({ orders: result.rows });
  } catch (err) {
    const error = err as Error;
    logger.error({ error: error.message }, 'Get orders error');
    res.status(500).json({ error: 'Failed to get orders' });
  }
});

// Update order status
router.patch('/:id/status', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, cancelReason } = req.body;

    const order = await getOrderWithDetails(parseInt(id));
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const previousStatus = order.status;

    // Validate transition
    const currentTransition = ORDER_TRANSITIONS[order.status];
    if (!currentTransition.next.includes(status)) {
      res.status(400).json({
        error: `Cannot transition from ${order.status} to ${status}`,
      });
      return;
    }

    // Check authorization based on actor
    const isCustomer = order.customer_id === req.user!.id;
    const isRestaurantOwner = order.restaurant?.owner_id === req.user!.id;
    const isDriver = order.driver?.user_id === req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    let actorType = ACTOR_TYPES.SYSTEM;

    // Special case: customer can cancel only in PLACED status
    if (status === 'CANCELLED') {
      if (order.status === 'PLACED' && isCustomer) {
        actorType = ACTOR_TYPES.CUSTOMER;
      } else if (isRestaurantOwner || isAdmin) {
        actorType = isRestaurantOwner ? ACTOR_TYPES.RESTAURANT : ACTOR_TYPES.ADMIN;
      } else {
        res.status(403).json({ error: 'Not authorized to cancel this order' });
        return;
      }
    } else {
      // Check actor
      if (currentTransition.actor === 'restaurant' && !isRestaurantOwner && !isAdmin) {
        res.status(403).json({ error: 'Only restaurant can update this status' });
        return;
      }
      if (currentTransition.actor === 'driver' && !isDriver && !isAdmin) {
        res.status(403).json({ error: 'Only driver can update this status' });
        return;
      }
      actorType = isRestaurantOwner
        ? ACTOR_TYPES.RESTAURANT
        : isDriver
          ? ACTOR_TYPES.DRIVER
          : ACTOR_TYPES.ADMIN;
    }

    // Update status
    const updateFields = [`status = $2`, `updated_at = NOW()`];
    const params: unknown[] = [id, status];

    // Set timestamp based on status
    const timestampFields: Record<string, string> = {
      CONFIRMED: 'confirmed_at',
      PREPARING: 'preparing_at',
      READY_FOR_PICKUP: 'ready_at',
      PICKED_UP: 'picked_up_at',
      DELIVERED: 'delivered_at',
      CANCELLED: 'cancelled_at',
    };

    if (timestampFields[status]) {
      updateFields.push(`${timestampFields[status]} = NOW()`);
    }

    if (status === 'CANCELLED' && cancelReason) {
      params.push(cancelReason);
      updateFields.push(`cancel_reason = $${params.length}`);
    }

    await query(`UPDATE orders SET ${updateFields.join(', ')} WHERE id = $1`, params);

    // Update metrics
    orderStatusTransitions.inc({ from_status: previousStatus, to_status: status });
    ordersActive.dec({ status: previousStatus });
    if (!['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(status)) {
      ordersActive.inc({ status });
    }

    // If delivered, record delivery time metrics
    if (status === 'DELIVERED' && order.placed_at) {
      const deliveryTimeMinutes = (Date.now() - new Date(order.placed_at).getTime()) / 60000;
      deliveryDuration.observe(deliveryTimeMinutes);

      // Calculate ETA accuracy if we had an estimate
      if (order.estimated_delivery_at) {
        const estimatedTime = new Date(order.estimated_delivery_at).getTime();
        const actualTime = Date.now();
        const diffMinutes = (actualTime - estimatedTime) / 60000;
        etaAccuracy.observe(diffMinutes);
      }
    }

    // If confirmed, start driver matching
    if (status === 'CONFIRMED') {
      await matchDriverToOrder(parseInt(id));
    }

    // Create audit log
    await auditOrderStatusChange(
      order,
      previousStatus,
      status,
      { type: actorType, id: req.user!.id },
      {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        cancelReason: status === 'CANCELLED' ? cancelReason : undefined,
      }
    );

    logger.info(
      {
        orderId: id,
        fromStatus: previousStatus,
        toStatus: status,
        actorType,
        actorId: req.user!.id,
      },
      'Order status updated'
    );

    // Publish order status event to Kafka
    publishOrderEvent(id.toString(), status.toLowerCase(), {
      previousStatus,
      actorType,
      actorId: req.user!.id,
      cancelReason: status === 'CANCELLED' ? cancelReason : undefined,
    });

    // Get updated order
    const updatedOrder = await getOrderWithDetails(parseInt(id));

    // Calculate ETA if driver assigned
    let eta: ETAResult | null = null;
    if (updatedOrder?.driver && !['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(status)) {
      eta = calculateETA(
        {
          status: updatedOrder.status,
          preparing_at: updatedOrder.preparing_at,
          confirmed_at: updatedOrder.confirmed_at,
          placed_at: updatedOrder.placed_at,
          delivery_address: updatedOrder.delivery_address,
        },
        {
          current_lat: updatedOrder.driver.current_lat!,
          current_lon: updatedOrder.driver.current_lon!,
          vehicle_type: updatedOrder.driver.vehicle_type as 'car' | 'bike' | 'scooter' | 'walk' | undefined,
        },
        {
          lat: updatedOrder.restaurant!.lat,
          lon: updatedOrder.restaurant!.lon,
          prep_time_minutes: updatedOrder.restaurant!.prep_time_minutes,
        }
      );
      await query('UPDATE orders SET estimated_delivery_at = $1 WHERE id = $2', [eta.eta, id]);
      updatedOrder.estimated_delivery_at = eta.eta.toISOString();
      updatedOrder.eta_breakdown = eta.breakdown;
    }

    // Broadcast to all relevant parties
    broadcastToChannels(
      [`order:${id}`, `customer:${order.customer_id}:orders`, `restaurant:${order.restaurant_id}:orders`],
      {
        type: 'order_status_update',
        order: updatedOrder,
        eta,
      }
    );

    res.json({ order: updatedOrder, eta });
  } catch (err) {
    const error = err as Error;
    logger.error({ error: error.message, orderId: req.params.id }, 'Update order status error');
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// Restaurant: Get incoming orders
router.get(
  '/restaurant/:restaurantId',
  requireAuth,
  requireRole('restaurant_owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { restaurantId } = req.params;
      const { status, limit = '50' } = req.query;

      // Check ownership
      const restaurant = await query('SELECT owner_id FROM restaurants WHERE id = $1', [restaurantId]);
      if (restaurant.rows.length === 0) {
        res.status(404).json({ error: 'Restaurant not found' });
        return;
      }
      if (restaurant.rows[0].owner_id !== req.user!.id && req.user!.role !== 'admin') {
        res.status(403).json({ error: 'Not authorized' });
        return;
      }

      let sql = `
      SELECT o.*, u.name as customer_name, u.phone as customer_phone
      FROM orders o
      JOIN users u ON o.customer_id = u.id
      WHERE o.restaurant_id = $1
    `;
      const params: unknown[] = [restaurantId];

      if (status) {
        if (status === 'active') {
          sql += ` AND o.status NOT IN ('DELIVERED', 'COMPLETED', 'CANCELLED')`;
        } else {
          params.push(status);
          sql += ` AND o.status = $${params.length}`;
        }
      }

      sql += ' ORDER BY o.placed_at DESC LIMIT $' + (params.length + 1);
      params.push(parseInt(limit as string));

      const result = await query(sql, params);

      // Get items for each order
      const orders = await Promise.all(
        result.rows.map(async (order: { id: number }) => {
          const itemsResult = await query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
          return { ...order, items: itemsResult.rows };
        })
      );

      res.json({ orders });
    } catch (err) {
      const error = err as Error;
      logger.error({ error: error.message, restaurantId: req.params.restaurantId }, 'Get restaurant orders error');
      res.status(500).json({ error: 'Failed to get orders' });
    }
  }
);

// Helper: Get order with full details
async function getOrderWithDetails(orderId: number): Promise<Order | null> {
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

// Helper: Match a driver to an order (with circuit breaker)
async function matchDriverToOrder(orderId: number): Promise<DriverMatchResult> {
  const startTime = Date.now();
  const breaker = getDriverMatchCircuitBreaker();

  try {
    const result = await breaker.fire(async (): Promise<DriverMatchResult> => {
      const order = await getOrderWithDetails(orderId);
      if (!order || order.driver_id) {
        return { matched: false, reason: 'already_matched' };
      }

      // Find nearby available drivers using Redis geo
      const nearbyDrivers = await findNearbyDrivers(order.restaurant!.lat, order.restaurant!.lon, 5);

      if (nearbyDrivers.length === 0) {
        logger.warn({ orderId }, 'No drivers available for order');
        return { matched: false, reason: 'no_drivers' };
      }

      // Score drivers
      const scoredDrivers = await Promise.all(
        nearbyDrivers.map(async (d): Promise<ScoredDriver | null> => {
          const driver = await query(
            `SELECT d.*, u.name FROM drivers d JOIN users u ON d.user_id = u.id WHERE d.id = $1`,
            [d.id]
          );
          if (driver.rows.length === 0) return null;

          const driverData = driver.rows[0];
          const score = calculateMatchScore(driverData, order, d.distance);
          return { driver: driverData, score, distance: d.distance };
        })
      );

      const validDrivers = scoredDrivers
        .filter((d): d is ScoredDriver => d !== null)
        .sort((a, b) => b.score - a.score);

      if (validDrivers.length === 0) {
        return { matched: false, reason: 'no_valid_drivers' };
      }

      // Assign best driver
      const bestMatch = validDrivers[0];
      await query(`UPDATE orders SET driver_id = $1, updated_at = NOW() WHERE id = $2`, [
        bestMatch.driver.id,
        orderId,
      ]);

      // Mark driver as unavailable
      await query(`UPDATE drivers SET is_available = false WHERE id = $1`, [bestMatch.driver.id]);

      // Calculate ETA
      const fullOrder = await getOrderWithDetails(orderId);
      const eta = calculateETA(
        {
          status: fullOrder!.status,
          preparing_at: fullOrder!.preparing_at,
          confirmed_at: fullOrder!.confirmed_at,
          placed_at: fullOrder!.placed_at,
          delivery_address: fullOrder!.delivery_address,
        },
        {
          current_lat: bestMatch.driver.current_lat!,
          current_lon: bestMatch.driver.current_lon!,
        },
        {
          lat: order.restaurant!.lat,
          lon: order.restaurant!.lon,
          prep_time_minutes: order.restaurant!.prep_time_minutes,
        }
      );
      await query('UPDATE orders SET estimated_delivery_at = $1 WHERE id = $2', [eta.eta, orderId]);

      // Create audit log for driver assignment
      await auditDriverAssigned(orderId, bestMatch.driver.id, {
        score: bestMatch.score,
        distance: bestMatch.distance,
      });

      // Notify driver
      broadcast(`driver:${bestMatch.driver.user_id}:orders`, {
        type: 'order_assigned',
        order: await getOrderWithDetails(orderId),
        eta,
      });

      logger.info(
        {
          orderId,
          driverId: bestMatch.driver.id,
          score: bestMatch.score,
          distance: bestMatch.distance,
        },
        'Driver assigned to order'
      );

      // Publish dispatch event to Kafka
      publishDispatchEvent(orderId.toString(), bestMatch.driver.id.toString(), 'assigned', {
        score: bestMatch.score,
        distance: bestMatch.distance,
        estimatedDelivery: eta.eta,
      });

      return { matched: true, driverId: bestMatch.driver.id };
    });

    // Record metrics
    const duration = (Date.now() - startTime) / 1000;
    driverMatchDuration.observe(duration);

    if (result.matched) {
      driverAssignmentsTotal.inc({ result: 'success' });
    } else {
      driverAssignmentsTotal.inc({ result: result.reason || 'no_drivers' });
    }

    return result;
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message, orderId }, 'Driver matching failed');
    driverAssignmentsTotal.inc({ result: 'error' });
    return { matched: false, reason: 'error', error: err.message };
  }
}

// Helper: Find nearby drivers using Redis geo
async function findNearbyDrivers(lat: number, lon: number, radiusKm: number): Promise<NearbyDriver[]> {
  try {
    // Use Redis GEOSEARCH
    const results = await redisClient.geoSearch(
      'driver_locations',
      { longitude: lon, latitude: lat },
      {
        radius: radiusKm,
        unit: 'km',
      },
      {
        WITHDIST: true,
        SORT: 'ASC',
        COUNT: 20,
      }
    );

    // Filter by availability from database
    const availableDrivers: NearbyDriver[] = [];
    for (const result of results as Array<{ member: string; distance: number }>) {
      const driverId = parseInt(result.member);
      const check = await query(
        'SELECT id FROM drivers WHERE id = $1 AND is_active = true AND is_available = true',
        [driverId]
      );
      if (check.rows.length > 0) {
        availableDrivers.push({
          id: driverId,
          distance: result.distance,
        });
      }
    }

    return availableDrivers;
  } catch (err) {
    const error = err as Error;
    logger.warn({ error: error.message }, 'Redis geo search failed, falling back to database');
    // Fallback to database query
    const result = await query(
      `SELECT id, current_lat, current_lon FROM drivers
       WHERE is_active = true AND is_available = true
       AND current_lat IS NOT NULL AND current_lon IS NOT NULL`
    );

    return result.rows
      .map((d: { id: number; current_lat: string; current_lon: string }) => ({
        id: d.id,
        distance: haversineDistance(lat, lon, parseFloat(d.current_lat), parseFloat(d.current_lon)),
      }))
      .filter((d: NearbyDriver) => d.distance <= radiusKm)
      .sort((a: NearbyDriver, b: NearbyDriver) => a.distance - b.distance)
      .slice(0, 20);
  }
}

// Helper: Calculate match score for driver
function calculateMatchScore(
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

export default router;
