# Amazon E-Commerce - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Opening Statement

"Today I'll design the frontend architecture for an e-commerce platform like Amazon. The key frontend challenges are building a performant product browsing experience with faceted search, implementing a real-time shopping cart with inventory feedback, creating a seamless checkout flow, and displaying personalized recommendations. I'll focus on component architecture, state management patterns, and optimizing the critical rendering path for conversion."

---

## Requirements Clarification

### Functional Requirements

1. **Product Browsing**: Category navigation, search with filters, product detail pages
2. **Shopping Cart**: Add/remove items, quantity updates, inventory warnings
3. **Checkout Flow**: Multi-step checkout with address, payment, confirmation
4. **Order History**: View past orders and order status
5. **Recommendations**: Display "customers also bought" and personalized suggestions

### Non-Functional Requirements

- **Performance**: LCP < 2.5s for product pages, FID < 100ms
- **Responsiveness**: Full mobile support (60%+ of e-commerce traffic)
- **Accessibility**: WCAG 2.1 AA compliance
- **Offline Support**: Cart persistence, cached product data
- **Conversion Optimization**: Minimize checkout friction

### Scale Considerations

| Metric | Target |
|--------|--------|
| Product Pages | 100M+ (static generation not feasible) |
| Concurrent Users | 500K |
| Cart Updates | Real-time feedback |
| Search Results | < 200ms perceived latency |

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    React Application                             │
├─────────────────────────────────────────────────────────────────┤
│  TanStack Router (file-based routing)                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────────┐ │
│  │   Layout    │ │   Product   │ │    Cart     │ │  Checkout  │ │
│  │   Shell     │ │   Catalog   │ │   Drawer    │ │    Flow    │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └────────────┘ │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  State Management (Zustand)                                      │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │  cartStore  │ │ searchStore │ │  userStore  │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
├─────────────────────────────────────────────────────────────────┤
│  Data Layer                                                      │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  TanStack Query (caching, prefetching, optimistic updates)  ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  API Client (fetch wrapper with retry, error handling)      ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## Deep Dive 1: Product Search with Faceted Filtering

### Search Results Component

The SearchResults component uses TanStack Virtual for efficient rendering of large result sets with infinite scroll:

```
┌─────────────────────────────────────────────────────────────────┐
│  SearchResults Layout                                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────────────────────────────────┐ │
│  │   Facets     │  │  Results Header                          │ │
│  │   Sidebar    │  │  "X,XXX results for 'query'"  [Sort ▼]   │ │
│  │   (w-64)     │  ├──────────────────────────────────────────┤ │
│  │              │  │                                          │ │
│  │  Category    │  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐        │ │
│  │  ☑ Electronics│  │  │Card │ │Card │ │Card │ │Card │        │ │
│  │  ☐ Books     │  │  └─────┘ └─────┘ └─────┘ └─────┘        │ │
│  │              │  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐        │ │
│  │  Price       │  │  │Card │ │Card │ │Card │ │Card │        │ │
│  │  [====○====] │  │  └─────┘ └─────┘ └─────┘ └─────┘        │ │
│  │  $0 - $1000  │  │                                          │ │
│  │              │  │  (Virtualized - only visible rendered)   │ │
│  │  Brand       │  │                                          │ │
│  │  ☑ Apple     │  │  ┌──────────────────────────────────┐   │ │
│  │  ☐ Samsung   │  │  │  Loading more... (infinite)      │   │ │
│  │              │  │  └──────────────────────────────────┘   │ │
│  │  Rating      │  │                                          │ │
│  │  ★★★★☆ & up  │  └──────────────────────────────────────────┘ │
│  │              │                                               │
│  │  Availability│                                               │
│  │  ☑ In Stock  │                                               │
│  │              │                                               │
│  │  [Clear All] │                                               │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
```

**SearchFilters Interface:**
- query: Search text
- category: Selected category filter
- priceMin/priceMax: Price range bounds
- brands: Array of selected brand filters
- rating: Minimum star rating
- inStock: Boolean availability filter

