# DoorDash - System Design Answer (Fullstack Focus)

## 45-minute system design interview format - Fullstack Engineer Position

---

## Opening Statement

"Today I'll design a food delivery platform like DoorDash as a fullstack engineer, focusing on the end-to-end integration between frontend clients and backend services. The core challenges are real-time driver location tracking from mobile apps to map displays, order state synchronization across all three parties (customer, restaurant, driver), and building a responsive user experience backed by scalable APIs with proper caching and event streaming."

---

## Step 1: Requirements Clarification (3 minutes)

### Fullstack Integration Requirements

1. **Order Flow**: Customer places order, restaurant confirms, driver delivers
2. **Real-Time Sync**: Order status and driver location across all clients
3. **API Design**: RESTful APIs with WebSocket for live updates
4. **State Management**: Consistent state between frontend stores and backend
5. **Data Flow**: Optimistic updates with server reconciliation

### Scale Context

| Metric | Estimate | Integration Impact |
|--------|----------|-------------------|
| Daily Orders | 1M | 12 orders/sec sustained |
| Concurrent WebSocket Connections | 200K | Customer + driver apps |
| Location Updates | 10K/sec | Driver app to backend to customer app |
| API Requests/Sec | 50K | Restaurant browsing, order management |

---

## Step 2: Shared Type Definitions (5 minutes)

### TypeScript Interfaces (Shared Between Frontend and Backend)

```typescript
// shared/types/order.ts
export interface Order {
  id: number;
  customerId: number;
  restaurantId: number;
  driverId: number | null;
  status: OrderStatus;
  total: number;
  deliveryFee: number;
  deliveryAddress: DeliveryAddress;
  estimatedDeliveryAt: string | null;
  placedAt: string;
  confirmedAt: string | null;
  preparingAt: string | null;
  readyAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
}

export type OrderStatus =
  | 'PLACED'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'CANCELLED';

export interface OrderItem {
  id: number;
  orderId: number;
  menuItemId: number;
  name: string;
  quantity: number;
  unitPrice: number;
  specialInstructions?: string;
}

export interface DeliveryAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lon: number;
  instructions?: string;
}

// shared/types/restaurant.ts
export interface Restaurant {
  id: number;
  name: string;
  address: string;
  location: { lat: number; lon: number };
  cuisineType: string;
  rating: number;
  prepTimeMinutes: number;
  deliveryFee: number;
  isOpen: boolean;
  imageUrl: string;
}

export interface MenuItem {
  id: number;
  restaurantId: number;
  name: string;
  description: string;
  price: number;
  category: string;
  isAvailable: boolean;
  imageUrl?: string;
}

// shared/types/driver.ts
export interface Driver {
  id: number;
  name: string;
  vehicleType: string;
  rating: number;
  photoUrl?: string;
}

export interface DriverLocation {
  driverId: number;
  lat: number;
  lon: number;
  timestamp: number;
}

// shared/types/api.ts
export interface CreateOrderRequest {
  restaurantId: number;
  items: Array<{
    menuItemId: number;
    quantity: number;
    specialInstructions?: string;
  }>;
  deliveryAddress: DeliveryAddress;
}

export interface CreateOrderResponse {
  order: Order;
  items: OrderItem[];
  estimatedDeliveryAt: string;
}

// WebSocket message types
export interface OrderUpdateMessage {
  type: 'order_update';
  orderId: number;
  status: OrderStatus;
  eta?: string;
  driverLocation?: DriverLocation;
}
```

### Zod Validation Schemas (Backend)

```typescript
// backend/src/shared/validation.ts
import { z } from 'zod';

export const deliveryAddressSchema = z.object({
  street: z.string().min(1).max(200),
  city: z.string().min(1).max(100),
  state: z.string().length(2),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  instructions: z.string().max(500).optional(),
});

export const createOrderSchema = z.object({
  restaurantId: z.number().int().positive(),
  items: z.array(z.object({
    menuItemId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(20),
    specialInstructions: z.string().max(200).optional(),
  })).min(1).max(50),
  deliveryAddress: deliveryAddressSchema,
});

export const updateLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
```

