# Amazon E-Commerce - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Opening Statement

"Today I'll design the backend infrastructure for an e-commerce platform like Amazon. The key backend challenges are inventory management that prevents overselling under high concurrency, product search with faceted filtering at scale, and recommendation systems. I'll focus on database design, exactly-once semantics for order processing, caching strategies, and event-driven architecture for inventory updates."

---

## 🎯 Requirements Clarification

### Functional Requirements

1. **Catalog**: Browse and search products across categories
2. **Cart**: Add items with inventory reservation
3. **Checkout**: Purchase with payment processing and exactly-once semantics
4. **Orders**: Track order status through fulfillment
5. **Recommendations**: "Customers also bought" suggestions

### Non-Functional Requirements

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| Availability | 99.99% for browsing | Revenue impact of downtime |
| Consistency | Strong for inventory | No overselling |
| Latency | < 100ms search, < 10ms inventory | User experience |
| Scale | 100M products, 1M orders/day | E-commerce baseline |

### Scale Estimates

| Metric | Estimate |
|--------|----------|
| Products | 100M |
| Daily Orders | 1M (~12/second) |
| Peak Concurrent Users | 500K |
| Search QPS | 100K |
| Cart Read:Write Ratio | 10:1 |

---

## 🏗️ High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway / Load Balancer                   │
└─────────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│Catalog Service│    │ Cart Service  │    │ Order Service │
│               │    │               │    │               │
│ - Products    │    │ - Add/remove  │    │ - Checkout    │
│ - Categories  │    │ - Reservation │    │ - Fulfillment │
│ - Search      │    │ - Expiration  │    │ - Tracking    │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Data Layer                                  │
├─────────────┬─────────────┬─────────────┬───────────────────────┤
│ PostgreSQL  │Elasticsearch│   Valkey    │     Kafka             │
│ - Products  │ - Search    │ - Cart      │ - Order events        │
│ - Orders    │ - Facets    │ - Sessions  │ - Inventory updates   │
│ - Inventory │             │ - Dedup     │ - Recommendations     │
└─────────────┴─────────────┴─────────────┴───────────────────────┘
```

---

## 📦 Deep Dive 1: Reserved Inventory Model

### The Overselling Problem

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         Race Condition Without Reservation                           │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Time ───────────────────────────────────────────────────────────────────────▶      │
│                                                                                      │
│  User A: ─── Check inventory (sees 1) ─── Add to cart ─── Checkout ───────▶        │
│                                                                                      │
│  User B: ─── Check inventory (sees 1) ─────── Add to cart ─── Checkout ──▶         │
│                                                                                      │
│  Result: Both users purchase ──▶ Inventory becomes -1 ──▶ OVERSOLD!                 │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Solution: Reserved Inventory Table

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              inventory Table                                         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Columns:                                                                            │
│  ├── product_id: INTEGER (FK → products, PK with warehouse)                         │
│  ├── warehouse_id: INTEGER (FK → warehouses, PK with product)                       │
│  ├── quantity: INTEGER (total physical stock)                                       │
│  └── reserved: INTEGER (reserved by active carts)                                   │
│                                                                                      │
│  Derived:                                                                            │
│  └── available = quantity - reserved                                                 │
│                                                                                      │
│  Invariant:                                                                          │
│  └── reserved <= quantity (enforced at application layer with row locks)            │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Add to Cart with Reservation

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      addToCart(userId, productId, quantity)                          │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  BEGIN TRANSACTION                                                                   │
│                                                                                      │
│  Step 1: Lock and check inventory                                                    │
│  ├── SELECT * FROM inventory WHERE product_id = $1 FOR UPDATE  ◄── Row lock        │
│  ├── Calculate: available = quantity - reserved                                     │
│  └── IF available < requested ──▶ THROW InsufficientInventoryError                 │
│                                                                                      │
│  Step 2: Reserve inventory atomically                                                │
│  └── UPDATE inventory SET reserved = reserved + $quantity WHERE product_id = $1    │
│                                                                                      │
│  Step 3: Add to cart with expiration                                                 │
│  ├── INSERT INTO cart_items (user_id, product_id, quantity, reserved_until)         │
│  │   VALUES ($1, $2, $3, NOW() + 30 minutes)                                        │
│  │   ON CONFLICT (user_id, product_id) DO UPDATE                                    │
│  │   SET quantity = cart_items.quantity + $3,                                       │
│  │       reserved_until = NOW() + 30 minutes                                        │
│                                                                                      │
│  COMMIT                                                                              │
│                                                                                      │
│  Return: { success: true, expiresAt: NOW() + 30 minutes }                           │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Background Job: Release Expired Reservations

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      releaseExpiredReservations() - Runs every minute                │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  BEGIN TRANSACTION                                                                   │
│                                                                                      │
│  Step 1: Find and lock expired items                                                 │
│  ├── SELECT product_id, SUM(quantity) as total FROM cart_items                      │
│  │   WHERE reserved_until < NOW()                                                    │
│  │   FOR UPDATE SKIP LOCKED  ◄── Non-blocking for concurrent job runs              │
│  │   GROUP BY product_id                                                             │
│                                                                                      │
│  Step 2: Release reserved inventory                                                  │
│  └── FOR EACH expired item:                                                          │
│      UPDATE inventory SET reserved = reserved - total WHERE product_id = $1        │
│                                                                                      │
│  Step 3: Delete expired cart items                                                   │
│  └── DELETE FROM cart_items WHERE reserved_until < NOW()                            │
│                                                                                      │
│  COMMIT                                                                              │
│                                                                                      │
│  Log: { released: rowCount, event: "expired_reservations" }                         │
│  Metric: cartAbandonments.inc(released)                                              │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔐 Deep Dive 2: Exactly-Once Order Processing

### Multi-Layer Idempotency

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      POST /api/orders (Checkout Flow)                                │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Input: Request body + Idempotency-Key header (required)                             │
│                                                                                      │
│  Layer 1: Redis Fast-Path Dedup                                                      │
│  ├── key = "idem:order:" + idempotencyKey                                            │
│  ├── existing = redis.GET(key)                                                       │
│  ├── IF existing.status = "processing" ──▶ Return 409 (retry later)                │
│  ├── IF existing.status = "completed" ──▶ Return 200 (cached response)             │
│  └── SETEX key 86400 { status: "processing" }                                       │
│                                                                                      │
│  Layer 2: Database Constraint Dedup                                                  │
│  ├── BEGIN TRANSACTION                                                               │
│  ├── SELECT * FROM orders WHERE idempotency_key = $1                                │
│  ├── IF exists ──▶ Return existing order                                            │
│  │                                                                                   │
│  ├── Lock cart items: SELECT * FROM cart_items WHERE user_id = $1 FOR UPDATE       │
│  ├── IF empty ──▶ THROW "Cart is empty"                                             │
│  │                                                                                   │
│  ├── Verify inventory (re-lock):                                                     │
│  │   FOR EACH item:                                                                  │
│  │     SELECT * FROM inventory WHERE product_id = $1 FOR UPDATE                     │
│  │     IF quantity < requested ──▶ THROW InsufficientInventoryError                │
│  │                                                                                   │
│  ├── Create order with idempotency_key (UNIQUE constraint)                          │
│  ├── Convert reserved to sold:                                                       │
│  │   UPDATE inventory SET quantity = quantity - $1, reserved = reserved - $1       │
│  ├── Insert order_items                                                              │
│  ├── Delete cart_items                                                               │
│  ├── COMMIT                                                                          │
│  │                                                                                   │
│  └── Publish: kafka.send("order-events", { type: "order.created", order })          │
│                                                                                      │
│  Cache success: SETEX key 86400 { status: "completed", response: order }            │
│  Return: 201 Created with order                                                      │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔍 Deep Dive 3: Elasticsearch for Product Search

### Index Schema

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      products Index Schema                                           │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Mappings:                                                                           │
│  ├── title: text (analyzer: english, boost: 3x)                                     │
│  ├── description: text (analyzer: english)                                           │
│  ├── category_id: keyword                                                            │
│  ├── category_path: keyword (hierarchical path for facets)                          │
│  ├── brand: keyword                                                                  │
│  ├── price: float                                                                    │
│  ├── rating: float                                                                   │
│  ├── review_count: integer                                                           │
│  ├── in_stock: boolean                                                               │
│  └── attributes: nested                                                              │
│      ├── name: keyword                                                               │
│      └── value: keyword                                                              │
│                                                                                      │
│  Settings:                                                                           │
│  ├── number_of_shards: 5                                                             │
│  ├── number_of_replicas: 1                                                           │
│  └── refresh_interval: 5s  ◄── Trade-off: freshness vs indexing performance         │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Faceted Search Query Structure

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      searchProducts(query, filters, page)                            │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Query Structure:                                                                    │
│  ├── function_score (relevance + business boosting)                                 │
│  │   ├── bool query:                                                                 │
│  │   │   ├── must: multi_match on [title^3, description]                            │
│  │   │   └── filter:                                                                 │
│  │   │       ├── term: category_path (if provided)                                  │
│  │   │       ├── range: price gte/lte (if provided)                                 │
│  │   │       ├── term: in_stock = true (if filter on)                               │
│  │   │       ├── terms: brand (if brands selected)                                  │
│  │   │       └── range: rating gte (if minimum rating)                              │
│  │   │                                                                               │
│  │   └── functions (boost scores):                                                   │
│  │       ├── filter: in_stock = true ──▶ weight: 2                                  │
│  │       ├── field_value_factor: rating (sqrt modifier, 1.2x)                       │
│  │       └── field_value_factor: review_count (log1p modifier, 1.1x)                │
│  │                                                                                   │
│  └── Aggregations (facets):                                                          │
│      ├── categories: terms on category_path (size: 20)                              │
│      ├── brands: terms on brand (size: 50)                                          │
│      └── price_ranges: range aggregation                                             │
│          ├── Under $25 (to: 25)                                                      │
│          ├── $25-$50 (from: 25, to: 50)                                              │
│          ├── $50-$100 (from: 50, to: 100)                                            │
│          ├── $100-$200 (from: 100, to: 200)                                          │
│          └── Over $200 (from: 200)                                                   │
│                                                                                      │
│  Pagination: from = page * 20, size = 20                                             │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### PostgreSQL Fallback with Circuit Breaker

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      Circuit Breaker Pattern                                         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Circuit Configuration:                                                              │
│  ├── failureThreshold: 3 (consecutive failures to open)                              │
│  ├── successThreshold: 2 (successes to close from half-open)                         │
│  └── timeout: 10000ms (time before half-open attempt)                                │
│                                                                                      │
│  State Machine:                                                                      │
│  ├── CLOSED: Normal operation, requests go to Elasticsearch                          │
│  │   └── On 3 failures ──▶ OPEN                                                     │
│  │                                                                                   │
│  ├── OPEN: All requests go to PostgreSQL fallback                                   │
│  │   └── After 10s ──▶ HALF-OPEN                                                    │
│  │                                                                                   │
│  └── HALF-OPEN: Test Elasticsearch with single request                              │
│      ├── On success (2x) ──▶ CLOSED                                                 │
│      └── On failure ──▶ OPEN                                                        │
│                                                                                      │
│  PostgreSQL Fallback Query:                                                          │
│  ├── Uses to_tsvector/plainto_tsquery for full-text search                          │
│  ├── ts_rank for relevance scoring                                                   │
│  ├── Standard WHERE clauses for filters                                              │
│  └── Returns { products, facets: {}, fallback: true }                               │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🎯 Deep Dive 4: Recommendation Engine

### Batch Computation of "Also Bought"

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      computeAlsoBoughtRecommendations() - Nightly Job                │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  For each active product (batched, 100 at a time):                                   │
│                                                                                      │
│  Step 1: Query co-purchased products (last 90 days)                                  │
│  ├── SELECT oi2.product_id, COUNT(*) as frequency,                                   │
│  │     COUNT(*) / total_orders_for_product as score                                 │
│  ├── FROM order_items oi1                                                            │
│  ├── JOIN order_items oi2 ON oi1.order_id = oi2.order_id                            │
│  ├── WHERE oi1.product_id = current_product                                          │
│  │     AND oi2.product_id != current_product                                         │
│  │     AND oi1.created_at > NOW() - 90 days                                          │
│  ├── GROUP BY oi2.product_id                                                         │
│  └── ORDER BY frequency DESC LIMIT 20                                                │
│                                                                                      │
│  Step 2: Cache in Valkey (hot path)                                                  │
│  └── SETEX "recs:also_bought:{productId}" 86400 JSON(results)                       │
│                                                                                      │
│  Step 3: Store in PostgreSQL (durability)                                            │
│  ├── DELETE FROM product_recommendations                                             │
│  │   WHERE product_id = $1 AND type = 'also_bought'                                 │
│  └── INSERT INTO product_recommendations                                             │
│      (product_id, recommended_product_id, type, score)                              │
│      VALUES (...)                                                                    │
│                                                                                      │
│  Log progress: { processed: offset, event: "recommendation_batch" }                  │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Real-Time Recommendation Retrieval

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      getAlsoBoughtRecommendations(productId)                         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Try Cache First:                                                                    │
│  ├── cached = redis.GET("recs:also_bought:" + productId)                             │
│  ├── IF cached:                                                                      │
│  │   └── Return products WHERE id IN (cached.product_ids) AND is_active = true     │
│                                                                                      │
│  Fallback to Database:                                                               │
│  ├── SELECT * FROM product_recommendations                                           │
│  │   WHERE product_id = $1 AND type = 'also_bought'                                 │
│  │   ORDER BY score DESC LIMIT 10                                                    │
│  └── Return products WHERE id IN (rec.product_ids) AND is_active = true             │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📚 Deep Dive 5: Data Lifecycle and Archival

### Retention Policies

| Data Type | Hot Storage | Archive Retention | Notes |
|-----------|-------------|-------------------|-------|
| Orders | 2 years | 7 years total | Legal/tax requirement |
| Cart Items | 30 minutes | N/A (ephemeral) | Reservation duration |
| Audit Logs | 1 year | 3 years | Compliance |
| Search Logs | 90 days | N/A | Analytics only |

### Order Archival Process

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      archiveOldOrders() - Monthly Job                                │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Cutoff: created_at < NOW() - 2 years                                                │
│  Batch size: 1000 orders per iteration                                               │
│                                                                                      │
│  For each batch:                                                                     │
│  ├── SELECT orders WHERE created_at < cutoff                                         │
│  │     AND archived_at IS NULL                                                       │
│  │     AND status IN ('delivered', 'cancelled', 'refunded')                          │
│  │     LIMIT 1000                                                                    │
│  │                                                                                   │
│  ├── For each order:                                                                 │
│  │   ├── Fetch order_items                                                           │
│  │   ├── Create archive_data JSON (order + items)                                   │
│  │   │                                                                               │
│  │   ├── INSERT INTO orders_archive (order_id, user_id, archive_data, ...)          │
│  │   │                                                                               │
│  │   └── UPDATE orders SET                                                           │
│  │         archived_at = NOW(),                                                      │
│  │         archive_status = 'archived',                                              │
│  │         shipping_address = { anonymized: true },                                 │
│  │         billing_address = NULL,                                                   │
│  │         notes = NULL                                                              │
│  │                                                                                   │
│  └── Log: { archived: batch.length, event: "order_archival" }                       │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Deep Dive 6: Observability

### Prometheus Metrics

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           Core Metrics                                               │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Order Metrics:                                                                      │
│  ├── orders_total (Counter)                                                          │
│  │   └── Labels: status (success/failed/duplicate)                                  │
│  └── order_value_dollars (Histogram)                                                 │
│      └── Buckets: [10, 25, 50, 100, 250, 500, 1000, 2500]                           │
│                                                                                      │
│  Inventory Metrics:                                                                  │
│  ├── inventory_reservations_total (Counter)                                          │
│  │   └── Labels: status (success/insufficient/error)                                │
│  └── cart_abandonments_total (Counter)                                               │
│                                                                                      │
│  Search Metrics:                                                                     │
│  └── search_latency_seconds (Histogram)                                              │
│      ├── Labels: query_type, engine (elasticsearch/postgres)                        │
│      └── Buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1]                            │
│                                                                                      │
│  Circuit Breaker:                                                                    │
│  └── circuit_breaker_state (Gauge)                                                   │
│      ├── Labels: service                                                             │
│      └── Values: 0=closed, 1=half-open, 2=open                                      │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Alert Rules

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           Critical Alerts                                            │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  HighCheckoutFailureRate (severity: critical)                                        │
│  ├── Condition: failed/total > 5% for 2 minutes                                      │
│  └── Action: Page on-call engineer                                                   │
│                                                                                      │
│  InventoryOversell (severity: critical)                                              │
│  ├── Condition: inventory_oversell_total increases                                   │
│  └── Action: Immediate investigation required                                        │
│                                                                                      │
│  SearchLatencyHigh (severity: warning)                                               │
│  ├── Condition: p99 latency > 300ms for 5 minutes                                    │
│  └── Action: Check Elasticsearch cluster health                                      │
│                                                                                      │
│  ElasticsearchCircuitOpen (severity: warning)                                        │
│  ├── Condition: circuit_breaker_state{service="elasticsearch"} == 2                 │
│  └── Action: Investigate Elasticsearch availability                                  │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🗄️ Database Schema Highlights

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              products Table                                          │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Columns:                                                                            │
│  ├── id: SERIAL PRIMARY KEY                                                          │
│  ├── seller_id: INTEGER (FK → sellers, CASCADE)                                      │
│  ├── title: VARCHAR(500) NOT NULL                                                    │
│  ├── slug: VARCHAR(500) UNIQUE NOT NULL                                              │
│  ├── description: TEXT                                                               │
│  ├── category_id: INTEGER (FK → categories, SET NULL)                                │
│  ├── price: DECIMAL(10,2) NOT NULL                                                   │
│  ├── rating: DECIMAL(2,1) DEFAULT 0                                                  │
│  ├── review_count: INTEGER DEFAULT 0                                                 │
│  ├── is_active: BOOLEAN DEFAULT true                                                 │
│  └── created_at, updated_at: TIMESTAMP                                               │
│                                                                                      │
│  Indexes:                                                                            │
│  ├── idx_products_category: B-tree on category_id                                   │
│  ├── idx_products_price: B-tree on price                                             │
│  ├── idx_products_rating: B-tree on rating                                           │
│  └── idx_products_search: GIN on to_tsvector(title || description)                  │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              orders Table                                            │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Columns:                                                                            │
│  ├── id: SERIAL PRIMARY KEY                                                          │
│  ├── user_id: INTEGER (FK → users, SET NULL)                                         │
│  ├── status: VARCHAR(30) DEFAULT 'pending'                                           │
│  ├── total: DECIMAL(10,2) NOT NULL                                                   │
│  ├── shipping_address: JSONB NOT NULL                                                │
│  ├── idempotency_key: VARCHAR(255) UNIQUE  ◄── Exactly-once guarantee              │
│  ├── archive_status: VARCHAR(20) DEFAULT 'active'                                    │
│  ├── archived_at: TIMESTAMP                                                          │
│  └── created_at: TIMESTAMP DEFAULT NOW()                                             │
│                                                                                      │
│  Indexes:                                                                            │
│  ├── idx_orders_idempotency: B-tree on idempotency_key                              │
│  └── idx_orders_archive_status: B-tree on archive_status                            │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## ⚖️ Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Inventory model | Reserved quantity | Decrement on add | Prevents overselling, allows cart expiration |
| Search engine | Elasticsearch + PG fallback | PostgreSQL only | Performance at scale, graceful degradation |
| Recommendations | Batch precompute | Real-time ML | Simplicity, cache-friendly, acceptable staleness |
| Order idempotency | Redis + PostgreSQL | PostgreSQL only | Fast duplicate detection, durable backup |
| Cart storage | PostgreSQL + cache | Redis only | Durability for inventory reservations |
| Archival | Tiered (hot/warm/cold) | Keep all in PostgreSQL | Cost efficiency, query performance |

---

## 🔮 Future Backend Enhancements

| Enhancement | Complexity | Value |
|-------------|------------|-------|
| Kafka for async processing | Medium | Decouple checkout from inventory |
| Read replicas for catalog | Low | Distribute read load |
| Order sharding by user_id/date | High | Horizontal scaling |
| Real-time ML recommendations | High | Personalization improvement |
| Geo-distributed inventory | High | Multi-region fulfillment |
| Token bucket rate limiting | Low | Flash sale protection |
| Saga pattern for checkout | Medium | Distributed transactions |

---

## 🎤 Interview Wrap-up

> "We've designed an e-commerce backend that handles 1M orders/day with strong inventory consistency. The reserved quantity model with row-level locking prevents overselling. Multi-layer idempotency (Redis + database UNIQUE constraint) ensures exactly-once order processing. Elasticsearch with PostgreSQL fallback via circuit breaker provides sub-100ms search with graceful degradation. Batch-computed 'also bought' recommendations are cached in Redis for low-latency retrieval. The observability stack catches issues like checkout failures and inventory oversells before they impact customers."