**Implementation Details:**
- Uses `useSearchParams` from TanStack Router to sync filters with URL
- `useSearchProducts` hook returns paginated data with `useInfiniteQuery`
- `useVirtualizer` with 280px estimated row height and overscan of 5
- Infinite scroll triggers `fetchNextPage` when last virtual item is visible
- Loading state shows `SearchResultsSkeleton`

### Facets Sidebar

The FacetsSidebar component displays filter options with counts:

**Category Facet:** List of checkboxes with document counts, single-select behavior

**Price Range Facet:**
- Slider component for continuous range selection (0-1000)
- Quick-select buttons for predefined ranges with counts

**Brand Facet:** Multi-select checkboxes, limited to top 10 brands

**Rating Filter:** Star rating buttons (4, 3, 2, 1) with "& up" label

**Availability Filter:** Single checkbox for "In Stock Only"

**Clear Filters:** Shown when any filters are active, resets all to defaults

**Filter Change Handler:** Updates URL search params - sets value for single, appends for arrays, deletes for null

---

## Deep Dive 2: Shopping Cart with Real-Time Inventory

### Cart Store (Zustand)

```
┌─────────────────────────────────────────────────────────────────┐
│  CartStore State                                                 │
├─────────────────────────────────────────────────────────────────┤
│  State                                                           │
│  ├─ items: CartItem[]                                           │
│  │   └─ productId, title, price, quantity, image                │
│  │   └─ maxQuantity, reservedUntil                              │
│  ├─ isOpen: boolean                                             │
│  ├─ isLoading: boolean                                          │
│  └─ error: string | null                                        │
├─────────────────────────────────────────────────────────────────┤
│  Actions                                                         │
│  ├─ openCart() / closeCart()                                    │
│  ├─ addItem(product, quantity) → POST /api/cart/items           │
│  │   └─ Handles INSUFFICIENT_INVENTORY error                    │
│  ├─ updateQuantity(productId, qty) → PATCH with optimistic      │
│  │   └─ Rollback on failure                                     │
│  ├─ removeItem(productId) → DELETE with optimistic              │
│  ├─ clearCart()                                                 │
│  └─ syncWithServer() → GET /api/cart                            │
├─────────────────────────────────────────────────────────────────┤
│  Computed                                                        │
│  ├─ totalItems() → sum of quantities                            │
│  ├─ subtotal() → sum of price × quantity                        │
│  └─ hasExpiredReservations() → any reservedUntil < now          │
├─────────────────────────────────────────────────────────────────┤
│  Persistence                                                     │
│  └─ localStorage 'amazon-cart' with partialize (items only)     │
└─────────────────────────────────────────────────────────────────┘
```

**AddItem Flow:**
1. Set loading state, clear error
2. POST to /api/cart/items with productId and quantity
3. Handle INSUFFICIENT_INVENTORY error with available count message
4. On success: Update items array (add new or increment existing)
5. Store reservation expiry timestamp
6. Open cart drawer

**Optimistic Update Pattern:**
1. Store previous state
2. Apply optimistic update immediately
3. Make API request
4. On failure: Rollback to previous state and set error

### Cart Drawer Component

