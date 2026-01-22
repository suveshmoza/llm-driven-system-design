# DoorDash - System Design Answer (Frontend Focus)

## 45-minute system design interview format - Frontend Engineer Position

---

## Opening Statement

"Today I'll design the frontend architecture for a food delivery platform like DoorDash, which requires building three distinct client applications: a customer ordering app, a restaurant management dashboard, and a driver delivery app. The core frontend challenges are real-time location tracking on maps, live order status updates via WebSocket, responsive design across device sizes, and managing complex UI state for a three-sided marketplace."

---

## Step 1: Requirements Clarification (3 minutes)

### Frontend-Specific Requirements

1. **Customer App**: Browse restaurants, build cart, track orders in real-time
2. **Restaurant Dashboard**: Manage orders, update menu, view analytics
3. **Driver App**: Accept deliveries, navigate routes, update status
4. **Real-Time Updates**: Live order status and driver location on map
5. **Offline Capability**: Driver app must work with intermittent connectivity

### User Experience Goals

| User | Primary Device | Key UX Goals |
|------|----------------|--------------|
| Customer | Mobile (70%) / Desktop (30%) | Fast browsing, easy checkout, live tracking |
| Restaurant | Tablet (80%) / Desktop (20%) | Quick order management, clear notifications |
| Driver | Mobile (100%) | One-handed operation, turn-by-turn navigation |

---

## Step 2: Component Architecture (7 minutes)

### Customer App Component Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  Customer App Architecture                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  components/    │  │  routes/        │  │  stores/        │  │
│  │  common/        │  │  __root.tsx     │  │  authStore      │  │
│  │  restaurant/    │  │  index.tsx      │  │  cartStore      │  │
│  │  cart/          │  │  restaurant.$id │  │  orderStore     │  │
│  │  order/         │  │  checkout.tsx   │  │  locationStore  │  │
│  │  tracking/      │  │  orders/        │  │                 │  │
│  │  icons/         │  │  account.tsx    │  │                 │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  services/                                                   ││
│  │  api.ts | websocket.ts | geolocation.ts                     ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Component Groups

| Group | Components | Purpose |
|-------|------------|---------|
| common/ | Button, Input, Modal, LoadingSpinner, ErrorBoundary | Reusable UI primitives |
| restaurant/ | RestaurantCard, RestaurantList, RestaurantFilters, MenuItemCard, MenuCategoryTabs | Restaurant browsing |
| cart/ | CartDrawer, CartItem, CartSummary, QuantitySelector | Cart management |
| order/ | OrderStatus, OrderTimeline, OrderCard, OrderHistory | Order tracking |
| tracking/ | DeliveryMap, DriverMarker, ETADisplay, LiveTrackingPanel | Real-time tracking |
| icons/ | LocationIcon, CartIcon, DeliveryIcon | SVG icon components |

### Why This Structure?

**Separate by Feature Domain**: Components grouped by feature (restaurant, cart, order, tracking) makes it easy to find related code and enables code splitting per route.

**Shared Common Components**: Reusable UI primitives in `common/` ensure consistent styling and reduce duplication.

**Services Layer**: API calls, WebSocket management, and geolocation abstracted from components for testability.

---

## Step 3: Restaurant Browsing UI (8 minutes)

### Restaurant List with Virtualization

```
┌─────────────────────────────────────────────────────────────────┐
│  RestaurantList (Virtualized)                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Uses @tanstack/react-virtual for performance                   │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Visible Viewport (h-[calc(100vh-200px)])                 │  │
│  │                                                            │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  RestaurantCard (virtualItem.index)                 │  │  │
│  │  │  - Absolute positioned at translateY(start)         │  │  │
│  │  │  - Height: 180px estimated                          │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                                                            │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  RestaurantCard (next item)                         │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                                                            │  │
│  │  overscan: 3 (extra items rendered above/below)           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Restaurant Data Model

| Field | Type | Description |
|-------|------|-------------|
| id | number | Unique identifier |
| name | string | Restaurant name |
| cuisineType | string | Type of cuisine |
| rating | number | Average rating |
| prepTimeMinutes | number | Estimated prep time |
| deliveryFee | number | Delivery cost |
| distance | number | Distance from user |
| imageUrl | string | Cover image |
| isOpen | boolean | Current availability |

### RestaurantCard Component

```
┌─────────────────────────────────────────────────────────────────┐
│  RestaurantCard                                                  │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Image Section (h-40, lazy loading)                         ││
│  │  ┌─────────────────────────────────────────────────────┐   ││
│  │  │  If closed: overlay "Currently Closed"              │   ││
│  │  └─────────────────────────────────────────────────────┘   ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Content Section (p-4)                                      ││
│  │                                                              ││
│  │  [Name]                              [Star] Rating          ││
│  │  Cuisine Type                                                ││
│  │                                                              ││
│  │  [Clock] 20-30 min  [Truck] $2.99  [Location] 1.5 mi       ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Filter Bar Component

