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

**Order Interface:**
- `id`, `customerId`, `restaurantId`, `driverId` (nullable)
- `status`: OrderStatus enum
- `total`, `deliveryFee`
- `deliveryAddress`: DeliveryAddress object
- `estimatedDeliveryAt` (nullable), `placedAt`
- Timestamp fields: `confirmedAt`, `preparingAt`, `readyAt`, `pickedUpAt`, `deliveredAt` (all nullable)

**OrderStatus Enum:**
- PLACED, CONFIRMED, PREPARING, READY_FOR_PICKUP, PICKED_UP, DELIVERED, CANCELLED

**OrderItem Interface:**
- `id`, `orderId`, `menuItemId`, `name`, `quantity`, `unitPrice`
- `specialInstructions` (optional)

**DeliveryAddress Interface:**
- `street`, `city`, `state`, `zip`
- `lat`, `lon` (coordinates)
- `instructions` (optional)

**Restaurant Interface:**
- `id`, `name`, `address`
- `location`: { lat, lon }
- `cuisineType`, `rating`, `prepTimeMinutes`, `deliveryFee`
- `isOpen`, `imageUrl`

**MenuItem Interface:**
- `id`, `restaurantId`, `name`, `description`, `price`
- `category`, `isAvailable`, `imageUrl` (optional)

**Driver Interface:**
- `id`, `name`, `vehicleType`, `rating`, `photoUrl` (optional)

**DriverLocation Interface:**
- `driverId`, `lat`, `lon`, `timestamp`

**API Types:**

CreateOrderRequest:
- `restaurantId`
- `items`: array of { menuItemId, quantity, specialInstructions? }
- `deliveryAddress`: DeliveryAddress

CreateOrderResponse:
- `order`: Order, `items`: OrderItem[], `estimatedDeliveryAt`

**WebSocket Message Types:**

OrderUpdateMessage:
- `type`: 'order_update'
- `orderId`, `status`
- `eta` (optional), `driverLocation` (optional)

### Zod Validation Schemas (Backend)

**deliveryAddressSchema:**
- street: string 1-200 chars
- city: string 1-100 chars
- state: exactly 2 chars
- zip: regex for 5 digits (optional +4)
- lat: -90 to 90, lon: -180 to 180
- instructions: optional max 500 chars

**createOrderSchema:**
- restaurantId: positive integer
- items: array 1-50 of { menuItemId, quantity 1-20, specialInstructions? max 200 }
- deliveryAddress: uses deliveryAddressSchema

**updateLocationSchema:**
- lat: -90 to 90, lon: -180 to 180

---

## Step 3: Backend API Implementation (10 minutes)

### Express Routes: Orders

**POST / (Create Order with Idempotency):**

1. Apply requireAuth and idempotencyMiddleware('order_create')
2. Validate request body with createOrderSchema.parse()
3. Begin PostgreSQL transaction
4. Verify restaurant is open, return 400 if closed
5. Fetch menu items, verify availability, calculate total
6. Set deliveryFee = $2.99
7. INSERT order with status 'PLACED'
8. INSERT order_items for each item
9. COMMIT transaction
10. Publish ORDER_CREATED event to Kafka
11. Log order creation
12. Calculate initial ETA = prep_time + 20 minutes
13. Return 201 with order and estimatedDeliveryAt
14. On error: ROLLBACK, handle ZodError with 400

**GET /:orderId (Get Order with Real-Time ETA):**

1. Query order with restaurant info (name, prep_time, location via PostGIS)
2. Return 404 if not found or not owned by user
3. Query order_items with menu item names
4. If driver assigned:
   - Query driver info (name, vehicle_type, rating)
   - Get real-time location from Redis HGETALL driver:{id}
   - Parse lat, lon, timestamp
5. Calculate current ETA
6. Return order, items, driver, driverLocation, eta

**PATCH /:orderId/status (Update Order Status):**

1. Get current order, return 404 if not found
2. Validate state transition with getNextStatus(currentStatus, action)
3. Return 400 if invalid transition
4. Optimistic locking: UPDATE with version check
5. Return 409 if version mismatch (concurrent modification)
6. Publish STATUS_CHANGED event to Kafka with actor info
7. Return updated order

### Express Routes: Drivers

**POST /location (Update Driver Location):**

Called every 10 seconds from driver app

1. Validate with updateLocationSchema
2. Execute Redis pipeline:
   - GEOADD driver_locations with lon, lat, driverId
   - HSET driver:{id} with lat, lon, updated_at, status='active'
   - EXPIRE driver:{id} 30 seconds (auto-expire if stopped)
3. PUBLISH to 'driver_locations' channel for real-time tracking
4. Return success

**GET /nearby (Get Nearby Available Drivers):**

For matching service

1. Extract lat, lon, radiusKm (default 5) from query
2. GEOSEARCH driver_locations within radius, sorted by distance
3. For each driver:
   - Check status='active' from HGETALL
   - Check order_count < 2 from Redis
   - Include if available