---

## Step 3: Backend API Implementation (10 minutes)

### Express Routes with Validation

```typescript
// backend/src/routes/orders.ts
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../shared/db.js';
import { redis } from '../shared/cache.js';
import { kafka } from '../shared/kafka.js';
import { requireAuth } from '../shared/auth.js';
import { idempotencyMiddleware } from '../shared/idempotency.js';
import { createOrderSchema } from '../shared/validation.js';
import { logger } from '../shared/logger.js';

const router = Router();

// Create order with idempotency
router.post('/',
  requireAuth,
  idempotencyMiddleware('order_create'),
  async (req, res, next) => {
    try {
      // Validate request body
      const input = createOrderSchema.parse(req.body);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Verify restaurant is open
        const restaurant = await client.query(
          'SELECT id, is_open, prep_time_minutes FROM restaurants WHERE id = $1',
          [input.restaurantId]
        );

        if (!restaurant.rows[0]?.is_open) {
          return res.status(400).json({ error: 'Restaurant is currently closed' });
        }

        // Fetch menu items and calculate total
        const menuItemIds = input.items.map(i => i.menuItemId);
        const menuItems = await client.query(
          `SELECT id, price, is_available FROM menu_items
           WHERE id = ANY($1) AND restaurant_id = $2`,
          [menuItemIds, input.restaurantId]
        );

        const menuItemMap = new Map(menuItems.rows.map(m => [m.id, m]));

        let total = 0;
        for (const item of input.items) {
          const menuItem = menuItemMap.get(item.menuItemId);
          if (!menuItem) {
            throw new Error(`Menu item ${item.menuItemId} not found`);
          }
          if (!menuItem.is_available) {
            throw new Error(`Menu item ${item.menuItemId} is not available`);
          }
          total += menuItem.price * item.quantity;
        }

        const deliveryFee = 2.99;

        // Create order
        const orderResult = await client.query(
          `INSERT INTO orders
           (customer_id, restaurant_id, delivery_address, total, delivery_fee, status, placed_at)
           VALUES ($1, $2, $3, $4, $5, 'PLACED', NOW())
           RETURNING *`,
          [req.user.id, input.restaurantId, input.deliveryAddress, total, deliveryFee]
        );

        const order = orderResult.rows[0];

        // Create order items
        for (const item of input.items) {
          const menuItem = menuItemMap.get(item.menuItemId);
          await client.query(
            `INSERT INTO order_items
             (order_id, menu_item_id, quantity, unit_price, special_instructions)
             VALUES ($1, $2, $3, $4, $5)`,
            [order.id, item.menuItemId, item.quantity, menuItem.price, item.specialInstructions]
          );
        }

        await client.query('COMMIT');

        // Publish order created event
        await kafka.send('order_events', {
          type: 'ORDER_CREATED',
          orderId: order.id,
          restaurantId: input.restaurantId,
          customerId: req.user.id,
          timestamp: Date.now(),
        });

        logger.info({ orderId: order.id, customerId: req.user.id }, 'Order created');

        // Calculate initial ETA
        const prepTime = restaurant.rows[0].prep_time_minutes;
        const estimatedDeliveryAt = new Date(
          Date.now() + (prepTime + 20) * 60 * 1000
        );

        res.status(201).json({
          order: { ...order, estimated_delivery_at: estimatedDeliveryAt },
          estimatedDeliveryAt: estimatedDeliveryAt.toISOString(),
        });

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation failed', details: err.errors });
      }
      next(err);
    }
  }
);

// Get order with real-time ETA
router.get('/:orderId', requireAuth, async (req, res, next) => {
  try {
    const { orderId } = req.params;

    // Get order with restaurant info
    const result = await pool.query(
      `SELECT o.*, r.name as restaurant_name, r.prep_time_minutes,
              ST_X(r.location::geometry) as restaurant_lon,
              ST_Y(r.location::geometry) as restaurant_lat
       FROM orders o
       JOIN restaurants r ON o.restaurant_id = r.id
       WHERE o.id = $1 AND o.customer_id = $2`,
      [orderId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = result.rows[0];

    // Get order items
    const items = await pool.query(
      `SELECT oi.*, mi.name FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       WHERE oi.order_id = $1`,
      [orderId]
    );

    // Get driver info and location if assigned
    let driver = null;
    let driverLocation = null;

    if (order.driver_id) {
      const driverResult = await pool.query(
        `SELECT d.id, u.name, d.vehicle_type, d.rating
         FROM drivers d JOIN users u ON d.user_id = u.id
         WHERE d.id = $1`,
        [order.driver_id]
      );
      driver = driverResult.rows[0];

      // Get real-time location from Redis
      const location = await redis.hgetall(`driver:${order.driver_id}`);
      if (location.lat && location.lon) {
        driverLocation = {
          lat: parseFloat(location.lat),
          lon: parseFloat(location.lon),
          timestamp: parseInt(location.updated_at),
        };
      }
    }

    // Calculate current ETA
    const eta = await calculateETA(order, driverLocation);

    res.json({
      order,
      items: items.rows,
      driver,
      driverLocation,
      eta,
    });
  } catch (err) {
    next(err);
  }
});

// Update order status (for restaurant and driver apps)
router.patch('/:orderId/status', requireAuth, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { action } = req.body;

    const order = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);

    if (order.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Validate state transition
    const currentStatus = order.rows[0].status;
    const nextStatus = getNextStatus(currentStatus, action);

    if (!nextStatus) {
      return res.status(400).json({
        error: `Invalid action '${action}' for status '${currentStatus}'`,
      });
    }

    // Optimistic locking
    const result = await pool.query(
      `UPDATE orders
       SET status = $1, ${action}_at = NOW(), version = version + 1
       WHERE id = $2 AND version = $3
       RETURNING *`,
      [nextStatus, orderId, order.rows[0].version]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Order was modified by another process' });
    }

    // Publish status change event
    await kafka.send('order_events', {
      type: 'STATUS_CHANGED',
      orderId: parseInt(orderId),
      previousStatus: currentStatus,
      newStatus: nextStatus,
      actorId: req.user.id,
      actorType: req.user.role,
      timestamp: Date.now(),
    });

    res.json({ order: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
```

