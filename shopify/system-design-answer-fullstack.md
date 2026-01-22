# Shopify - System Design Answer (Fullstack Focus)

*45-minute system design interview format - Fullstack Engineer Position*

---

## 1. Problem Statement (2 minutes)

We are designing a multi-tenant e-commerce platform where merchants create branded online stores, manage products and inventory, and customers complete purchases through a secure checkout flow.

**Fullstack Scope:**
- **End-to-End Checkout Flow** - Cart to order confirmation with payment processing
- **Multi-Tenant Data Isolation** - Ensuring merchants only see their own data
- **Product Management** - CRUD operations with inventory tracking
- **Custom Domain Routing** - Resolving custom domains to the correct store

---

## 2. Requirements Clarification (3 minutes)

**Functional Requirements:**
1. Merchants create stores with custom subdomains
2. Products with variants (size, color) and inventory tracking
3. Customers browse products, add to cart, and checkout
4. Secure payment processing with Stripe
5. Order creation and confirmation

**Non-Functional Requirements:**
- **Availability:** 99.99% for checkout flow
- **Latency:** Product pages under 100ms
- **Isolation:** Complete data separation between tenants
- **Idempotency:** Double-click on checkout must not create duplicate orders

**Clarifying Questions:**
- "How do we handle payment failures?" (Rollback inventory reservation, notify customer)
- "Can customers have accounts across multiple stores?" (Yes, but orders are store-scoped)
- "How do we handle concurrent checkout for last item?" (Pessimistic locking on inventory)

---

