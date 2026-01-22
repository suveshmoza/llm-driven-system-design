# Etsy - System Design Answer (Full-Stack Focus)

## 45-minute system design interview format - Full-Stack Engineer Position

---

## Opening Statement (2 minutes)

"Today I'll design a handmade and vintage marketplace like Etsy from a full-stack perspective. The key challenges span both frontend and backend: implementing multi-seller cart and checkout with proper transaction handling, building a search interface for non-standardized products that connects to Elasticsearch, handling one-of-a-kind inventory with real-time availability feedback, and creating personalized browsing experiences. I'll focus on the integration points between the React frontend and Express backend, ensuring data flows correctly for the unique multi-seller model."

---

## Step 1: Requirements Clarification (3 minutes)

### Functional Requirements

1. **Shop Management**: Sellers create shops with branding and list products
2. **Product Search**: Find products across varied terminology with filters
3. **Multi-Seller Cart**: Cart with items from multiple shops, checkout creates per-seller orders
4. **Favorites**: Save products and shops for later
5. **Personalization**: Recommendations based on browsing and favorites

### Non-Functional Requirements

- **Availability**: 99.9% for checkout flow
- **Latency**: < 200ms for search, < 100ms for cart operations
- **Consistency**: Strong consistency for inventory, eventual for search
- **Performance**: FCP < 1.5s, responsive UI for cart updates

### Full-Stack Integration Points

| Feature | Frontend Concern | Backend Concern | Integration |
|---------|------------------|-----------------|-------------|
| Multi-seller cart | Shop grouping UI | Transaction safety | Cart API with shop metadata |
| Search | Filters, facets, typeahead | Elasticsearch queries | Search API with aggregations |
| Checkout | Multi-order confirmation | Atomic order creation | Idempotent checkout endpoint |
| Inventory | "Only 1 left" messaging | Reservation system | Real-time availability checks |

---

## Step 2: System Architecture (6 minutes)

### Full-Stack Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    React Frontend (Vite)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Cart Store   │  │ Search Page  │  │ Product Page           │ │
│  │ (Zustand)    │  │ w/ Filters   │  │ w/ Add to Cart         │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Express Backend                              │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Cart Routes  │  │Search Routes │  │ Checkout Routes        │ │
│  │ /api/cart    │  │ /api/search  │  │ /api/checkout          │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
│         │                  │                     │              │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Cart Service │  │Search Service│  │ Order Service          │ │
│  │ (grouped)    │  │ (ES client)  │  │ (transactions)         │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
         │                  │                     │
         ▼                  ▼                     ▼
┌─────────────────┐ ┌──────────────┐ ┌────────────────────────────┐
│   PostgreSQL    │ │Elasticsearch │ │         Redis              │
│   - shops       │ │ - products   │ │ - sessions                 │
│   - products    │ │ - synonyms   │ │ - cart cache               │
│   - orders      │ │              │ │ - idempotency keys         │
│   - cart_items  │ │              │ │                            │
└─────────────────┘ └──────────────┘ └────────────────────────────┘
```

### Data Flow for Key Operations

**Search Flow:**
```
User types query → SearchBar (debounce 300ms)
    → GET /api/search?q=handmade+leather&category=jewelry
    → searchService.searchProducts(query, filters)
    → Elasticsearch with synonym analyzer
    → Return products + aggregations
    → Display ProductGrid + facets
```

**Add to Cart Flow:**
```
User clicks "Add to Cart" → addToCart(product)
    → POST /api/cart/items { productId, quantity }
    → Validate inventory (product.quantity >= requested)
    → Insert cart_items with shop_id
    → Invalidate cart cache
    → Return updated cart grouped by shop
    → Update CartStore (Zustand)
