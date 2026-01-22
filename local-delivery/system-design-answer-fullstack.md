# Local Delivery Service - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## Problem Statement

Design a local delivery platform like DoorDash, Instacart, or Uber Eats. The core challenges are real-time driver location tracking with geo-indexing, efficient driver-order matching with scoring algorithms, WebSocket-based live updates, and building a seamless three-sided marketplace connecting customers, merchants, and drivers.

## Requirements Clarification

### Functional Requirements
- **Order placement**: Customers browse merchants, build cart, place orders
- **Driver matching**: Match orders to nearby available drivers using scoring
- **Real-time tracking**: Live driver location and ETA updates
- **Driver dashboard**: Go online/offline, accept offers, manage deliveries
- **Admin interface**: Monitor system statistics, orders, and drivers

### Non-Functional Requirements
- **Latency**: Driver match within 30 seconds, location updates every 3 seconds
- **Scale**: 1M orders/day, 100K concurrent drivers
- **Availability**: 99.99% for order placement
- **Responsiveness**: Frontend renders updates within 100ms of receipt

### Three-Sided Marketplace
- **Customers**: Browse and order, track deliveries
- **Drivers**: Manage availability, accept/complete orders
- **Merchants**: Receive orders, update prep status (future)

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            Client Layer                                   │
├──────────────────────────────────────────────────────────────────────────┤
│   ┌─────────────┐      ┌─────────────┐      ┌─────────────┐              │
│   │  Customer   │      │   Driver    │      │    Admin    │              │
│   │  React App  │      │  React App  │      │  React App  │              │
│   └──────┬──────┘      └──────┬──────┘      └──────┬──────┘              │
│          └──────────────┬─────┴─────────────┬──────┘                     │
│                         │ HTTPS / WebSocket │                            │
└─────────────────────────┼───────────────────┼────────────────────────────┘
                          ▼                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                            API Layer                                      │