```
┌─────────────────────────────────────────────────────────────────┐
│  RestaurantFilters (sticky top-0 z-10)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Cuisine Pills (horizontal scroll on mobile)                    │
│  ┌─────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ All │ │ Italian │ │ Mexican │ │ Chinese │ │  Sushi  │ ...   │
│  └─────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘       │
│     ^                                                           │
│     └── Selected: bg-red-500 text-white                        │
│                                                                  │
│  Sort by: [Top Rated ▼]                                        │
│           Options: Top Rated | Nearest | Fastest Delivery       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 4: Shopping Cart with Zustand (7 minutes)

### Cart State Structure

| State Field | Type | Purpose |
|-------------|------|---------|
| restaurantId | number or null | Current restaurant |
| restaurantName | string or null | Display name |
| items | CartItem[] | Cart contents |
| deliveryAddress | DeliveryAddress or null | Delivery location |

### CartItem Structure

| Field | Type | Description |
|-------|------|-------------|
| menuItemId | number | Menu item reference |
| name | string | Item name |
| price | number | Unit price |
| quantity | number | Quantity ordered |
| specialInstructions | string (optional) | Custom notes |

### Cart Actions

| Action | Behavior |
|--------|----------|
| addItem | If different restaurant, clear cart first. If item exists, increment quantity. Otherwise add new item. |
| removeItem | Remove item. If cart empty, reset restaurantId/name. |
| updateQuantity | Update quantity. If quantity <= 0, remove item. |
| updateInstructions | Set special instructions for item. |
| setDeliveryAddress | Set delivery location. |
| clearCart | Reset all cart state. |

### Computed Values

| Getter | Formula |
|--------|---------|
| getSubtotal | Sum of (item.price * item.quantity) |
| getItemCount | Sum of item.quantity |

### Cart Persistence

- Uses Zustand `persist` middleware
- Storage key: `doordash-cart`
- Survives browser refresh

### CartDrawer Component

```
┌─────────────────────────────────────────────────────────────────┐
│  CartDrawer (fixed inset-0 z-50)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────┐  ┌─────────────────┐  │
│  │  Backdrop (bg-black/50)             │  │  Drawer Panel   │  │
│  │  onClick: close                     │  │  (right-0 w-md) │  │
│  └─────────────────────────────────────┘  │                 │  │
│                                           │  Header:        │  │
│                                           │  Your Cart      │  │
│                                           │  [Restaurant]   │  │
│                                           │  [X Close]      │  │
│                                           │                 │  │
│                                           │  Items:         │  │
│                                           │  (overflow-auto)│  │
│                                           │  CartItem x N   │  │
│                                           │                 │  │
│                                           │  Summary:       │  │
│                                           │  Subtotal  $X   │  │
│                                           │  Delivery  $2.99│  │
│                                           │  Service   15%  │  │
│                                           │  ────────────── │  │
│                                           │  Total     $Y   │  │
│                                           │                 │  │
│                                           │  [Checkout]     │  │
│                                           └─────────────────┘  │
│                                                                  │
│  Empty State: Cart icon + "Your cart is empty"                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 5: Real-Time Order Tracking (10 minutes)

### WebSocket Service Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  WebSocketService                                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Private State:                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  ws: WebSocket | null                                       ││
│  │  handlers: Map<orderId, MessageHandler[]>                   ││
│  │  reconnectAttempts: number (max 5)                          ││
│  │  reconnectDelay: 1000ms (exponential backoff)               ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  Connection Flow:                                                │
│  ┌─────────────┐                                                │
│  │  connect()  │──> WebSocket(ws_url?token=auth)               │
│  └─────────────┘                                                │
│        │                                                         │
│        ▼                                                         │
│  ┌─────────────┐  onmessage   ┌─────────────────────┐          │
│  │  onopen     │────────────> │ Parse OrderUpdate   │          │
│  │  reset      │              │ Dispatch to handlers│          │
│  │  attempts   │              └─────────────────────┘          │
│  └─────────────┘                                                │
│        │                                                         │
│        ▼ onclose                                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  attemptReconnect()                                         ││
│  │  delay = 1000 * 2^(attempts-1)                              ││
│  │  setTimeout(connect, delay)                                 ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### OrderUpdate Message