```

---

## Step 3: Multi-Seller Cart & Checkout (10 minutes)

### Backend: Cart API with Shop Grouping

The cart API groups items by shop to support multi-seller checkout:

```
┌─────────────────────────────────────────────────────────────┐
│                    GET /api/cart                            │
├─────────────────────────────────────────────────────────────┤
│  1. Check cache (key: cart:{userId})                        │
│  2. If miss, query cart_items JOIN products JOIN shops      │
│  3. Group items by shop_id in memory                        │
│  4. Calculate subtotal per shop                             │
│  5. Cache result for 5 minutes                              │
│  6. Return { shops: [...], itemTotal, itemCount }           │
└─────────────────────────────────────────────────────────────┘
```

**Cart Response Structure:**
```
{
  shops: [
    {
      shopId: "abc",
      shopName: "Vintage Finds",
      shippingPolicy: "...",
      items: [
        { cartItemId, productId, title, price, quantity, availableQuantity, image }
      ],
      subtotal: 45.00
    },
    { ... more shops ... }
  ],
  itemTotal: 125.00,
  itemCount: 4
}
```

**Add to Cart Logic:**
- POST /api/cart/items { productId, quantity }
- Validates inventory before adding (product.quantity >= requested)
- Uses UPSERT with LEAST() to cap at available quantity
- Invalidates cart cache on success
- Returns updated grouped cart

### Frontend: Cart Store with Shop Grouping

**Zustand Store Structure:**

```
┌─────────────────────────────────────────────────────────────┐
│                    useCartStore                             │
├─────────────────────────────────────────────────────────────┤
│  State:                                                     │
│  ├── shops: CartShopGroup[]                                 │
│  ├── itemTotal: number                                      │
│  ├── itemCount: number                                      │
│  ├── isLoading: boolean                                     │
│  └── error: string | null                                   │
├─────────────────────────────────────────────────────────────┤
│  Actions:                                                   │
│  ├── fetchCart(): Promise<void>                             │
│  ├── addItem(productId, quantity?): Promise<void>           │
│  ├── updateQuantity(productId, quantity): Promise<void>     │
│  ├── removeItem(productId): Promise<void>                   │
│  └── clearCart(): void                                      │
├─────────────────────────────────────────────────────────────┤
│  Persistence: zustand/persist middleware                    │
│  Storage key: "etsy-cart"                                   │
└─────────────────────────────────────────────────────────────┘
```

**Error Handling in addItem:**
- Catches availability errors from backend
- Throws user-friendly message: "Only {available} available"
- Allows UI to display inventory feedback

### Backend: Checkout with Transaction

The checkout process uses a single database transaction to ensure atomicity:

```
┌─────────────────────────────────────────────────────────────┐
│              POST /api/checkout (Transaction)               │
├─────────────────────────────────────────────────────────────┤
│  1. BEGIN transaction                                       │
│  2. Lock cart items + products (SELECT ... FOR UPDATE OF p) │
│  3. Validate all items have sufficient inventory            │
│     └── If any unavailable, ROLLBACK + return error list    │
│  4. Group cart items by shop                                │
│  5. For each shop:                                          │
│     ├── Create order (status: 'pending')                    │
│     ├── Create order_items                                  │
│     ├── Decrement product.quantity                          │
│     └── Increment shop.sales_count                          │
│  6. Delete cart_items for user                              │
│  7. COMMIT                                                  │
│  8. Process payment (outside transaction - can retry)       │
│  9. Notify sellers (async - don't block response)           │
│  10. Invalidate cart cache                                  │
│  11. Return { success, orders[], totalPaid }                │
└─────────────────────────────────────────────────────────────┘
```

**Idempotency Middleware:**
- 24-hour TTL for idempotency keys
- Stored in Redis with key from Idempotency-Key header
- Prevents double-charges on network retries

**Error Response for Unavailable Items:**
```
{
  error: "Some items are no longer available",
  unavailableItems: [
    { productId, title, requested: 2, available: 0 }
  ]
}
```

### Frontend: Checkout Flow

**Checkout Page Layout:**

```
┌─────────────────────────────────────────────────────────────┐
│                        Checkout                             │
├─────────────────────────────────────────────────────────────┤
│  [Error Banner - if inventory issues]                       │
│                                                             │
│  Your order will be shipped from N shops                    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Shop: Vintage Finds                                 │    │
│  │ ┌────┐ Product Title          Qty: 1    $25.00      │    │
│  │ │img │ ...                                          │    │
│  │ └────┘                                              │    │
│  │                              Subtotal: $25.00       │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Shipping Address Form                               │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Payment Section                                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Total: $125.00                                             │
│  + shipping calculated per shop                             │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │            [Place order]                            │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**Idempotency Key Generation:**
- Created on component mount using `crypto.randomUUID()`
- Format: `checkout:{timestamp}:{uuid}`
- Sent in request header for retry safety

**Success Flow:**
- Clears local cart via `clearCart()`
- Navigates to /orders/confirmation with order IDs in query string

---

## Step 4: Search Integration (8 minutes)

### Backend: Search Service with Elasticsearch

**Elasticsearch Query Structure:**

```
┌─────────────────────────────────────────────────────────────┐
│              searchProducts(query, filters)                 │
├─────────────────────────────────────────────────────────────┤
│  Query: function_score                                      │
│  ├── bool query                                             │
│  │   ├── must: multi_match on title^3, description, tags^2  │
│  │   │         fuzziness: AUTO, prefix_length: 2            │
│  │   └── filter:                                            │
│  │       ├── term: category (if provided)                   │
│  │       ├── range: price gte/lte (if provided)             │
│  │       ├── term: is_vintage (if provided)                 │
│  │       └── range: quantity > 0 (always - in-stock only)   │
│  └── functions (scoring boosts):                            │
│      ├── field_value_factor: shop_rating (sqrt, factor 1.5) │
│      └── field_value_factor: shop_sales_count (log1p, 1.2)  │
├─────────────────────────────────────────────────────────────┤
│  Aggregations:                                              │
│  ├── categories: terms (size: 20)                           │
│  └── price_ranges: range buckets                            │
│      ├── Under $25                                          │
│      ├── $25 to $50                                         │
│      ├── $50 to $100                                        │
│      └── Over $100                                          │
└─────────────────────────────────────────────────────────────┘
```

**Search Response:**
```
{
  products: [{ id, score, title, price, image, ... }],
  total: 1234,
  facets: {
    categories: [{ key: "jewelry", doc_count: 150 }, ...],
    priceRanges: [{ key: "Under $25", doc_count: 300 }, ...]
  }
}
```

### Backend: Search Route

- GET /api/search with query params: q, category, minPrice, maxPrice, isVintage, page
- Cache key based on all parameters (JSON stringified)
- 2-minute TTL for search results
- Returns products + aggregations for faceted navigation

### Frontend: Search Page with Filters

**Search Page Layout:**

```
┌─────────────────────────────────────────────────────────────┐
│  Filters Sidebar (w-64)   │   Results (flex-1)              │
├───────────────────────────┼─────────────────────────────────┤
│                           │                                 │
│  Category                 │  1,234 results for "leather"    │
│  ○ Jewelry (150)          │                                 │
│  ○ Home Decor (89)        │  ┌────┐ ┌────┐ ┌────┐ ┌────┐    │
│  ○ Clothing (234)         │  │prod│ │prod│ │prod│ │prod│    │
│                           │  └────┘ └────┘ └────┘ └────┘    │
│  Price                    │  ┌────┐ ┌────┐ ┌────┐ ┌────┐    │
│  ○ Under $25 (300)        │  │prod│ │prod│ │prod│ │prod│    │
│  ○ $25 to $50 (450)       │  └────┘ └────┘ └────┘ └────┘    │
│  ○ $50 to $100 (280)      │                                 │
│  ○ Over $100 (204)        │                                 │
│                           │                                 │
│  Options                  │                                 │
│  ☐ Vintage items only     │                                 │
│                           │                                 │
└───────────────────────────┴─────────────────────────────────┘
```

**URL-Driven Filters:**
- TanStack Router's `validateSearch` parses query params
- `updateFilter()` navigates with updated search params
- React Query fetches based on search params
- Facet counts from backend aggregations

---

## Step 5: Inventory & Real-Time Availability (6 minutes)

### Backend: Inventory Check on Add to Cart

**Enhanced Add to Cart with Locking:**

```
┌─────────────────────────────────────────────────────────────┐
│         POST /api/cart/items (with FOR UPDATE)              │
├─────────────────────────────────────────────────────────────┤
│  1. Lock product row (SELECT ... FOR UPDATE)                │
│  2. Get current cart quantity for this product              │
│  3. Calculate: totalRequested = currentInCart + quantity    │
│  4. If product.quantity < totalRequested:                   │
│     └── Return 400 with { available, inCart }               │
│  5. UPSERT cart_item                                        │
│  6. COMMIT, invalidate cache, return cart                   │
└─────────────────────────────────────────────────────────────┘
```

**Availability Endpoint:**
- GET /api/products/:id/availability
- Returns: { available, inCart, canAddMore }
- Allows real-time checks without adding to cart

### Frontend: Add to Cart with Availability Feedback

**AddToCartButton States:**

```
┌─────────────────────────────────────────────────────────────┐
│  State: Sold Out (quantity === 0)                           │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Sold out                 (disabled)    │    │
│  └─────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│  State: Already in Cart + Unique Item (quantity === 1)      │
│  ┌─────────────────────────────────────────────────────┐    │
│  │            View in cart                 (link)      │    │
│  └─────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│  State: In Cart + Multiple Available                        │
│  ┌─────────────────────────────────────────────────────┐    │
│  │            Add another                              │    │
│  └─────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│  State: Not in Cart                                         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │            Add to cart                              │    │
│  └─────────────────────────────────────────────────────┘    │
│  Only 1 available - this is a one-of-a-kind item            │
└─────────────────────────────────────────────────────────────┘
```

**Error Display:**
- Shows error message below button on failure
- Handles "Only {available} available" messaging
- One-of-a-kind warning for quantity === 1 items

---

## Step 6: Favorites & Personalization (5 minutes)

### Backend: Favorites API

**Polymorphic Favorites:**
- favorites table with: user_id, favoritable_type, favoritable_id
- Types: 'product' or 'shop'
- GET /api/favorites returns both products and shops

**API Endpoints:**
- GET /api/favorites - Returns { products, shops }
- POST /api/favorites/products/:id - Add product favorite
- DELETE /api/favorites/products/:id - Remove product favorite
- POST /api/favorites/shops/:id - Add shop favorite
- DELETE /api/favorites/shops/:id - Remove shop favorite

Uses ON CONFLICT DO NOTHING for idempotent adds.

### Backend: Personalized Feed

**Feed Generation Logic:**

```
┌─────────────────────────────────────────────────────────────┐
│                    GET /api/feed                            │
├─────────────────────────────────────────────────────────────┤
│  Anonymous User:                                            │
│  └── Return trending products only                          │
├─────────────────────────────────────────────────────────────┤
│  Cold Start (< 3 favorites AND < 5 views):                  │
│  └── Return "Popular right now" trending section            │
├─────────────────────────────────────────────────────────────┤
│  Personalized User:                                         │
│  ├── Extract top categories from favorites + views          │
│  ├── Calculate average price range                          │
│  └── Build sections:                                        │
│      ├── "Based on your favorites" (similar products)       │
│      └── "More in {category}" (for top 2 categories)        │
└─────────────────────────────────────────────────────────────┘
```

**Preference Extraction:**
- Combines favorites and recent view history (last 50)
- Extracts: top categories, average price, common tags
- Uses Elasticsearch more_like_this for similar products

---

## Step 7: Key Design Decisions & Trade-offs (3 minutes)

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Cart storage | Server-side (PostgreSQL) | Client-side only | Multi-device sync, inventory validation |
| Checkout transaction | Single DB transaction | Saga pattern | Simpler for single-DB setup |
| Search caching | 2-minute TTL | Real-time | Balance freshness vs. ES load |
| Idempotency | Redis with 24h TTL | Database table | Fast lookups, auto-expiry |
| Favorites sync | Optimistic UI + server | Server-first | Instant feedback, eventual consistency OK |

### Full-Stack Considerations

**Frontend-Backend Contract:**
- Cart API returns grouped-by-shop structure to avoid client-side grouping
- Search API returns aggregations for faceted navigation
- Error responses include actionable data (e.g., `available` quantity)

**State Synchronization:**
- Zustand persists cart locally as cache
- `fetchCart()` on app mount syncs server state
- Optimistic updates for favorites, server confirmation follows

---

## Closing Summary

I've designed a full-stack handmade marketplace with five integrated systems:

1. **Multi-Seller Cart**: Backend groups items by shop with transaction-safe checkout creating per-seller orders, frontend displays clear shop separation with shipping implications

2. **Search Integration**: Elasticsearch with synonym analyzer and fuzzy matching, frontend faceted filters driven by backend aggregations, 2-minute cache for performance

3. **Inventory Management**: Row-level locking on add-to-cart prevents overselling, real-time availability feedback in UI, graceful handling of sold-out items

4. **Checkout Flow**: Idempotent endpoint prevents double-orders, atomic transaction creates orders and decrements inventory, frontend shows multi-shop order confirmation

5. **Personalization**: Server-side preference extraction from favorites and views, cold-start fallback to trending, frontend renders sectioned feed

**Key integration patterns:**
- API returns pre-computed structures (grouped cart, aggregations)
- Optimistic UI with server confirmation for non-critical operations
- Idempotency keys generated client-side for payment-critical flows

**What would I add with more time?**
- WebSocket for real-time inventory updates
- Search suggestions API with typeahead
- Order status tracking with seller updates
- A/B testing framework for personalization algorithms