```
┌─────────────────────────────────────────────────────────────────┐
│  Cart Drawer (Sheet from right, max-w-lg)                        │
├─────────────────────────────────────────────────────────────────┤
│  Shopping Cart (X)                               [×]            │
├─────────────────────────────────────────────────────────────────┤
│  ⚠ Reservation Warning (if expired items)                       │
│  "Some items may no longer be reserved..."                       │
├─────────────────────────────────────────────────────────────────┤
│  Cart Items List (scrollable)                                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  ┌──────┐  Product Title (line-clamp-2)                    │ │
│  │  │ img  │  $XX.XX                                          │ │
│  │  └──────┘  ⚠ Only X left (if low stock)                    │ │
│  │            ⚠ Reservation expired (if expired)              │ │
│  │            [- 1 +]  Remove                                 │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │  ... more items ...                                        │ │
│  └────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  Subtotal                                      $XXX.XX          │
│  Shipping and taxes calculated at checkout                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │         Proceed to Checkout                                │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**CartItemRow Features:**
- Low stock indicator: Shows "Only X left" when maxQuantity <= 3
- Expired indicator: Dims item and shows "Reservation expired" message
- QuantitySelector: Disabled when reservation expired
- Remove button: Triggers optimistic removal

**Empty Cart State:**
- Shopping bag icon
- "Your cart is empty" message
- "Continue Shopping" link to close drawer

---

## Deep Dive 3: Product Detail Page

### Product Page Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Breadcrumbs: Home > Category > Subcategory                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│  │  Thumbnails  Main    │  │  Product Title                   │ │
│  │  ┌──┐      ┌──────┐  │  │  ★★★★☆ (X,XXX reviews)           │ │
│  │  │01│      │      │  │  │                                  │ │
│  │  └──┘      │      │  │  │  $̶X̶X̶.̶X̶X̶ (if compare price)      │ │
│  │  ┌──┐      │ ZOOM │  │  │  $XX.XX                          │ │
│  │  │02│      │      │  │  │                                  │ │
│  │  └──┘      │      │  │  │  ✓ In Stock / ✗ Out of Stock    │ │
│  │  ┌──┐      │      │  │  │  ⚠ Only X left (if low)         │ │
│  │  │03│      └──────┘  │  │                                  │ │
│  │  └──┘                │  │  [- 1 +]  [ Add to Cart ]        │ │
│  └──────────────────────┘  │                                  │ │
│                            │  Product Details                 │ │
│                            │  Brand: Apple                    │ │
│                            │  Model: iPhone 15                │ │
│                            │  Color: Black                    │ │
│                            └──────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  About this item                                                 │
│  Product description HTML content...                             │
├─────────────────────────────────────────────────────────────────┤
│  Customers also bought                                           │
│  ◄ [ Product Carousel with recommendation cards ] ►             │
├─────────────────────────────────────────────────────────────────┤
│  Reviews Section                                                 │
│  ProductReviews component                                        │
└─────────────────────────────────────────────────────────────────┘
```

**Data Loading:**
- Primary query: `['product', productId]` fetches product details
- Secondary query: `['recommendations', productId]` enabled when product loaded

**Add to Cart Handler:**
1. Set adding state to true
2. Call cartStore.addItem with product and selectedQuantity
3. Show toast error on failure
4. Reset adding state

**Availability States:**
- In Stock: Green checkmark with "In Stock"
- Low Stock: Green checkmark with "Only X left" (quantity <= 5)
- Out of Stock: Red X with "Out of Stock", quantity selector hidden

### Image Gallery with Zoom

**Layout:** Vertical thumbnail strip (64x64px) on left, main image (aspect-square) on right

**Thumbnail Selection:** Click to select, blue border indicates active

**Zoom Behavior:**
- Mouse enter: Enable zoom mode
- Mouse move: Calculate position as percentage of container
- Transform: Scale 1.5x with transform-origin at cursor position
- Mouse leave: Disable zoom, reset transform

---

## Deep Dive 4: Checkout Flow

### Multi-Step Checkout