### Driver Location Endpoint

```typescript
// backend/src/routes/drivers.ts
import { Router } from 'express';
import { redis } from '../shared/cache.js';
import { updateLocationSchema } from '../shared/validation.js';
import { requireAuth, requireRole } from '../shared/auth.js';

const router = Router();

// Update driver location (called every 10 seconds from driver app)
router.post('/location', requireAuth, requireRole('driver'), async (req, res, next) => {
  try {
    const { lat, lon } = updateLocationSchema.parse(req.body);
    const driverId = req.user.driverId;

    const pipeline = redis.pipeline();

    // Update geo index for spatial queries
    pipeline.geoadd('driver_locations', lon, lat, driverId.toString());

    // Update driver metadata
    pipeline.hset(`driver:${driverId}`, {
      lat: lat.toString(),
      lon: lon.toString(),
      updated_at: Date.now().toString(),
      status: 'active',
    });

    // Set TTL - auto-expire if driver stops sending
    pipeline.expire(`driver:${driverId}`, 30);

    await pipeline.exec();

    // Publish for real-time tracking
    await redis.publish('driver_locations', JSON.stringify({
      driverId,
      lat,
      lon,
      timestamp: Date.now(),
    }));

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Get nearby available drivers (for matching service)
router.get('/nearby', requireAuth, async (req, res, next) => {
  try {
    const { lat, lon, radiusKm = 5 } = req.query;

    const drivers = await redis.geosearch(
      'driver_locations',
      'FROMMEMBER', `${lon},${lat}`,
      'BYRADIUS', radiusKm, 'km',
      'WITHDIST',
      'ASC',
      'COUNT', 20
    );

    const available = [];
    for (const [driverId, distance] of drivers) {
      const driverData = await redis.hgetall(`driver:${driverId}`);
      if (driverData.status === 'active') {
        const orderCount = await redis.get(`driver:${driverId}:order_count`) || 0;
        if (parseInt(orderCount) < 2) {
          available.push({
            id: parseInt(driverId),
            distance: parseFloat(distance),
            lat: parseFloat(driverData.lat),
            lon: parseFloat(driverData.lon),
          });
        }
      }
    }

    res.json({ drivers: available });
  } catch (err) {
    next(err);
  }
});

export default router;
```