├──────────────────────────────────────────────────────────────────────────┤
│   ┌────────────────────────────────────────────────────────────────┐     │
│   │                      Express.js Server                          │     │
│   │   ┌──────────────────┐      ┌──────────────────┐               │     │
│   │   │   REST Routes    │      │    WebSocket     │               │     │
│   │   │   /api/v1/*      │      │    Handler       │               │     │
│   │   └──────────────────┘      └──────────────────┘               │     │
│   └────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           Service Layer                                   │
├──────────────────────────────────────────────────────────────────────────┤
│   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐              │
│   │  Order   │   │ Location │   │ Matching │   │ Tracking │              │
│   │ Service  │   │ Service  │   │ Service  │   │ Service  │              │
│   └──────────┘   └──────────┘   └──────────┘   └──────────┘              │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                            Data Layer                                     │
├──────────────────────────────────────────────────────────────────────────┤
│        ┌───────────────────┐         ┌───────────────────┐               │
│        │    PostgreSQL     │         │      Redis        │               │
│        │  (Transactions)   │         │ (Geo + Pub/Sub)   │               │
│        └───────────────────┘         └───────────────────┘               │
└──────────────────────────────────────────────────────────────────────────┘
```

## Deep Dives

### 1. Shared Type Definitions

TypeScript types shared between frontend and backend ensure consistency:

**User & Driver Types:**
- User: id, email, name, phone, role (customer/driver/merchant/admin), created_at
- Driver extends User: vehicle_type, status (offline/available/busy), rating, total_deliveries, acceptance_rate, current_lat/lng

**Merchant & Menu Types:**
- Merchant: id, name, description, address, lat/lng, category, avg_prep_time_minutes, rating, is_open
- MenuItem: id, merchant_id, name, description, price, category, image_url, is_available

**Order Types:**
- OrderStatus: pending | confirmed | preparing | ready_for_pickup | driver_assigned | picked_up | in_transit | delivered | cancelled
- Order: id, customer_id, merchant_id, driver_id, status, delivery_address, delivery_lat/lng, subtotal, delivery_fee, tip, total, estimated_delivery_time, created_at, items[], merchant?, driver?
- OrderItem: id, menu_item_id, name, quantity, unit_price, special_instructions

**WebSocket Types:**
- WSMessageType: new_offer | offer_expired | location_update | status_update | order_cancelled
- WSMessage<T>: type, data, timestamp
- ApiResponse<T>: data, meta (page, limit, total)
- ApiError: error, message, statusCode

### 2. RESTful API Design

**Customer Endpoints:**
- GET /api/v1/merchants?lat=&lng=&category=&limit= - Browse nearby merchants with distance calculation using Haversine formula
- GET /api/v1/merchants/:id/menu - Get merchant details and available menu items
- POST /api/v1/orders - Create order with idempotency key, transaction-based item creation, triggers async driver matching

**Driver Endpoints:**
- POST /api/v1/driver/go-online - Update PostgreSQL status, add to Redis geo index
- POST /api/v1/driver/location - Update Redis GEOADD, update PostgreSQL last-known, publish for real-time subscribers, log to history
- POST /api/v1/driver/offers/:orderId/accept - Verify offer validity, use transaction to prevent race conditions, assign driver with optimistic lock, notify customer via pub/sub

### 3. Frontend API Client Integration

Typed API client with error handling using Zustand for auth token management:

**Core Methods:**
- get<T>(path): GET request with auth headers
- post<T>(path, data, options): POST with optional idempotency key

**Typed API Functions:**
- fetchMerchants(lat, lng, category) -> Merchant[]
- fetchMerchantMenu(merchantId) -> { merchant, menu }
- createOrder(orderData) -> Order (with auto-generated idempotency key)
- goOnline(location) / goOffline() - Driver status management
- acceptOffer(orderId) -> Order

### 4. Order Placement Flow (End-to-End)

**Frontend Cart Component Flow:**
1. Validate required fields (merchantId, items, deliveryAddress, position)
2. Call createOrder with cart items mapped to API format
3. Clear cart on success
4. Navigate to order tracking page
5. Handle errors with user-friendly messages

**Backend Order Processing:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Driver Matching Algorithm                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   1. Get order with merchant location                                    │
│   2. Loop up to 5 attempts:                                              │
│      ├─ findBestDriver(merchantLat, merchantLng, excludedDrivers)        │
│      │   ├─ Redis GEORADIUS: nearby drivers within 5km                   │
│      │   ├─ Filter: available status, not excluded                       │
│      │   ├─ Score calculation:                                           │
│      │   │   ├─ Distance score (40%): closer = better                    │
│      │   │   ├─ Rating score (25%): higher rating = better               │
│      │   │   ├─ Acceptance rate (20%): higher = better                   │
│      │   │   └─ Load score (15%): fewer current orders = better          │
│      │   └─ Return highest scoring candidate                             │
│      ├─ Create offer record (30s expiry)                                 │
│      ├─ Send offer via Redis pub/sub -> WebSocket                        │
│      ├─ Wait for response (30s timeout)                                  │
│      └─ If rejected/timeout: add to excludedDrivers, continue            │
│   3. If no driver accepts after 5 attempts: notify customer              │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5. Real-time Tracking Integration

**Backend WebSocket Handler:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        WebSocket Architecture                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ClientConnection: { ws, userId, role, subscriptions: Set<string> }     │
│                                                                          │
│   Message Types:                                                         │
│   ├─ auth: Authenticate with session token                               │
│   ├─ subscribe: Subscribe to order updates (auto-subscribes to driver)   │
│   ├─ unsubscribe: Remove subscription                                    │
│   └─ location_update: Driver sends location (for real-time)              │
│                                                                          │
│   Redis PSubscribe Patterns:                                             │
│   ├─ driver:*:location -> Forward to customers tracking that driver      │
│   ├─ order:*:status -> Forward to customers subscribed to that order     │
│   └─ driver:*:offers -> Forward to specific driver client                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Frontend Order Tracking Hook:**
- useOrderTracking(orderId) returns: order, driverLocation, eta, isLoading, error, refetch
- Initial fetch via REST API
- WebSocket subscription for real-time updates
- Handles location_update and status_update events
- Auto-refetch when driver_assigned to get driver details
- Cleanup on unmount

### 6. Session Management

**Backend Session Service:**
- createSession: Generate UUID token, store in Redis with 24h TTL, backup to PostgreSQL
- getSession: Read from Redis cache
- destroySession: Delete from both Redis and PostgreSQL
- requireAuth middleware: Extract Bearer token, validate session, attach userId/userRole to request
- requireRole middleware: Check userRole against allowed roles

**Frontend Auth Store (Zustand with persistence):**
- State: user, token, isAuthenticated, isLoading
- Actions: login, register, logout, checkSession
- Persistence: Only token persisted to localStorage
- checkSession: Called on app load to validate stored token

### 7. Error Handling Across Stack

**Backend Error Handler:**
- AppError class: statusCode, message, isOperational
- Catches foreign key violations -> 400 ValidationError
- Catches duplicate key violations -> 409 ConflictError
- Default -> 500 InternalServerError

**Frontend Error Display Component:**
- Props: error, onRetry, onDismiss
- Renders alert with error message
- Optional retry and dismiss buttons
- role="alert" for accessibility

## Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| State management | Zustand | Redux / React Query | Minimal boilerplate, persistence middleware built-in |
| API communication | REST + WebSocket | GraphQL subscriptions | Simpler for real-time location updates, REST familiar |
| Session storage | Redis + PostgreSQL | JWT only | Instant revocation, Redis for speed, PG for durability |
| Type sharing | Manual sync | Monorepo with shared package | Simpler setup for learning project |
| Real-time updates | WebSocket + Redis Pub/Sub | Server-Sent Events | Bidirectional needed for driver actions |
| Geo-indexing | Redis GEOADD | PostgreSQL PostGIS | Sub-ms queries for real-time matching |

## Future Enhancements

1. **GraphQL layer**: Add GraphQL for flexible data fetching with subscriptions
2. **Type code generation**: Generate types from OpenAPI/Prisma schema
3. **Service worker**: Offline queue for order placement, cache merchants
4. **End-to-end tests**: Playwright tests covering order placement to delivery
5. **Metrics dashboard**: Real-time monitoring with Prometheus + Grafana
6. **Map integration**: Mapbox/Google Maps for visual driver tracking
