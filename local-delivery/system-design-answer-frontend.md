# Local Delivery Service - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Problem Statement

Design the frontend for a local delivery platform like DoorDash, Instacart, or Uber Eats. The core challenges are real-time driver tracking with map visualization, responsive order management across customer/driver/admin interfaces, managing WebSocket connections for live updates, and optimizing performance for location-based browsing.

## Requirements Clarification

### Functional Requirements
- **Customer interface**: Browse merchants, build cart, place orders, track delivery
- **Driver dashboard**: Go online/offline, receive offers, manage active deliveries, update location
- **Admin dashboard**: View system statistics, monitor orders and drivers
- **Real-time tracking**: Live driver location updates with ETA display
- **Responsive design**: Work across desktop and mobile devices

### Non-Functional Requirements
- **Performance**: First contentful paint < 1.5s, time to interactive < 3s
- **Real-time latency**: Location updates render within 100ms of receipt
- **Offline capability**: Basic cart functionality without network
- **Accessibility**: WCAG 2.1 AA compliance

### User Personas
- **Customers**: Browse and order, expect familiar e-commerce UX
- **Drivers**: Need quick actions, minimal distraction while driving
- **Admins**: Data-dense dashboards, need to monitor multiple metrics

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND APPLICATION                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐           │
│  │    Customer      │  │     Driver       │  │      Admin       │           │
│  │    Routes        │  │     Routes       │  │      Routes      │           │
│  │                  │  │                  │  │                  │           │
│  │ - / (merchants)  │  │ - /driver        │  │ - /admin         │           │
│  │ - /cart          │  │   (dashboard)    │  │   (stats)        │           │
│  │ - /orders        │  │                  │  │                  │           │
│  │ - /orders/:id    │  │                  │  │                  │           │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘           │
│           │                     │                     │                      │
│           ▼                     ▼                     ▼                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    Shared Components                                   │  │
│  │  LoadingSpinner, StatusBadge, Navbar, OrderCard, etc.                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│           │                     │                     │                      │
│           ▼                     ▼                     ▼                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                      State Layer (Zustand)                             │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐                │  │
│  │  │ authStore   │  │ cartStore   │  │ locationStore   │                │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘                │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│           │                     │                     │                      │
│           ▼                     ▼                     ▼                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    Service Layer                                       │  │
│  │  ┌──────────────────┐       ┌──────────────────┐                      │  │
│  │  │     api.ts       │       │  websocket.ts    │                      │  │
│  │  │ (REST client)    │       │ (WS manager)     │                      │  │
│  │  └──────────────────┘       └──────────────────┘                      │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Deep Dives

### 1. Component Architecture

The frontend follows a component-based architecture with clear separation between presentation and logic.

**Component Organization:**
- `components/` - Shared UI components
- `components/driver/` - Driver-specific components with barrel exports
- `hooks/` - Custom hooks extracting complex logic
- `routes/` - Page components (Tanstack Router file-based)
- `services/` - API and WebSocket clients
- `stores/` - Zustand state management
- `types/` - TypeScript interfaces

### 2. Driver Dashboard Components

**DriverStatusHeader Component:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DRIVER STATUS HEADER                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐                                              ┌──────────────┐ │
│  │  Avatar  │  Driver Name                                 │  Go Online   │ │
│  │  (first  │  Status: Online/Offline                      │     or       │ │
│  │  letter) │  (green/gray text)                           │  Go Offline  │ │
│  └──────────┘                                              └──────────────┘ │
│                                                                              │
│  Props:                                                                      │
│  - name: string                                                              │
│  - isOnline: boolean                                                         │
│  - onToggleStatus: () => void                                               │
│  - isLoading: boolean                                                        │
│                                                                              │
│  Styling:                                                                    │
│  - Online: bg-red-100 text-red-700 (shows "Go Offline")                     │
│  - Offline: bg-green-100 text-green-700 (shows "Go Online")                 │
│  - Loading: opacity-50 cursor-not-allowed                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

**ActiveDeliveryCard Component:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ACTIVE DELIVERY CARD                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ Merchant Name                                    [Status Badge]       │   │
│  │ Merchant Address                                                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ────────────────────────────────────────────────────────────────────────   │
│  Deliver to:                                                                 │
│  Customer Address                                                            │
│  2.5 km away (if distance provided)                                         │
│  ────────────────────────────────────────────────────────────────────────   │
│  3 items - $45.99                                                            │
│  ────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    [ACTION BUTTON]                                    │   │
│  │   driver_assigned → "Confirm Pickup"                                  │   │
│  │   picked_up       → "Start Delivery"                                  │   │
│  │   in_transit      → "Complete Delivery"                               │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**DeliveryOfferModal Component:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       DELIVERY OFFER MODAL                                   │
│                    (fixed inset-0 bg-black/50 z-50)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                        │ │
│  │                     New Delivery Offer                                 │ │
│  │                    Expires in {N}s                                     │ │
│  │                   (red if <= 10s remaining)                            │ │
│  │                                                                        │ │
│  │  ──────────────────────────────────────────────────────────────────   │ │
│  │  Pickup          │  Merchant Name                                     │ │
│  │  Deliver to      │  Customer Address (first part)                     │ │
│  │  Earnings        │  $X.XX (green, delivery_fee + tip)                 │ │
│  │  ──────────────────────────────────────────────────────────────────   │ │
│  │                                                                        │ │
│  │  [═══════════════════════════░░░░░░░░░░░] ← Progress bar (time left)  │ │
│  │                                                                        │ │
│  │  ┌─────────────────┐    ┌─────────────────┐                           │ │
│  │  │     Decline     │    │     Accept      │                           │ │
│  │  │  (gray border)  │    │  (green bg)     │                           │ │
│  │  └─────────────────┘    └─────────────────┘                           │ │
│  │                                                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  Accessibility:                                                              │
│  - role="dialog", aria-modal="true"                                          │
│  - aria-labelledby="offer-title"                                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3. Custom Hook for Driver Dashboard