### WebSocket Server for Real-Time Updates

```typescript
// backend/src/websocket/server.ts
import { WebSocketServer, WebSocket } from 'ws';
import { redis } from '../shared/cache.js';
import { verifyToken } from '../shared/auth.js';

interface ClientConnection {
  ws: WebSocket;
  userId: number;
  userRole: string;
  subscribedOrders: Set<number>;
}

const clients = new Map<string, ClientConnection>();

export function setupWebSocket(server: any) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    // Authenticate connection
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    try {
      const user = await verifyToken(token!);
      const clientId = `${user.id}-${Date.now()}`;

      clients.set(clientId, {
        ws,
        userId: user.id,
        userRole: user.role,
        subscribedOrders: new Set(),
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        handleClientMessage(clientId, message);
      });

      ws.on('close', () => {
        clients.delete(clientId);
      });

    } catch (err) {
      ws.close(4001, 'Unauthorized');
    }
  });

  // Subscribe to Redis pub/sub for order updates
  const subscriber = redis.duplicate();
  subscriber.subscribe('order_updates', 'driver_locations');

  subscriber.on('message', (channel, message) => {
    const data = JSON.parse(message);

    if (channel === 'order_updates') {
      broadcastOrderUpdate(data);
    } else if (channel === 'driver_locations') {
      broadcastDriverLocation(data);
    }
  });
}

function handleClientMessage(clientId: string, message: any) {
  const client = clients.get(clientId);
  if (!client) return;

  switch (message.type) {
    case 'subscribe':
      client.subscribedOrders.add(message.orderId);
      break;
    case 'unsubscribe':
      client.subscribedOrders.delete(message.orderId);
      break;
  }
}

function broadcastOrderUpdate(update: any) {
  for (const [, client] of clients) {
    if (client.subscribedOrders.has(update.orderId)) {
      client.ws.send(JSON.stringify({
        type: 'order_update',
        ...update,
      }));
    }
  }
}

function broadcastDriverLocation(location: any) {
  // Find orders that this driver is assigned to
  // Broadcast to customers tracking those orders
  for (const [, client] of clients) {
    if (client.userRole === 'customer') {
      // Check if any subscribed order is assigned to this driver
      for (const orderId of client.subscribedOrders) {
        // This would check Redis/DB for driver assignment
        client.ws.send(JSON.stringify({
          type: 'driver_location',
          orderId,
          location,
        }));
      }
    }
  }
}
```

---

## Step 4: Frontend API Client and State (10 minutes)

### API Client with Error Handling