| Field | Type | Description |
|-------|------|-------------|
| orderId | number | Order identifier |
| status | string | Current status |
| eta | string (optional) | Estimated arrival |
| driverLocation | {lat, lon} (optional) | Driver position |

### Subscription Management

```
┌─────────────────────────────────────────────────────────────────┐
│  subscribeToOrder(orderId, handler)                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Add handler to handlers Map                                 │
│  2. Send { type: 'subscribe', orderId } to server               │
│  3. Return unsubscribe function:                                │
│     - Remove handler from Map                                   │
│     - If no handlers left, send { type: 'unsubscribe' }        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Delivery Map Component

```
┌─────────────────────────────────────────────────────────────────┐
│  DeliveryMap (Mapbox GL)                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Props:                                                          │
│  - driverLocation: {lat, lon} | null                            │
│  - restaurantLocation: {lat, lon}                               │
│  - deliveryLocation: {lat, lon}                                 │
│  - orderStatus: string                                          │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Map Container (h-64 md:h-96 rounded-xl)                    ││
│  │                                                              ││
│  │     [Red Marker]                    [Blue Marker]           ││
│  │     Restaurant                      Driver (animated)       ││
│  │                                                              ││
│  │                                                              ││
│  │                          [Green Marker]                      ││
│  │                          Delivery Address                    ││
│  │                                                              ││
│  │  ┌─────────────┐                                            ││
│  │  │ Legend      │                                            ││
│  │  │ ● Restaurant│                                            ││
│  │  │ ● Your Loc  │                                            ││
│  │  │ ● Driver    │                                            ││
│  │  └─────────────┘                                            ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  Map Behavior:                                                   │
│  - Initial: fitBounds to show restaurant + delivery            │
│  - When PICKED_UP: panTo driver location                        │
│  - Driver marker animates on location update                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Order Status Timeline

```
┌─────────────────────────────────────────────────────────────────┐
│  OrderTimeline                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Status Steps:                                                   │
│                                                                  │
│   ●──── PLACED         "Order Placed"      [Receipt Icon]       │
│   │                                                              │
│   ●──── CONFIRMED      "Confirmed"         [Check Icon]         │
│   │                                                              │
│   ◉──── PREPARING      "Preparing"         [ChefHat Icon]       │
│   │     (current: animate-pulse, red bg)                        │
│   │                                                              │
│   ○──── READY_FOR_PICKUP "Ready"           [Package Icon]       │
│   │     (future: gray-200, gray-400 text)                       │
│   │                                                              │
│   ○──── PICKED_UP      "Picked Up"         [Truck Icon]         │
│   │                                                              │
│   ○──── DELIVERED      "Delivered"         [Home Icon]          │
│                                                                  │
│  ● = Complete (green-500)                                       │
│  ◉ = Current (red-500, animate-pulse)                           │
│  ○ = Pending (gray-200)                                         │
│                                                                  │
│  Each step shows timestamp when complete                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Live Tracking Page Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  OrderTrackingPage (max-w-2xl mx-auto)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  ETA Header (bg-red-500 text-white rounded-xl)              ││
│  │                                                              ││
│  │  Estimated Arrival                                          ││
│  │  8:45 PM                                                    ││
│  │  Driver is on the way                                       ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  DeliveryMap (shown for PICKED_UP, READY_FOR_PICKUP)        ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Order Status                                                ││
│  │  OrderTimeline                                               ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Order Details                                               ││
│  │  Restaurant Name                                             ││
│  │  2x Burger             $24.00                               ││
│  │  1x Fries              $5.00                                ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  [Phone Icon] Contact Driver                                ││
│  │  (shown when driver assigned)                               ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Status Messages

| Status | Message |
|--------|---------|
| PLACED | Waiting for restaurant to confirm |
| CONFIRMED | Restaurant is preparing your order |
| PREPARING | Your food is being prepared |
| READY_FOR_PICKUP | Driver is picking up your order |
| PICKED_UP | Driver is on the way |
| DELIVERED | Order delivered! |

---

## Step 6: Driver App UI (5 minutes)

### Order Card (Mobile-Optimized)

```
┌─────────────────────────────────────────────────────────────────┐
│  DriverOrderCard (fixed bottom-0 animate-slide-up)              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Timer Bar (countdown progress)                             ││
│  │  ████████████░░░░░░░░░░░░ 15s remaining                    ││
│  │  Auto-decline when timer expires                            ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Earnings (text-3xl text-green-600)                         ││
│  │           $8.50                                             ││
│  │        3.2 mi total                                         ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Route Summary                                               ││
│  │                                                              ││
│  │  [●] Pickup                                                 ││
│  │      Restaurant Name                                        ││
│  │      123 Main St                                            ││
│  │      1.2 mi away                                            ││
│  │                                                              ││
│  │  [●] Dropoff                                                ││
│  │      Customer                                               ││
│  │      456 Oak Ave                                            ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Action Buttons (py-4 text-lg for thumb tap)                ││
│  │                                                              ││
│  │  ┌─────────────────┐  ┌─────────────────┐                  ││
│  │  │     Decline     │  │     Accept      │                  ││
│  │  │  (border-gray)  │  │  (bg-green-500) │                  ││
│  │  └─────────────────┘  └─────────────────┘                  ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Timer Logic