**useDriverDashboard Hook - State & Actions:**

| State | Type | Description |
|-------|------|-------------|
| isOnline | boolean | Driver's availability status |
| stats | DriverStats | Today's earnings, deliveries, rating |
| activeOrders | Order[] | Currently assigned deliveries |
| currentOffer | Order | Pending offer (30s countdown) |
| offerTimeRemaining | number | Seconds left to respond |
| isLoading | boolean | API operation in progress |
| error | string | Last error message |

**Hook Lifecycle:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    useDriverDashboard LIFECYCLE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. MOUNT → Fetch Initial Data (parallel)                                   │
│     ├─► GET /driver/status → setIsOnline                                    │
│     ├─► GET /driver/stats  → setStats                                       │
│     └─► GET /driver/orders → setActiveOrders                                │
│                                                                              │
│  2. WHEN isOnline CHANGES                                                    │
│     ┌────────────────────────────────────────────────────────────────────┐  │
│     │ IF isOnline:                                                       │  │
│     │   ├─► wsService.connect()                                          │  │
│     │   ├─► wsService.on('new_offer', handler)                           │  │
│     │   │     └─► setCurrentOffer, start 30s countdown timer             │  │
│     │   ├─► wsService.on('order_update', handler)                        │  │
│     │   │     └─► update order status in activeOrders                    │  │
│     │   └─► startWatching() (geolocation)                                │  │
│     │                                                                    │  │
│     │ IF !isOnline:                                                      │  │
│     │   ├─► wsService.disconnect()                                       │  │
│     │   └─► stopWatching()                                               │  │
│     └────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  3. WHEN position CHANGES (while online)                                    │
│     ├─► POST /driver/location (every 3s interval)                          │
│     └─► wsService.send('location_update', position)                         │
│                                                                              │
│  4. ACTIONS                                                                  │
│     ├─► toggleOnlineStatus() → POST /driver/go-online or go-offline        │
│     ├─► acceptOffer()        → POST /driver/offers/:id/accept              │
│     │                          Add to activeOrders, clear offer            │
│     ├─► declineOffer()       → POST /driver/offers/:id/reject              │
│     └─► updateOrderStatus()  → POST /driver/orders/:id/:status             │
│                                If delivered: remove from activeOrders,      │
│                                refresh stats                                 │
│                                                                              │
│  5. UNMOUNT                                                                  │
│     ├─► wsService.disconnect()                                              │
│     ├─► clearInterval(offerTimer)                                           │
│     └─► stopWatching()                                                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4. Zustand State Management

**Auth Store:**
- State: `user`, `token`, `isAuthenticated`
- Actions: `login(email, password)`, `logout()`, `setUser(user, token)`
- Persistence: localStorage via zustand/middleware/persist (user + token only)

**Cart Store (with Persistence):**

| State/Action | Description |
|--------------|-------------|
| merchantId | Current merchant (clear cart on switch) |
| merchantName | Display name |
| items[] | CartItem with id, menuItemId, name, price, quantity |
| addItem(item) | Generate UUID, append to items |
| removeItem(id) | Filter out item |
| updateQuantity(id, qty) | Update or remove if qty <= 0 |
| clearCart() | Reset to empty state |
| setMerchant(id, name) | Clear cart if different merchant |
| total() | Computed: sum of price * quantity |
| itemCount() | Computed: sum of quantities |

**Location Store:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         LOCATION STORE                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  State:                                                                      │
│  ├─ position: { lat, lng, accuracy, heading?, speed? } | null               │
│  ├─ error: string | null                                                    │
│  ├─ isWatching: boolean                                                     │
│  └─ watchId: number | null                                                  │
│                                                                              │
│  Actions:                                                                    │
│  ├─ startWatching()                                                         │
│  │   └─► navigator.geolocation.watchPosition(...)                           │
│  │       Options: enableHighAccuracy=true, maximumAge=3000, timeout=10000   │
│  │                                                                          │
│  └─ stopWatching()                                                          │
│      └─► navigator.geolocation.clearWatch(watchId)                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5. WebSocket Service

**WebSocketService Class:**