```typescript
// frontend/src/services/api.ts
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem('auth_token');

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new ApiError(response.status, error.code || 'UNKNOWN', error.message);
  }

  return response.json();
}

export const api = {
  // Restaurants
  getRestaurants: (params: { lat: number; lon: number; cuisine?: string }) =>
    request<{ restaurants: Restaurant[] }>(
      `/restaurants?lat=${params.lat}&lon=${params.lon}${params.cuisine ? `&cuisine=${params.cuisine}` : ''}`
    ),

  getRestaurant: (id: number) =>
    request<{ restaurant: Restaurant; menu: MenuItem[] }>(`/restaurants/${id}`),

  // Orders
  createOrder: (data: CreateOrderRequest, idempotencyKey: string) =>
    request<CreateOrderResponse>('/orders', {
      method: 'POST',
      body: JSON.stringify(data),
      headers: { 'X-Idempotency-Key': idempotencyKey },
    }),

  getOrder: (id: number) =>
    request<{
      order: Order;
      items: OrderItem[];
      driver: Driver | null;
      driverLocation: DriverLocation | null;
      eta: string;
    }>(`/orders/${id}`),

  getOrders: () =>
    request<{ orders: Order[] }>('/orders'),

  updateOrderStatus: (orderId: number, action: string) =>
    request<{ order: Order }>(`/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    }),

  // Driver
  updateLocation: (lat: number, lon: number) =>
    request<{ success: boolean }>('/drivers/location', {
      method: 'POST',
      body: JSON.stringify({ lat, lon }),
    }),
};
```

### Order Store with WebSocket Integration

```typescript
// frontend/src/stores/orderStore.ts
import { create } from 'zustand';
import { api } from '@/services/api';
import { wsService } from '@/services/websocket';

interface OrderState {
  currentOrder: Order | null;
  orderItems: OrderItem[];
  driver: Driver | null;
  driverLocation: DriverLocation | null;
  eta: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchOrder: (orderId: number) => Promise<void>;
  subscribeToUpdates: (orderId: number) => () => void;
  createOrder: (data: CreateOrderRequest) => Promise<Order>;
  clearOrder: () => void;
}