## 3. High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Client Layer                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  React + TypeScript + Tanstack Router                                   ││
│  │  ┌───────────────────┐  ┌───────────────────┐  ┌────────────────────┐  ││
│  │  │    Storefront     │  │   Admin Dashboard │  │   Zustand Stores   │  ││
│  │  │   /store/:sub     │  │   /admin/:storeId │  │   useStorefront    │  ││
│  │  │   - Products      │  │   - ProductsTab   │  │   useAuth          │  ││
│  │  │   - Cart          │  │   - OrdersTab     │  │   useStore         │  ││
│  │  │   - Checkout      │  │   - Settings      │  │                    │  ││
│  │  └───────────────────┘  └───────────────────┘  └────────────────────┘  ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                              HTTPS / JSON API
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API Layer                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  Express.js + TypeScript                                                ││
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────────┐││
│  │  │ Tenant Context │  │   Idempotency  │  │    Route Handlers          │││
│  │  │   Middleware   │  │   Middleware   │  │                            │││
│  │  │                │  │                │  │  /api/storefront/:sub/*    │││
│  │  │ Sets store_id  │  │ Checks/stores  │  │  /api/admin/:storeId/*     │││
│  │  │ in pg session  │  │ idempotency    │  │  /api/checkout             │││
│  │  └────────────────┘  └────────────────┘  └────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
┌────────────────────────┐ ┌────────────────┐ ┌───────────────────────────┐
│      PostgreSQL        │ │   Valkey       │ │       RabbitMQ            │
│                        │ │                │ │                           │
│  stores, products,     │ │  - Sessions    │ │  - order.created          │
│  variants, orders      │ │  - Cart data   │ │  - email.send             │
│  (RLS enabled)         │ │  - Domain map  │ │  - webhook.deliver        │
└────────────────────────┘ └────────────────┘ └───────────────────────────┘
                                                          │
                                                          ▼
                                               ┌───────────────────────┐
                                               │   Background Workers  │
                                               │   - Email service     │
                                               │   - Webhook delivery  │
                                               └───────────────────────┘
```

---

## 4. Deep Dives

### Deep Dive 1: End-to-End Checkout Flow (10 minutes)

**Checkout Sequence Diagram:**

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ Customer │   │ Frontend │   │ Backend  │   │  Stripe  │   │PostgreSQL│
└────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘
     │              │              │              │              │
     │ Click        │              │              │              │
     │ Checkout     │              │              │              │
     │─────────────>│              │              │              │
     │              │              │              │              │
     │              │ POST /checkout              │              │
     │              │ + Idempotency-Key           │              │
     │              │─────────────>│              │              │
     │              │              │              │              │
     │              │              │ BEGIN SERIALIZABLE          │
     │              │              │─────────────────────────────>│
     │              │              │              │              │
     │              │              │ Check idempotency           │
     │              │              │─────────────────────────────>│
     │              │              │              │              │
     │              │              │ SELECT FOR UPDATE           │
     │              │              │ (inventory check)           │
     │              │              │─────────────────────────────>│
     │              │              │              │              │
     │              │              │ Reserve inventory           │
     │              │              │─────────────────────────────>│
     │              │              │              │              │
     │              │              │ Create PaymentIntent        │
     │              │              │─────────────>│              │
     │              │              │              │              │
     │              │              │ clientSecret │              │
     │              │              │<─────────────│              │
     │              │              │              │              │
     │              │ { clientSecret }            │              │
     │              │<─────────────│              │              │
     │              │              │              │              │
     │              │ stripe.confirmPayment()     │              │
     │              │────────────────────────────>│              │
     │              │              │              │              │
     │              │         succeeded           │              │
     │              │<────────────────────────────│              │
     │              │              │              │              │
     │              │ POST /confirm               │              │
     │              │─────────────>│              │              │
     │              │              │              │              │
     │              │              │ INSERT order │              │
     │              │              │─────────────────────────────>│
     │              │              │              │              │
     │              │              │ COMMIT       │              │
     │              │              │─────────────────────────────>│
     │              │              │              │              │
     │              │ { order }    │              │              │
     │              │<─────────────│              │              │
     │              │              │              │              │
     │ Order        │              │              │              │
     │ Success      │              │              │              │
     │<─────────────│              │              │              │
└────┴─────┘   └────┴─────┘   └────┴─────┘   └────┴─────┘   └────┴─────┘
```

**Frontend Checkout Flow:**

The frontend generates an idempotency key once per checkout attempt, sends a POST to `/api/storefront/{subdomain}/checkout` with the cart session ID and shipping details. The backend returns a Stripe `clientSecret`. The frontend then calls `stripe.confirmPayment()` and on success calls `/api/storefront/{subdomain}/checkout/{orderId}/confirm`.

**Backend Checkout Logic:**
1. Look up store by subdomain, set tenant context for RLS
2. Begin SERIALIZABLE transaction
3. Check idempotency table for duplicate request
4. Get cart from Valkey (Redis)
5. Lock inventory rows with SELECT FOR UPDATE
6. Reserve inventory by decrementing available, incrementing reserved
7. Create Stripe PaymentIntent with store's Connect account
8. Insert pending order and order items
9. Commit transaction, return clientSecret

**Order Confirmation Logic:**
1. Verify PaymentIntent status with Stripe
2. Update order status to 'confirmed'
3. Commit reserved inventory (reduce reserved count)
4. Publish order.created event to RabbitMQ
5. Clear cart from Valkey

---

### Deep Dive 2: Multi-Tenant Data Isolation (8 minutes)

**Row-Level Security Schema:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PostgreSQL with RLS                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │     stores      │    │    products     │    │     orders      │         │
│  ├─────────────────┤    ├─────────────────┤    ├─────────────────┤         │
│  │ id              │◄───│ store_id (FK)   │    │ store_id (FK)   │───►│    │
│  │ owner_id        │    │ title           │    │ order_number    │         │
│  │ name            │    │ description     │    │ customer_email  │         │
│  │ subdomain       │    │ status          │    │ total           │         │
│  │ custom_domain   │    │ created_at      │    │ status          │         │
│  │ stripe_acct_id  │    └────────┬────────┘    └─────────────────┘         │
│  │ settings (JSONB)│             │                                          │
│  └─────────────────┘             │                                          │
│                                  ▼                                          │
│                         ┌─────────────────┐                                 │
│                         │    variants     │                                 │
│                         ├─────────────────┤                                 │
│                         │ store_id (FK)   │                                 │
│                         │ product_id (FK) │                                 │
│                         │ sku             │                                 │
│                         │ price           │                                 │
│                         │ inventory_qty   │                                 │
│                         │ reserved_qty    │                                 │
│                         └─────────────────┘                                 │
│                                                                              │
│  RLS Policies (applied automatically):                                       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ CREATE POLICY store_isolation_products ON products                     │  │
│  │   USING (store_id = current_setting('app.current_store_id')::integer); │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Tenant Context Middleware Flow:**

1. Extract subdomain from URL params
2. Look up store in cache (Valkey) or database
3. Cache store for 5 minutes
4. Attach store to request object
5. In route handlers: `SET LOCAL app.current_store_id = '{store.id}'`
6. All subsequent queries automatically filtered by RLS policy

**Admin Route Protection:**

Admin routes use `requireStoreOwner()` middleware that verifies:
1. User is authenticated (has session)
2. User owns the store (stores.owner_id = session.userId)

---

### Deep Dive 3: Product Management with Inventory (8 minutes)

**Product Data Model:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Product Structure                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                           Product                                    │    │
│  │  ┌─────────────┬────────────────────────────────────────────────┐   │    │
│  │  │ id          │ Auto-generated primary key                      │   │    │
│  │  │ store_id    │ Foreign key to stores (RLS filtered)            │   │    │
│  │  │ title       │ "Classic T-Shirt"                               │   │    │
│  │  │ description │ Rich text description                           │   │    │
│  │  │ status      │ 'draft' | 'active'                              │   │    │
│  │  │ images[]    │ Array of image URLs                             │   │    │
│  │  └─────────────┴────────────────────────────────────────────────┘   │    │
│  │                                │                                     │    │
│  │                                ▼                                     │    │
│  │  ┌───────────────────────────────────────────────────────────────┐  │    │
│  │  │                      Variants[]                                │  │    │
│  │  │  ┌─────────────────────────────────────────────────────────┐  │  │    │
│  │  │  │ Variant 1: "Small / Black"                               │  │  │    │
│  │  │  │   sku: "TS-SM-BLK"                                       │  │  │    │
│  │  │  │   price: 29.99                                           │  │  │    │
│  │  │  │   inventory_quantity: 50                                 │  │  │    │
│  │  │  │   reserved_quantity: 3                                   │  │  │    │
│  │  │  │   options: { size: "Small", color: "Black" }             │  │  │    │
│  │  │  └─────────────────────────────────────────────────────────┘  │  │    │
│  │  │  ┌─────────────────────────────────────────────────────────┐  │  │    │
│  │  │  │ Variant 2: "Medium / Black"                              │  │  │    │
│  │  │  │   sku: "TS-MD-BLK"                                       │  │  │    │
│  │  │  │   price: 29.99                                           │  │  │    │
│  │  │  │   inventory_quantity: 75                                 │  │  │    │
│  │  │  │   reserved_quantity: 0                                   │  │  │    │
│  │  │  └─────────────────────────────────────────────────────────┘  │  │    │
│  │  └───────────────────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

**API Endpoints:**
- `GET /api/admin/:storeId/products` - List all products
- `POST /api/admin/:storeId/products` - Create product with variants
- `GET /api/admin/:storeId/products/:id` - Get single product
- `PUT /api/admin/:storeId/products/:id` - Update product
- `DELETE /api/admin/:storeId/products/:id` - Delete product
- `PATCH /api/admin/:storeId/variants/:variantId/inventory` - Adjust inventory

**Inventory Update with Optimistic Locking:**

Uses a `version` column on variants. Updates include `WHERE version = $expected` clause. If rowCount is 0, return 409 Conflict with current version for retry.

**Audit Logging:**

All product and inventory changes logged with:
- storeId, actorId, actorType ('merchant')
- action ('product.created', 'inventory.adjusted')
- resourceType, resourceId
- changes (before/after snapshots)

---

### Deep Dive 4: Cart Session and API Integration (8 minutes)

**Cart Storage in Valkey:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Cart in Valkey (Redis)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Key Pattern: cart:{storeId}:{sessionId}                                     │
│  TTL: 7 days                                                                 │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  {                                                                     │  │
│  │    "storeId": 42,                                                      │  │
│  │    "sessionId": "uuid-v4",                                             │  │
│  │    "items": [                                                          │  │
│  │      {                                                                 │  │
│  │        "variantId": 101,                                               │  │
│  │        "productId": 5,                                                 │  │
│  │        "title": "Classic T-Shirt",                                     │  │
│  │        "variantTitle": "Medium / Black",                               │  │
│  │        "price": 29.99,                                                 │  │
│  │        "quantity": 2,                                                  │  │
│  │        "imageUrl": "https://..."                                       │  │
│  │      }                                                                 │  │
│  │    ],                                                                  │  │
│  │    "createdAt": "2024-01-15T...",                                      │  │
│  │    "updatedAt": "2024-01-15T...",                                      │  │
│  │    "expiresAt": "2024-01-22T..."                                       │  │
│  │  }                                                                     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Cart API Endpoints:**
- `POST /api/storefront/:subdomain/cart` - Create cart session, returns sessionId
- `GET /api/storefront/:subdomain/cart` - Get cart (requires X-Cart-Session header)
- `POST /api/storefront/:subdomain/cart/items` - Add item (checks inventory)
- `PATCH /api/storefront/:subdomain/cart/items/:variantId` - Update quantity
- `DELETE /api/storefront/:subdomain/cart/items/:variantId` - Remove item

**Add to Cart Flow:**
1. Validate variant exists and is active
2. Check inventory >= requested quantity
3. Check if item already in cart
4. If exists, check combined quantity <= inventory
5. Update cart in Valkey with refreshed TTL

**Frontend API Service Pattern:**

Uses a centralized `apiFetch<T>()` function that:
- Auto-attaches X-Cart-Session header from Zustand store
- Auto-attaches Authorization header if logged in
- Handles errors uniformly
- Returns typed responses

---

## 5. Trade-offs and Alternatives

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Multi-tenancy | Shared DB + RLS | Schema per tenant | Operational simplicity, scales to millions of stores |
| Cart storage | Valkey (Redis) | PostgreSQL | Fast read/write, natural expiry, session-like data |
| Payment flow | Two-step (intent + confirm) | Single charge | Allows client-side payment confirmation with Stripe |
| Idempotency | DB table | Redis with TTL | Durability for financial operations |
| Inventory lock | SERIALIZABLE + FOR UPDATE | Optimistic only | Prevents overselling on concurrent checkouts |
| Session auth | Express session + Redis | JWT | Simpler for SSR, revocable sessions |
| Message queue | RabbitMQ | Kafka | Simpler setup, sufficient for order processing volume |

---

## 6. Future Enhancements

1. **Webhook Delivery System**
   - Reliable delivery to merchant endpoints
   - Retry with exponential backoff
   - Signature verification for security

2. **Custom Domain Routing**
   - Edge worker for domain resolution
   - Automatic SSL provisioning via Let's Encrypt
   - DNS verification flow

3. **Inventory Webhooks**
   - Real-time inventory sync with external systems (ERP, warehouse)
   - Low stock alerts to RabbitMQ queue

4. **Order Fulfillment**
   - Shipping label generation
   - Tracking number updates
   - Automatic status transitions

5. **Analytics Dashboard**
   - Real-time sales metrics
   - Conversion funnel tracking
   - Revenue by product/variant