```
┌─────────────────────────────────────────────────────────────────┐
│  Checkout Progress                                               │
│  ● Shipping ─────○ Payment ─────○ Review                        │
│    (active)       (pending)      (pending)                       │
├─────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────┐  ┌────────────────────┐ │
│  │  Step Content (lg:col-span-2)      │  │  Order Summary     │ │
│  │                                    │  │                    │ │
│  │  [ShippingStep]                    │  │  Item 1    $XX.XX  │ │
│  │  or                                │  │  Item 2    $XX.XX  │ │
│  │  [PaymentStep]                     │  │  ──────────────    │ │
│  │  or                                │  │  Subtotal  $XX.XX  │ │
│  │  [ReviewStep]                      │  │  Shipping  $X.XX   │ │
│  │                                    │  │  ──────────────    │ │
│  │                                    │  │  Total     $XX.XX  │ │
│  └────────────────────────────────────┘  └────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Step State Machine:**
- shipping → payment (on address completion)
- payment → review (on payment method selection)
- review → confirmation page (on order placement)

**State Management:**
- step: Current checkout step
- shippingAddress: Completed address or null
- paymentMethod: Selected payment or null

**Order Placement:**
- Uses `useMutation` with `createOrder` function
- On success: Clear cart, navigate to confirmation page
- On error: Show toast with error message

### Shipping Step

**Saved Addresses Section:**
- Query for user's saved addresses
- Display as clickable cards with name and formatted address
- Click fills form and completes step

**Address Form Schema (Zod):**
- fullName: Required, min 1 char
- addressLine1: Required
- addressLine2: Optional
- city: Required
- state: Required
- zipCode: Regex pattern for 5 or 9 digit ZIP
- country: Required
- phone: Regex pattern for phone numbers

**Form Implementation:**
- Uses React Hook Form with Zod resolver
- Autocomplete attributes for browser autofill
- "Continue to Payment" button on submit

---

## Deep Dive 5: Performance Optimization

### Route Prefetching

ProductCard component prefetches product detail route on mouse hover using `router.preloadRoute()` with the product ID parameter. This ensures instant navigation when user clicks.

### Image Optimization

OptimizedImage component provides:
- **Responsive srcset**: Generates 0.5x, 1x, 1.5x, 2x variants
- **Lazy loading**: `loading="lazy"` for below-fold images
- **Priority loading**: `loading="eager"` for above-fold images
- **Blur placeholder**: Gray animated pulse until image loads
- **Decode async**: Non-blocking image decode for lazy images

### Service Worker for Offline Cart

```
┌─────────────────────────────────────────────────────────────────┐
│  Service Worker Caching Strategy                                 │
├─────────────────────────────────────────────────────────────────┤
│  Install Event                                                   │
│  └─ Cache static assets: /, /cart, /offline.html                │
├─────────────────────────────────────────────────────────────────┤
│  Fetch Event Handlers                                            │
│                                                                  │
│  /api/cart (GET)                                                 │
│  ├─ Try network first                                           │
│  └─ Fallback to cached cart or empty response when offline      │
│                                                                  │
│  /api/products/*                                                 │
│  ├─ Stale-while-revalidate strategy                             │
│  ├─ Return cached immediately if available                      │
│  └─ Update cache with network response in background            │
└─────────────────────────────────────────────────────────────────┘
```

---

## State Management Summary

> "I'm splitting state between Zustand for client-side concerns and TanStack Query for server state. This separation keeps the architecture clean and leverages each tool's strengths."

**Client State (Zustand):** Cart with localStorage persistence, auth/user preferences, recent searches, UI state (modals, drawers)

**Server State (TanStack Query):** Product queries, infinite search results, recommendations, order history, checkout mutations

---

## Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| State management | ✅ Zustand + TanStack Query | ❌ Redux | Simpler for cart, Query handles server cache |
| Routing | ✅ TanStack Router | ❌ React Router | Type-safe, file-based, better prefetching |
| Cart persistence | ✅ LocalStorage + API | ❌ Cookie | Larger capacity, works offline |
| Image loading | ✅ Lazy + blur placeholder | ❌ Eager | Better LCP for visible, saves bandwidth |
| Search virtualization | ✅ @tanstack/virtual | ❌ windowing | Better for variable heights |
| Form handling | ✅ React Hook Form + Zod | ❌ Formik | Better TypeScript, validation co-location |

---

## Future Frontend Enhancements

1. **React Server Components**: Server-render product pages for better SEO and LCP
2. **Streaming SSR**: Progressive hydration for faster TTI
3. **View Transitions API**: Smooth page transitions between products
4. **Web Push Notifications**: Order status updates, price drop alerts
5. **AR Product Preview**: 3D product visualization using WebXR
6. **Voice Search**: Web Speech API for hands-free shopping
7. **Accessibility Audit**: Full screen reader testing, keyboard navigation improvements