export const useOrderStore = create<OrderState>((set, get) => ({
  currentOrder: null,
  orderItems: [],
  driver: null,
  driverLocation: null,
  eta: null,
  isLoading: false,
  error: null,

  fetchOrder: async (orderId: number) => {
    set({ isLoading: true, error: null });
    try {
      const data = await api.getOrder(orderId);
      set({
        currentOrder: data.order,
        orderItems: data.items,
        driver: data.driver,
        driverLocation: data.driverLocation,
        eta: data.eta,
        isLoading: false,
      });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  subscribeToUpdates: (orderId: number) => {
    const unsubscribe = wsService.subscribeToOrder(orderId, (update) => {
      // Handle different update types
      if (update.status) {
        set((state) => ({
          currentOrder: state.currentOrder
            ? { ...state.currentOrder, status: update.status }
            : null,
        }));
      }

      if (update.driverLocation) {
        set({ driverLocation: update.driverLocation });
      }

      if (update.eta) {
        set({ eta: update.eta });
      }
    });

    return unsubscribe;
  },

  createOrder: async (data: CreateOrderRequest) => {
    set({ isLoading: true, error: null });
    try {
      // Generate idempotency key
      const idempotencyKey = crypto.randomUUID();

      const response = await api.createOrder(data, idempotencyKey);

      set({
        currentOrder: response.order,
        eta: response.estimatedDeliveryAt,
        isLoading: false,
      });

      return response.order;
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
      throw err;
    }
  },

  clearOrder: () => {
    set({
      currentOrder: null,
      orderItems: [],
      driver: null,
      driverLocation: null,
      eta: null,
    });
  },
}));
```

### Checkout Page with Order Creation

```tsx
// frontend/src/routes/checkout.tsx
import { useCartStore } from '@/stores/cartStore';
import { useOrderStore } from '@/stores/orderStore';
import { useNavigate } from '@tanstack/react-router';

export function CheckoutPage() {
  const {
    items,
    restaurantId,
    restaurantName,
    deliveryAddress,
    getSubtotal,
    clearCart,
  } = useCartStore();

  const { createOrder, isLoading, error } = useOrderStore();
  const navigate = useNavigate();

  const subtotal = getSubtotal();
  const deliveryFee = 2.99;
  const serviceFee = subtotal * 0.15;
  const total = subtotal + deliveryFee + serviceFee;

  const handlePlaceOrder = async () => {
    if (!restaurantId || !deliveryAddress) return;

    try {
      const order = await createOrder({
        restaurantId,
        items: items.map((item) => ({
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          specialInstructions: item.specialInstructions,
        })),
        deliveryAddress,
      });

      // Clear cart after successful order
      clearCart();

      // Navigate to order tracking
      navigate({ to: '/orders/$orderId', params: { orderId: order.id.toString() } });
    } catch (err) {
      // Error is already set in store
      console.error('Failed to create order:', err);
    }
  };

  if (!restaurantId || items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto p-4 text-center">
        <h1 className="text-2xl font-bold mb-4">Your cart is empty</h1>
        <Link to="/" className="text-red-500 hover:underline">
          Browse restaurants
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Checkout</h1>

      {/* Delivery address */}
      <section className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <h2 className="font-semibold mb-2">Delivery Address</h2>
        {deliveryAddress ? (
          <div>
            <p>{deliveryAddress.street}</p>
            <p>{deliveryAddress.city}, {deliveryAddress.state} {deliveryAddress.zip}</p>
            {deliveryAddress.instructions && (
              <p className="text-sm text-gray-500 mt-1">{deliveryAddress.instructions}</p>
            )}
          </div>
        ) : (
          <button className="text-red-500">Add delivery address</button>
        )}
      </section>

      {/* Order summary */}
      <section className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <h2 className="font-semibold mb-2">{restaurantName}</h2>
        {items.map((item) => (
          <div key={item.menuItemId} className="flex justify-between py-2 border-b last:border-0">
            <span>{item.quantity}x {item.name}</span>
            <span>${(item.price * item.quantity).toFixed(2)}</span>
          </div>
        ))}
      </section>

      {/* Price breakdown */}
      <section className="bg-white rounded-xl shadow-sm p-4 mb-6">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>${subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Delivery Fee</span>
            <span>${deliveryFee.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Service Fee</span>
            <span>${serviceFee.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-semibold text-base pt-2 border-t">
            <span>Total</span>
            <span>${total.toFixed(2)}</span>
          </div>
        </div>
      </section>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-4">
          {error}
        </div>
      )}

      {/* Place order button */}
      <button
        onClick={handlePlaceOrder}
        disabled={isLoading || !deliveryAddress}
        className="w-full bg-red-500 text-white py-4 rounded-xl font-semibold text-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? 'Placing Order...' : `Place Order - $${total.toFixed(2)}`}
      </button>
    </div>
  );
}
```

---

## Step 5: End-to-End Data Flow (5 minutes)

### Order Placement Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Customer  │     │   API       │     │ PostgreSQL  │     │   Kafka     │
│   Frontend  │     │   Gateway   │     │             │     │             │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │                   │
       │ POST /orders      │                   │                   │
       │ X-Idempotency-Key │                   │                   │
       │──────────────────>│                   │                   │
       │                   │                   │                   │
       │                   │ Check idempotency │                   │
       │                   │ key in Redis      │                   │
       │                   │                   │                   │
       │                   │ BEGIN TRANSACTION │                   │
       │                   │──────────────────>│                   │
       │                   │                   │                   │
       │                   │ INSERT order      │                   │
       │                   │ INSERT order_items│                   │
       │                   │──────────────────>│                   │
       │                   │                   │                   │
       │                   │ COMMIT            │                   │
       │                   │──────────────────>│                   │
       │                   │                   │                   │
       │                   │ Cache idempotency │                   │
       │                   │ response (24h)    │                   │
       │                   │                   │                   │
       │                   │ Publish ORDER_CREATED                 │
       │                   │──────────────────────────────────────>│
       │                   │                   │                   │
       │   201 Created     │                   │                   │
       │   { order, eta }  │                   │                   │
       │<──────────────────│                   │                   │
       │                   │                   │                   │
```

### Real-Time Tracking Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Driver    │     │   Location  │     │   Valkey    │     │  Customer   │
│   App       │     │   Service   │     │   (Redis)   │     │  App        │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │                   │
       │ POST /location    │                   │                   │
       │ { lat, lon }      │                   │                   │
       │──────────────────>│                   │                   │
       │                   │                   │                   │
       │                   │ GEOADD            │                   │
       │                   │ driver_locations  │                   │
       │                   │──────────────────>│                   │
       │                   │                   │                   │
       │                   │ HSET driver:123   │                   │
       │                   │ { lat, lon, ts }  │                   │
       │                   │──────────────────>│                   │
       │                   │                   │                   │
       │                   │ PUBLISH           │                   │
       │                   │ driver_locations  │                   │
       │                   │──────────────────>│                   │
       │                   │                   │                   │
       │                   │                   │ WebSocket push    │
       │                   │                   │ { driverLocation }│
       │                   │                   │──────────────────>│
       │                   │                   │                   │
       │   200 OK          │                   │   Map marker      │
       │<──────────────────│                   │   updates         │
       │                   │                   │                   │
```

### Order Status Update Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Restaurant  │     │   Order     │     │   Kafka     │     │  WebSocket  │
│   Tablet    │     │   Service   │     │             │     │  Server     │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │                   │
       │ PATCH /orders/123 │                   │                   │
       │ { action:         │                   │                   │
       │   "restaurant_    │                   │                   │
       │    confirm" }     │                   │                   │
       │──────────────────>│                   │                   │
       │                   │                   │                   │
       │                   │ UPDATE orders     │                   │
       │                   │ SET status =      │                   │
       │                   │ 'CONFIRMED'       │                   │
       │                   │ WHERE version = n │                   │
       │                   │                   │                   │
       │                   │ Publish           │                   │
       │                   │ STATUS_CHANGED    │                   │
       │                   │──────────────────>│                   │
       │                   │                   │                   │
       │                   │                   │ Consumer receives │
       │                   │                   │──────────────────>│
       │                   │                   │                   │
       │   200 OK          │                   │   Broadcast to    │
       │   { order }       │                   │   subscribed      │
       │<──────────────────│                   │   customers       │
       │                   │                   │                   │
```

---

## Step 6: Testing Strategy (3 minutes)

### Backend Integration Tests

```typescript
// backend/src/routes/orders.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';

vi.mock('../shared/db.js', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn(),
      release: vi.fn(),
    }),
  },
}));

vi.mock('../shared/cache.js', () => ({
  redis: {
    get: vi.fn(),
    setex: vi.fn(),
    pipeline: vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue([]),
    }),
  },
}));

vi.mock('../shared/kafka.js', () => ({
  kafka: { send: vi.fn().mockResolvedValue(undefined) },
}));

describe('POST /api/orders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates order with valid data', async () => {
    const { pool } = await import('../shared/db.js');
    const client = await pool.connect();

    // Mock restaurant query
    client.query.mockResolvedValueOnce({
      rows: [{ id: 1, is_open: true, prep_time_minutes: 20 }],
    });

    // Mock menu items query
    client.query.mockResolvedValueOnce({
      rows: [{ id: 1, price: 15.99, is_available: true }],
    });

    // Mock order insert
    client.query.mockResolvedValueOnce({
      rows: [{ id: 1, status: 'PLACED', total: 15.99 }],
    });

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', 'Bearer test-token')
      .set('X-Idempotency-Key', 'test-key-123')
      .send({
        restaurantId: 1,
        items: [{ menuItemId: 1, quantity: 1 }],
        deliveryAddress: {
          street: '123 Main St',
          city: 'San Francisco',
          state: 'CA',
          zip: '94102',
          lat: 37.7749,
          lon: -122.4194,
        },
      });

    expect(response.status).toBe(201);
    expect(response.body.order.status).toBe('PLACED');
  });

  it('returns cached response for duplicate idempotency key', async () => {
    const { redis } = await import('../shared/cache.js');

    redis.get.mockResolvedValueOnce(JSON.stringify({
      statusCode: 201,
      body: { order: { id: 1, status: 'PLACED' } },
    }));

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', 'Bearer test-token')
      .set('X-Idempotency-Key', 'existing-key')
      .send({
        restaurantId: 1,
        items: [{ menuItemId: 1, quantity: 1 }],
        deliveryAddress: { /* ... */ },
      });

    expect(response.status).toBe(201);
    expect(response.body.order.id).toBe(1);
  });
});
```

### Frontend Component Tests

```tsx
// frontend/src/components/order/OrderTimeline.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { OrderTimeline } from './OrderTimeline';

describe('OrderTimeline', () => {
  it('renders current step as active', () => {
    render(
      <OrderTimeline
        status="PREPARING"
        timestamps={{
          placedAt: '2024-01-15T10:00:00Z',
          confirmedAt: '2024-01-15T10:02:00Z',
          preparingAt: '2024-01-15T10:05:00Z',
        }}
      />
    );

    // Check completed steps
    expect(screen.getByText('Order Placed')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();

    // Check current step is highlighted
    const preparingStep = screen.getByText('Preparing');
    expect(preparingStep.closest('div')).toHaveClass('text-gray-900');
  });

  it('shows timestamps for completed steps', () => {
    render(
      <OrderTimeline
        status="PICKED_UP"
        timestamps={{
          placedAt: '2024-01-15T10:00:00Z',
          confirmedAt: '2024-01-15T10:02:00Z',
          preparingAt: '2024-01-15T10:05:00Z',
          readyAt: '2024-01-15T10:20:00Z',
          pickedUpAt: '2024-01-15T10:25:00Z',
        }}
      />
    );

    expect(screen.getByText('10:00 AM')).toBeInTheDocument();
    expect(screen.getByText('10:25 AM')).toBeInTheDocument();
  });
});
```

---

## Step 7: Error Handling and Recovery (2 minutes)

### Frontend Error Boundary

```tsx
// frontend/src/components/common/ErrorBoundary.tsx
import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('Error boundary caught:', error, errorInfo);
    // Could send to error tracking service
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-8 text-center">
          <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
          <p className="text-gray-600 mb-4">{this.state.error?.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 bg-red-500 text-white rounded-lg"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

### Backend Error Middleware

```typescript
// backend/src/middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../shared/logger.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Log error with request context
  logger.error({
    err,
    requestId: req.headers['x-request-id'],
    path: req.path,
    method: req.method,
    userId: (req as any).user?.id,
  }, 'Request error');

  // Validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: err.errors,
    });
  }

  // Conflict errors (optimistic locking)
  if (err.message.includes('was modified')) {
    return res.status(409).json({
      error: err.message,
      code: 'CONFLICT',
    });
  }

  // Default server error
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
}
```

---

## Closing Summary

I've designed a fullstack food delivery platform focusing on end-to-end integration:

1. **Shared Type Definitions**: TypeScript interfaces shared between frontend and backend ensure type safety across the stack, with Zod schemas for backend validation

2. **API Layer**: RESTful endpoints with idempotency for order creation, optimistic locking for status updates, and proper error handling with structured responses

3. **Real-Time Integration**: WebSocket server with Redis pub/sub broadcasts order updates and driver locations to subscribed clients; frontend stores update reactively

4. **State Synchronization**: Zustand stores on frontend integrate with API client and WebSocket service; optimistic updates with server reconciliation

5. **Data Flow**: Clear separation between order placement (transactional), status updates (event-driven), and location tracking (real-time streaming)

**Key Fullstack Integration Patterns:**
- Idempotency keys prevent duplicate orders on network retries
- Optimistic locking prevents race conditions in status updates
- WebSocket with Redis pub/sub enables scalable real-time updates
- Shared types ensure frontend/backend contract alignment
- Error boundaries and middleware provide graceful degradation