| Method | Description |
|--------|-------------|
| connect(token?) | Open WS connection with optional auth |
| disconnect() | Close connection, clear handlers |
| send(type, data) | Send JSON message if connected |
| on(event, handler) | Register event listener |
| off(event, handler) | Remove event listener |

**Reconnection Strategy:**
- Max attempts: 5
- Delay: exponential backoff (1s, 2s, 4s, 8s, 16s)
- On close: attempt reconnect
- On open: reset attempt counter

### 6. Order Tracking Page with Real-time Updates

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ORDER TRACKING PAGE                                    │
│                        /orders/:orderId                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  MOUNT EFFECTS:                                                              │
│  1. Fetch order: GET /orders/:orderId                                       │
│  2. If order.driver_id exists:                                              │
│     ├─► wsService.connect()                                                  │
│     ├─► wsService.send('subscribe', { orderId })                            │
│     ├─► wsService.on('location_update', setDriverLocation + setEta)         │
│     └─► wsService.on('status_update', updateOrder.status)                   │
│                                                                              │
│  LAYOUT:                                                                     │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Order #XXXXXXXX                              [Status Badge]            │  │
│  │                                                                        │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │           Estimated arrival: {eta/60} min                       │  │  │
│  │  │                    (blue bg, large text)                        │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Order Progress (OrderTimeline)                                        │  │
│  │   ● Order Confirmed   ✓ (green if complete)                          │  │
│  │   ● Preparing         ✓                                               │  │
│  │   ● Picked Up         ○ (current: ring-2 ring-green-300)             │  │
│  │   ○ On the Way                                                        │  │
│  │   ○ Delivered                                                         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Your Driver (if assigned)                                             │  │
│  │   [Avatar]  Driver Name                                               │  │
│  │             Rating: 4.8 / 5.0                                         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Order Summary                                                         │  │
│  │   2x Burger               $25.98                                      │  │
│  │   1x Fries                 $4.99                                      │  │
│  │   ─────────────────────────────                                       │  │
│  │   Subtotal                $30.97                                      │  │
│  │   Delivery fee             $3.99                                      │  │
│  │   Total                   $34.96                                      │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  UNMOUNT:                                                                    │
│  ├─► wsService.send('unsubscribe', { orderId })                             │
│  └─► wsService.disconnect()                                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7. Accessibility Patterns

**Focus Management (DeliveryOfferModal):**
- Focus first interactive element on mount (accept button)
- Trap focus within modal (Tab cycles through buttons)
- Close on Escape key
- Restore focus to trigger element on close

**Screen Reader Announcements:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      useAnnounce HOOK                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Purpose: Announce dynamic content changes to screen readers                │
│                                                                              │
│  Implementation:                                                             │
│  1. Create/find #announcements div                                          │
│  2. Set role="status", aria-live="polite" or "assertive"                    │
│  3. Update textContent with message                                          │
│                                                                              │
│  Usage Example (driver dashboard):                                           │
│  wsService.on('new_offer', (offer) => {                                      │
│    announce(                                                                 │
│      `New delivery offer from ${offer.merchant.name}. ` +                   │
│      `You have 30 seconds to respond.`,                                      │
│      'assertive'  // Interrupt current speech                               │
│    );                                                                        │
│  });                                                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8. Loading and Error States

**Skeleton Loader Pattern (MerchantCard):**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SKELETON LOADER                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│   │
│  │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│   │
│  │░░░░░░░░░░░░░░░░░░░░░░░░ (h-40 bg-gray-200) ░░░░░░░░░░░░░░░░░░░░░░░░│   │
│  │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] (h-5 w-3/4 - title)    │   │
│  │                                                                      │   │
│  │ [░░░░░░░░░░░░░░░░░░░░░░░░░░░] (h-4 w-1/2 - category)                │   │
│  │                                                                      │   │
│  │ [░░░░░░░░░] [░░░░░░░░░░░░] (h-4 - rating & time)                    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  CSS: animate-pulse for shimmer effect                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Error Boundary with Retry:**
- Catches rendering errors via getDerivedStateFromError
- Displays error message with icon
- "Try Again" button resets state
- Optional fallback prop for custom UI

## Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| State management | Zustand | Redux / Context | Minimal boilerplate, built-in persistence |
| Routing | Tanstack Router | React Router | File-based routing, type-safe params |
| WebSocket | Native WebSocket | Socket.io | Lower overhead, sufficient for use case |
| Component styling | Tailwind CSS | CSS Modules | Rapid prototyping, consistent design system |
| Location tracking | Geolocation API | Map SDK built-in | No external dependency, privacy control |
| Real-time updates | Push via WebSocket | Polling | Lower latency, reduced server load |

## Future Enhancements

1. **Map visualization**: Integrate Mapbox/Google Maps for driver tracking with route display
2. **Offline mode**: Service worker for cart persistence and order queue when offline
3. **Performance optimization**: Virtual list for long order histories, lazy-loaded images
4. **Push notifications**: Web Push API for order updates when app is in background
5. **PWA**: Add to home screen, splash screen, offline indicators
6. **E2E testing**: Playwright tests for critical user flows