4. Return array with id, distance, lat, lon

### WebSocket Server for Real-Time Updates

**ClientConnection State:**
- ws: WebSocket, userId, userRole
- subscribedOrders: Set of order IDs

**Connection Setup:**

1. Authenticate via token in query params
2. Store connection in clients Map
3. Handle messages: subscribe/unsubscribe to orders
4. On close: remove from clients Map

**Redis Pub/Sub Integration:**

Subscribe to channels: 'order_updates', 'driver_locations'

On message:
- order_updates: broadcastOrderUpdate to subscribed clients
- driver_locations: broadcastDriverLocation to customers tracking orders

**broadcastOrderUpdate(update):**
- Iterate clients, send to those subscribed to update.orderId

**broadcastDriverLocation(location):**
- For customer clients, check if subscribed orders assigned to this driver
- Send driver_location message with orderId and location

---

## Step 4: Frontend API Client and State (10 minutes)

### API Client with Error Handling

**ApiError Class:**
- status: number, code: string, message: string

**request<T> Helper:**
- Get auth token from localStorage
- Fetch with Content-Type JSON and Authorization header
- On error: throw ApiError with status, code, message
- Return parsed JSON

**API Methods:**

Restaurants:
- getRestaurants(lat, lon, cuisine?) -> { restaurants }
- getRestaurant(id) -> { restaurant, menu }

Orders:
- createOrder(data, idempotencyKey) -> CreateOrderResponse (with X-Idempotency-Key header)
- getOrder(id) -> { order, items, driver, driverLocation, eta }
- getOrders() -> { orders }
- updateOrderStatus(orderId, action) -> { order }

Driver:
- updateLocation(lat, lon) -> { success }

### Order Store (Zustand) with WebSocket Integration

**State:**
- currentOrder, orderItems, driver, driverLocation, eta
- isLoading, error

**Actions:**

fetchOrder(orderId):
1. Set isLoading, clear error
2. Call api.getOrder()
3. Update state with order, items, driver, driverLocation, eta
4. Handle errors

subscribeToUpdates(orderId):
1. Call wsService.subscribeToOrder with callback
2. On status update: merge into currentOrder
3. On driverLocation update: update state
4. On eta update: update state
5. Return unsubscribe function

createOrder(data):
1. Set isLoading, clear error
2. Generate idempotencyKey with crypto.randomUUID()
3. Call api.createOrder()
4. Update currentOrder and eta
5. Return order (for navigation)

clearOrder():
- Reset all state to null/empty

### CheckoutPage Component

**Uses:**
- useCartStore for items, restaurantId, restaurantName, deliveryAddress, getSubtotal, clearCart
- useOrderStore for createOrder, isLoading, error
- useNavigate for routing

**Calculations:**
- subtotal from cart
- deliveryFee = $2.99
- serviceFee = subtotal * 15%
- total = subtotal + deliveryFee + serviceFee

**handlePlaceOrder Flow:**
1. Validate restaurantId and deliveryAddress exist
2. Call createOrder with cart items mapped to API format
3. On success: clearCart, navigate to /orders/$orderId
4. On error: logged, error displayed from store

**UI Sections:**
- Empty cart: Show message with link to browse restaurants
- Delivery address section (editable)
- Order summary with item list
- Price breakdown (subtotal, delivery, service, total)
- Error message display
- Place order button (disabled when loading or no address)

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

**Test Setup:**
- Mock shared modules: db.pool, cache.redis, kafka
- Use vitest with supertest for HTTP testing

**POST /api/orders Tests:**

Test: creates order with valid data
1. Mock client.query for restaurant (is_open: true)
2. Mock menu items query (price, is_available)
3. Mock order insert returning id, status: 'PLACED'
4. POST with auth token and idempotency key
5. Assert 201, status PLACED

Test: returns cached response for duplicate idempotency key
1. Mock redis.get returning cached response
2. POST with existing key
3. Assert 201 with cached order data

### Frontend Component Tests

**OrderTimeline Component Tests:**

Test: renders current step as active
1. Render with status="PREPARING" and timestamps
2. Assert completed steps visible
3. Assert current step highlighted with correct class

Test: shows timestamps for completed steps
1. Render with status="PICKED_UP" and all timestamps
2. Assert formatted times displayed (10:00 AM, 10:25 AM)

---

## Step 7: Error Handling and Recovery (2 minutes)

### Frontend Error Boundary

**ErrorBoundary Component:**

State: hasError, error

getDerivedStateFromError: Set hasError true, capture error

componentDidCatch: Log error and info, optionally send to tracking service

render:
- If hasError: Show fallback UI with error message and Try Again button
- Otherwise: Render children

### Backend Error Middleware

**errorHandler Middleware:**

1. Log error with context (requestId, path, method, userId)
2. If ZodError: Return 400 with code VALIDATION_ERROR and details
3. If conflict message: Return 409 with code CONFLICT
4. Default: Return 500 with code INTERNAL_ERROR

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