1. Initialize countdown from `expiresIn` seconds
2. Decrement every second via setInterval
3. When timer reaches 0:
   - Clear interval
   - Auto-call onDecline()
4. Progress bar width: `(timeLeft / expiresIn) * 100%`

---

## Step 7: Responsive Design Patterns (3 minutes)

### Breakpoints

| Breakpoint | Width | Use Case |
|------------|-------|----------|
| sm | 640px | Mobile landscape |
| md | 768px | Tablet |
| lg | 1024px | Desktop |
| xl | 1280px | Large desktop |

### Responsive Grid

```
Restaurant Grid Layout:

Mobile (< 640px):    1 column   grid-cols-1
Mobile Landscape:    2 columns  sm:grid-cols-2
Tablet:              2 columns  sm:grid-cols-2
Desktop:             3 columns  lg:grid-cols-3
Large Desktop:       4 columns  xl:grid-cols-4
```

### Bottom Navigation (Mobile Only)

```
┌─────────────────────────────────────────────────────────────────┐
│  BottomNav (fixed bottom-0 md:hidden z-40)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┬──────────┬──────────┬──────────┐                 │
│  │   Home   │  Search  │  Orders  │ Account  │                 │
│  │  [Icon]  │  [Icon]  │  [Icon]  │  [Icon]  │                 │
│  └──────────┴──────────┴──────────┴──────────┘                 │
│                                                                  │
│  Active state: text-red-500                                     │
│  Inactive: text-gray-500                                        │
│  Hidden on md+ screens (desktop uses top nav)                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 8: Accessibility Considerations (2 minutes)

### WCAG 2.1 AA Compliance

**Cart Button with Live Region:**

| Attribute | Value | Purpose |
|-----------|-------|---------|
| aria-label | "Shopping cart with N items" | Screen reader description |
| aria-live | "polite" | Announce count changes |

**Order Status Announcements:**

| Element | Attribute | Purpose |
|---------|-----------|---------|
| status container | role="status" | Identifies as status |
| status container | aria-live="polite" | Announces updates |
| visually hidden | class="sr-only" | Only for screen readers |

### Focus and Color

| Concern | Solution |
|---------|----------|
| Keyboard navigation | focus-visible:focus with 2px blue outline |
| Color contrast | text-gray-500 (#6B7280) passes 4.5:1 on white |
| Brand color | text-red-500 (#EF4444) passes on white |

---

## Closing Summary

I've designed the frontend architecture for a food delivery platform with:

1. **Customer App**: Restaurant browsing with virtualized lists, cart management with Zustand persistence, and real-time order tracking with WebSocket and Mapbox integration

2. **Component Architecture**: Feature-based organization (restaurant, cart, order, tracking) with shared common components and a services layer for API/WebSocket abstraction

3. **Real-Time Tracking**: WebSocket service with automatic reconnection, live driver location updates on map, and animated status timeline

4. **Driver App**: Mobile-optimized UI with large touch targets, countdown timer for order acceptance, and one-handed operation design

5. **State Management**: Zustand stores for cart (with local storage persistence) and order tracking, with WebSocket updates flowing into React state

### Key Frontend Trade-offs

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Map Library | Mapbox | Google Maps | Better developer experience, competitive pricing |
| State Management | Zustand | Redux | Simpler API for this scale of state management |
| List Rendering | TanStack Virtual | Native scroll | Performance with large datasets |
| Real-Time | WebSocket | Polling | Lower latency, more efficient for frequent updates |
| Styling | Tailwind CSS | CSS Modules | Rapid development, utility-first approach |
