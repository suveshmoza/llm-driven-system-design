# Design Amazon - Architecture

## System Overview

Amazon is an e-commerce platform handling massive product catalogs, real-time inventory, and complex order fulfillment. Core challenges involve inventory consistency, product search, and recommendation systems.

**Learning Goals:**
- Design inventory systems that prevent overselling
- Build product search with faceted filtering
- Implement "also bought" recommendations
- Handle order state machines

---

## Requirements

### Functional Requirements

1. **Catalog**: Browse and search products
2. **Cart**: Add items, manage quantities
3. **Checkout**: Purchase with payment
4. **Orders**: Track order status
5. **Recommendations**: Personalized suggestions

### Non-Functional Requirements

- **Availability**: 99.99% for browsing
- **Consistency**: Strong for inventory (no overselling)
- **Latency**: < 100ms for search
- **Scale**: 100M products, 1M orders/day

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Client Layer                                 │
│        React + Product pages + Cart + Checkout                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway                                  │
└─────────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│Catalog Service│    │ Cart Service  │    │ Order Service │
│               │    │               │    │               │
│ - Products    │    │ - Add/remove  │    │ - Checkout    │
│ - Categories  │    │ - Quantities  │    │ - Fulfillment │
│ - Search      │    │ - Inventory   │    │ - Tracking    │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Data Layer                                 │
├─────────────┬─────────────┬─────────────┬───────────────────────┤
│ PostgreSQL  │Elasticsearch│   Valkey    │     Kafka             │
│ - Products  │ - Search    │ - Cart      │ - Order events        │
│ - Orders    │ - Facets    │ - Sessions  │ - Inventory updates   │
│ - Inventory │             │ - Inventory │                       │
└─────────────┴─────────────┴─────────────┴───────────────────────┘
```

---

## Core Components

### 1. Inventory Management

**Challenge**: Prevent overselling during high-concurrency checkout

**Approach: Optimistic Locking with Reserved Inventory**
```javascript
async function addToCart(userId, productId, quantity) {
  return await db.transaction(async (trx) => {
    // Check available inventory
    const product = await trx('inventory')
      .where({ product_id: productId })
      .first()

    const available = product.quantity - product.reserved
    if (available < quantity) {
      throw new Error('Insufficient inventory')
    }

    // Reserve inventory
    await trx('inventory')
      .where({ product_id: productId })
      .increment('reserved', quantity)

    // Add to cart with expiry
    await trx('cart_items').insert({
      user_id: userId,
      product_id: productId,
      quantity,
      reserved_until: new Date(Date.now() + 30 * 60 * 1000) // 30 min
    })
  })
}
```

**Background Job: Release Expired Reservations**
```javascript
async function releaseExpiredReservations() {
  const expired = await db('cart_items')
    .where('reserved_until', '<', new Date())
    .select('product_id', 'quantity')

  for (const item of expired) {
    await db('inventory')
      .where({ product_id: item.product_id })
      .decrement('reserved', item.quantity)
  }

  await db('cart_items')
    .where('reserved_until', '<', new Date())
    .delete()
}
```

### 2. Product Search

**Elasticsearch Index:**
```json
{
  "mappings": {
    "properties": {
      "title": { "type": "text", "analyzer": "standard" },
      "description": { "type": "text" },
      "category": { "type": "keyword" },
      "brand": { "type": "keyword" },
      "price": { "type": "float" },
      "attributes": { "type": "nested" },
      "rating": { "type": "float" },
      "in_stock": { "type": "boolean" }
    }
  }
}
```

**Faceted Search Query:**
```javascript
async function searchProducts(query, filters, facets) {
  const body = {
    query: {
      bool: {
        must: [
          { match: { title: query } }
        ],
        filter: [
          filters.category && { term: { category: filters.category } },
          filters.priceMin && { range: { price: { gte: filters.priceMin } } },
          filters.inStock && { term: { in_stock: true } }
        ].filter(Boolean)
      }
    },
    aggs: {
      categories: { terms: { field: "category" } },
      brands: { terms: { field: "brand" } },
      price_ranges: {
        range: {
          field: "price",
          ranges: [
            { to: 25 },
            { from: 25, to: 50 },
            { from: 50, to: 100 },
            { from: 100 }
          ]
        }
      }
    }
  }

  return await es.search({ index: 'products', body })
}
```

### 3. Recommendations

**Collaborative Filtering: "Also Bought"**
```sql
-- Find products frequently bought together
SELECT p2.product_id, COUNT(*) as frequency
FROM order_items o1
JOIN order_items o2 ON o1.order_id = o2.order_id
WHERE o1.product_id = $1
  AND o2.product_id != $1
GROUP BY p2.product_id
ORDER BY frequency DESC
LIMIT 10;
```

**Precomputed Recommendations:**
```javascript
// Batch job: Update recommendations nightly
async function updateProductRecommendations() {
  const products = await db('products').select('id')

  for (const product of products) {
    const alsoBought = await db.raw(`
      SELECT o2.product_id, COUNT(*) as freq
      FROM order_items o1
      JOIN order_items o2 ON o1.order_id = o2.order_id
      WHERE o1.product_id = ?
        AND o2.product_id != ?
      GROUP BY o2.product_id
      ORDER BY freq DESC
      LIMIT 20
    `, [product.id, product.id])

    await redis.set(
      `recs:${product.id}`,
      JSON.stringify(alsoBought.rows),
      'EX', 86400
    )
  }
}
```

---

## Database Schema

### Entity-Relationship Diagram

```
                                    ┌─────────────────────────────────────────────────────────────────┐
                                    │                         USERS                                    │
                                    │─────────────────────────────────────────────────────────────────│
                                    │ PK  id              SERIAL                                      │
                                    │     email           VARCHAR(255) UNIQUE NOT NULL                │
                                    │     password_hash   VARCHAR(255) NOT NULL                       │
                                    │     name            VARCHAR(255) NOT NULL                       │
                                    │     role            VARCHAR(20) [user, admin, seller]           │
                                    │     created_at      TIMESTAMP                                   │
                                    │     updated_at      TIMESTAMP                                   │
                                    └─────────────────────────────────────────────────────────────────┘
                                          │                    │                      │
                                          │ 1:1                │ 1:N                  │ 1:N
                                          ▼                    ▼                      ▼
┌───────────────────────────────┐   ┌─────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│          SELLERS              │   │    SESSIONS     │   │   CART_ITEMS     │   │    REVIEWS       │
│───────────────────────────────│   │─────────────────│   │──────────────────│   │──────────────────│
│ PK  id          SERIAL        │   │ PK id VARCHAR   │   │ PK id SERIAL     │   │ PK id SERIAL     │
│ FK  user_id     → users(id)   │   │ FK user_id      │   │ FK user_id       │   │ FK user_id       │
│     business_name VARCHAR     │   │    data JSONB   │   │ FK product_id    │   │ FK product_id    │
│     description   TEXT        │   │    expires_at   │   │    quantity      │   │ FK order_id      │
│     rating        DECIMAL     │   │    created_at   │   │    reserved_until│   │    rating 1-5    │
│     created_at    TIMESTAMP   │   └─────────────────┘   │    added_at      │   │    title, content│
└───────────────────────────────┘                         │ UNIQUE(user,prod)│   │    helpful_count │
          │                                               └──────────────────┘   │    verified_purch│
          │ 1:N                                                    │             └──────────────────┘
          ▼                                                        │                      │
┌─────────────────────────────────────────────────────────────────┐│                      │
│                          PRODUCTS                                ││                      │
│─────────────────────────────────────────────────────────────────││                      │
│ PK  id               SERIAL                                     ││                      │
│ FK  seller_id        → sellers(id) ON DELETE CASCADE            │◄─────────────────────┘
│ FK  category_id      → categories(id) ON DELETE SET NULL        │
│     title            VARCHAR(500) NOT NULL                       │
│     slug             VARCHAR(500) UNIQUE NOT NULL                │
│     description      TEXT                                        │
│     price            DECIMAL(10,2) NOT NULL                      │
│     compare_at_price DECIMAL(10,2)                               │
│     images           TEXT[] DEFAULT '{}'                         │
│     attributes       JSONB DEFAULT '{}'                          │
│     rating           DECIMAL(2,1) DEFAULT 0                      │
│     review_count     INTEGER DEFAULT 0                           │
│     is_active        BOOLEAN DEFAULT true                        │
│     created_at, updated_at TIMESTAMP                             │
└─────────────────────────────────────────────────────────────────┘
          │                         │                              │
          │ 1:N                     │ N:M                          │ 1:N
          ▼                         ▼                              ▼
┌──────────────────────┐   ┌────────────────────┐   ┌─────────────────────────────────┐
│ PRODUCT_RECOMMENDATIONS│   │    INVENTORY      │   │         ORDER_ITEMS             │
│──────────────────────│   │────────────────────│   │─────────────────────────────────│
│ PK product_id        │   │ PK product_id      │   │ PK  id              SERIAL      │
│ PK recommended_id    │   │ PK warehouse_id    │   │ FK  order_id        → orders    │
│ PK recommendation_type│   │    quantity        │   │ FK  product_id      → products  │
│    score DECIMAL     │   │    reserved        │   │     product_title   VARCHAR(500)│
│    updated_at        │   │    low_stock_thresh│   │     quantity        INTEGER      │
└──────────────────────┘   └────────────────────┘   │     price           DECIMAL     │
                                    │               │     created_at      TIMESTAMP   │
                                    │               └─────────────────────────────────┘
                                    ▼                              │
                           ┌────────────────────┐                  │
                           │    WAREHOUSES      │                  │
                           │────────────────────│                  ▼
                           │ PK  id     SERIAL  │   ┌─────────────────────────────────────────────────┐
                           │     name   VARCHAR │   │                    ORDERS                        │
                           │     address JSONB  │   │─────────────────────────────────────────────────│
                           │     is_active BOOL │   │ PK  id             SERIAL                       │
                           │     created_at     │   │ FK  user_id        → users(id) ON DELETE SET NULL│
                           └────────────────────┘   │     status         VARCHAR(30) [pending, confirmed,│
                                                    │                    processing, shipped, delivered,│
┌─────────────────────────────────────┐             │                    cancelled, refunded]           │
│           CATEGORIES                │             │     subtotal, tax, shipping_cost, total DECIMAL  │
│─────────────────────────────────────│             │     shipping_address JSONB NOT NULL              │
│ PK  id           SERIAL             │             │     billing_address  JSONB                       │
│ FK  parent_id    → categories(id)   │◄───────┐    │     payment_method   VARCHAR(50)                 │
│     name         VARCHAR(100)       │────────┘    │     payment_status   [pending, completed, failed,│
│     slug         VARCHAR(100) UNIQUE│ self-ref    │                      refunded]                   │
│     description  TEXT               │             │     notes            TEXT                        │
│     image_url    VARCHAR(500)       │             │     idempotency_key  VARCHAR(255)                │
│     created_at   TIMESTAMP          │             │     archive_status   [active, pending_archive,   │
└─────────────────────────────────────┘             │                      archived, anonymized]       │
                                                    │     archived_at      TIMESTAMP                   │
                                                    │     created_at, updated_at TIMESTAMP             │
                                                    └─────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             OBSERVABILITY & RESILIENCE TABLES                                        │
├─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                      │
│  ┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────────────────┐   │
│  │    IDEMPOTENCY_KEYS      │  │       AUDIT_LOGS         │  │        ORDERS_ARCHIVE            │   │
│  │──────────────────────────│  │──────────────────────────│  │──────────────────────────────────│   │
│  │ PK key      VARCHAR(255) │  │ PK id          SERIAL    │  │ PK id           SERIAL           │   │
│  │    status   [processing, │  │    created_at  TIMESTAMP │  │    order_id     INTEGER          │   │
│  │             completed,   │  │    action      VARCHAR   │  │    user_id      INTEGER          │   │
│  │             failed]      │  │    actor_id    INTEGER   │  │    archive_data JSONB            │   │
│  │    request_data JSONB    │  │    actor_type  [user,    │  │    created_at   TIMESTAMP        │   │
│  │    response     JSONB    │  │                admin,    │  │    archived_at  TIMESTAMP        │   │
│  │    created_at   TIMESTAMP│  │                system,   │  └──────────────────────────────────┘   │
│  │    completed_at TIMESTAMP│  │                service]  │                                         │
│  └──────────────────────────┘  │    resource_type VARCHAR │  ┌──────────────────────────────────┐   │
│                                │    resource_id   VARCHAR │  │         SEARCH_LOGS              │   │
│                                │    old_value     JSONB   │  │──────────────────────────────────│   │
│                                │    new_value     JSONB   │  │ PK id           SERIAL           │   │
│                                │    ip_address    INET    │  │    user_id      INTEGER          │   │
│                                │    user_agent    TEXT    │  │    query        TEXT             │   │
│                                │    correlation_id UUID   │  │    filters      JSONB            │   │
│                                │    severity      [info,  │  │    results_count INTEGER         │   │
│                                │                  warning,│  │    latency_ms   INTEGER          │   │
│                                │                  critical│  │    engine       VARCHAR(20)      │   │
│                                └──────────────────────────┘  │    created_at   TIMESTAMP        │   │
│                                                              └──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Complete Table Definitions

#### Core User & Authentication Tables

**users** - Central user accounts for customers, sellers, and administrators
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Auto-incrementing user identifier |
| email | VARCHAR(255) | UNIQUE, NOT NULL | Login credential and contact email |
| password_hash | VARCHAR(255) | NOT NULL | Bcrypt-hashed password (cost factor 10) |
| name | VARCHAR(255) | NOT NULL | Display name for UI and communications |
| role | VARCHAR(20) | CHECK (user/admin/seller), DEFAULT 'user' | Authorization role determining permissions |
| created_at | TIMESTAMP | DEFAULT NOW() | Account creation timestamp |
| updated_at | TIMESTAMP | DEFAULT NOW() | Last profile update timestamp |

**sessions** - Server-side session storage for authentication state
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | VARCHAR(255) | PRIMARY KEY | Session token (UUID or secure random string) |
| user_id | INTEGER | FK → users(id) ON DELETE CASCADE | Owning user; session deleted when user deleted |
| data | JSONB | DEFAULT '{}' | Arbitrary session data (cart state, preferences) |
| expires_at | TIMESTAMP | NOT NULL | Session expiration for automatic cleanup |
| created_at | TIMESTAMP | DEFAULT NOW() | Session creation timestamp |

**sellers** - Extended profile for users with seller role
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Seller profile identifier |
| user_id | INTEGER | FK → users(id) ON DELETE CASCADE | Link to user account; deleted with user |
| business_name | VARCHAR(255) | NOT NULL | Displayed storefront name |
| description | TEXT | | Seller bio and business description |
| rating | DECIMAL(2,1) | DEFAULT 0 | Aggregate seller rating (0.0-5.0) |
| created_at | TIMESTAMP | DEFAULT NOW() | Seller registration timestamp |

#### Product Catalog Tables

**categories** - Hierarchical product taxonomy (self-referential)
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Category identifier |
| name | VARCHAR(100) | NOT NULL | Display name (e.g., "Smartphones") |
| slug | VARCHAR(100) | UNIQUE, NOT NULL | URL-friendly identifier (e.g., "smartphones") |
| parent_id | INTEGER | FK → categories(id) ON DELETE SET NULL | Parent category for hierarchy; NULL = root |
| description | TEXT | | Category description for SEO and browsing |
| image_url | VARCHAR(500) | | Category banner/thumbnail image |
| created_at | TIMESTAMP | DEFAULT NOW() | Category creation timestamp |

**products** - Main product catalog
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Product identifier |
| seller_id | INTEGER | FK → sellers(id) ON DELETE CASCADE | Owning seller; products deleted with seller |
| title | VARCHAR(500) | NOT NULL | Product title for display and search |
| slug | VARCHAR(500) | UNIQUE, NOT NULL | URL-friendly identifier for product pages |
| description | TEXT | | Full product description (HTML allowed) |
| category_id | INTEGER | FK → categories(id) ON DELETE SET NULL | Primary category; preserved if category deleted |
| price | DECIMAL(10,2) | NOT NULL | Current selling price |
| compare_at_price | DECIMAL(10,2) | | Original/MSRP price for showing discounts |
| images | TEXT[] | DEFAULT '{}' | Array of image URLs (first = primary) |
| attributes | JSONB | DEFAULT '{}' | Flexible attributes (color, size, specs) |
| rating | DECIMAL(2,1) | DEFAULT 0 | Aggregate product rating (0.0-5.0) |
| review_count | INTEGER | DEFAULT 0 | Denormalized review count for display |
| is_active | BOOLEAN | DEFAULT true | Soft-delete flag; false = hidden from catalog |
| created_at | TIMESTAMP | DEFAULT NOW() | Product creation timestamp |
| updated_at | TIMESTAMP | DEFAULT NOW() | Last product update timestamp |

**warehouses** - Physical inventory locations
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Warehouse identifier |
| name | VARCHAR(100) | NOT NULL | Warehouse name for admin UI |
| address | JSONB | NOT NULL | Structured address (street, city, state, zip, country) |
| is_active | BOOLEAN | DEFAULT true | Whether warehouse accepts new inventory |
| created_at | TIMESTAMP | DEFAULT NOW() | Warehouse registration timestamp |

**inventory** - Stock levels per product per warehouse (composite key)
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| product_id | INTEGER | PK, FK → products(id) ON DELETE CASCADE | Product being tracked |
| warehouse_id | INTEGER | PK, FK → warehouses(id) ON DELETE CASCADE | Location of inventory |
| quantity | INTEGER | DEFAULT 0 | Total units in stock |
| reserved | INTEGER | DEFAULT 0 | Units reserved in carts (pending checkout) |
| low_stock_threshold | INTEGER | DEFAULT 10 | Alert threshold for reorder notifications |

#### Shopping & Checkout Tables

**cart_items** - Active shopping cart contents with inventory reservations
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Cart item identifier |
| user_id | INTEGER | FK → users(id) ON DELETE CASCADE | Cart owner; cleared when user deleted |
| product_id | INTEGER | FK → products(id) ON DELETE CASCADE | Product in cart; removed if product deleted |
| quantity | INTEGER | CHECK (quantity > 0), DEFAULT 1 | Number of units requested |
| reserved_until | TIMESTAMP | | Inventory reservation expiry (30 min from add) |
| added_at | TIMESTAMP | DEFAULT NOW() | When item was added to cart |
| | | UNIQUE(user_id, product_id) | Prevents duplicate entries; update quantity instead |

**orders** - Customer order header with status and payment tracking
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Order identifier |
| user_id | INTEGER | FK → users(id) ON DELETE SET NULL | Customer; preserved for order history if deleted |
| status | VARCHAR(30) | CHECK (...), DEFAULT 'pending' | Order state machine (pending→confirmed→processing→shipped→delivered) |
| subtotal | DECIMAL(10,2) | NOT NULL | Sum of item prices before tax/shipping |
| tax | DECIMAL(10,2) | DEFAULT 0 | Calculated tax amount |
| shipping_cost | DECIMAL(10,2) | DEFAULT 0 | Shipping charges |
| total | DECIMAL(10,2) | NOT NULL | Final charge amount (subtotal + tax + shipping) |
| shipping_address | JSONB | NOT NULL | Delivery address (name, street, city, state, zip, country) |
| billing_address | JSONB | | Payment address (if different from shipping) |
| payment_method | VARCHAR(50) | | Payment type (card, paypal, etc.) |
| payment_status | VARCHAR(30) | CHECK (...), DEFAULT 'pending' | Payment state (pending, completed, failed, refunded) |
| notes | TEXT | | Customer order notes |
| idempotency_key | VARCHAR(255) | | Unique key preventing duplicate order creation |
| archive_status | VARCHAR(20) | CHECK (...), DEFAULT 'active' | Data lifecycle state for archival |
| archived_at | TIMESTAMP | | When order was moved to archive |
| created_at | TIMESTAMP | DEFAULT NOW() | Order placement timestamp |
| updated_at | TIMESTAMP | DEFAULT NOW() | Last status change timestamp |

**order_items** - Line items within an order (denormalized product info)
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Line item identifier |
| order_id | INTEGER | FK → orders(id) ON DELETE CASCADE | Parent order; items deleted with order |
| product_id | INTEGER | FK → products(id) ON DELETE SET NULL | Original product; preserved for history |
| product_title | VARCHAR(500) | NOT NULL | Snapshot of product title at purchase time |
| quantity | INTEGER | CHECK (quantity > 0), NOT NULL | Units purchased |
| price | DECIMAL(10,2) | NOT NULL | Unit price at purchase time |
| created_at | TIMESTAMP | DEFAULT NOW() | Line item creation timestamp |

**reviews** - Product reviews with verified purchase tracking
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Review identifier |
| product_id | INTEGER | FK → products(id) ON DELETE CASCADE | Reviewed product; reviews deleted with product |
| user_id | INTEGER | FK → users(id) ON DELETE SET NULL | Reviewer; preserved for review history |
| order_id | INTEGER | FK → orders(id) ON DELETE SET NULL | Originating order for verified purchase badge |
| rating | INTEGER | CHECK (1-5), NOT NULL | Star rating |
| title | VARCHAR(255) | | Review headline |
| content | TEXT | | Full review text |
| helpful_count | INTEGER | DEFAULT 0 | "Was this helpful?" vote count |
| verified_purchase | BOOLEAN | DEFAULT false | True if reviewer purchased via order_id |
| created_at | TIMESTAMP | DEFAULT NOW() | Review submission timestamp |
| updated_at | TIMESTAMP | DEFAULT NOW() | Last edit timestamp |

#### Recommendations Table

**product_recommendations** - Precomputed product relationships (composite key)
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| product_id | INTEGER | PK, FK → products(id) ON DELETE CASCADE | Source product |
| recommended_product_id | INTEGER | PK, FK → products(id) ON DELETE CASCADE | Suggested product |
| recommendation_type | VARCHAR(30) | PK, DEFAULT 'also_bought' | Algorithm type (also_bought, similar, etc.) |
| score | DECIMAL(5,4) | DEFAULT 0 | Relevance score (0.0000-1.0000) |
| updated_at | TIMESTAMP | DEFAULT NOW() | Last computation timestamp |

#### Observability & Resilience Tables

**idempotency_keys** - Prevents duplicate order/payment operations
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| key | VARCHAR(255) | PRIMARY KEY | Client-provided unique operation key |
| status | VARCHAR(20) | CHECK (...), DEFAULT 'processing' | Operation state (processing, completed, failed) |
| request_data | JSONB | | Original request payload for debugging |
| response | JSONB | | Cached response for duplicate requests |
| created_at | TIMESTAMP | DEFAULT NOW() | Key creation timestamp |
| completed_at | TIMESTAMP | | Operation completion timestamp |

**audit_logs** - Immutable event log for compliance and debugging
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Log entry identifier |
| created_at | TIMESTAMP | DEFAULT NOW() | Event timestamp |
| action | VARCHAR(100) | NOT NULL | Event type (order.created, payment.failed, etc.) |
| actor_id | INTEGER | | User/service performing action |
| actor_type | VARCHAR(20) | CHECK (...) | Actor category (user, admin, system, service) |
| resource_type | VARCHAR(50) | | Affected entity type (order, product, inventory) |
| resource_id | VARCHAR(100) | | Affected entity ID |
| old_value | JSONB | | State before change |
| new_value | JSONB | | State after change |
| ip_address | INET | | Request origin IP |
| user_agent | TEXT | | Client user agent string |
| correlation_id | UUID | | Request trace ID for distributed tracing |
| severity | VARCHAR(20) | CHECK (...), DEFAULT 'info' | Log level (info, warning, critical) |

**orders_archive** - Cold storage for old orders
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Archive entry identifier |
| order_id | INTEGER | NOT NULL | Original order ID |
| user_id | INTEGER | | Original customer ID |
| archive_data | JSONB | NOT NULL | Full order snapshot including items |
| created_at | TIMESTAMP | NOT NULL | Original order creation date |
| archived_at | TIMESTAMP | DEFAULT NOW() | When archived |

**search_logs** - Search analytics and debugging
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Log entry identifier |
| user_id | INTEGER | | Searcher (NULL if anonymous) |
| query | TEXT | | Search query string |
| filters | JSONB | | Applied facet filters |
| results_count | INTEGER | | Number of results returned |
| latency_ms | INTEGER | | Query execution time |
| engine | VARCHAR(20) | | Search backend (elasticsearch, postgres_fts) |
| created_at | TIMESTAMP | DEFAULT NOW() | Search timestamp |

### Foreign Key Relationships

| Parent Table | Child Table | FK Column | On Delete | Rationale |
|--------------|-------------|-----------|-----------|-----------|
| users | sellers | user_id | CASCADE | Seller profile is extension of user; no orphan profiles |
| users | sessions | user_id | CASCADE | Sessions meaningless without user; clean up on delete |
| users | cart_items | user_id | CASCADE | Cart belongs to user; clear on account deletion |
| users | orders | user_id | SET NULL | Preserve order history for accounting; anonymize user |
| users | reviews | user_id | SET NULL | Keep reviews for product ratings; show as "deleted user" |
| sellers | products | seller_id | CASCADE | Products belong to seller; remove if seller leaves platform |
| categories | categories | parent_id | SET NULL | Preserve child categories as root when parent deleted |
| categories | products | category_id | SET NULL | Keep products; they can be recategorized later |
| products | inventory | product_id | CASCADE | Inventory meaningless without product |
| products | cart_items | product_id | CASCADE | Remove from carts if product discontinued |
| products | order_items | product_id | SET NULL | Preserve order history; product_title is snapshot |
| products | reviews | product_id | CASCADE | Reviews are for specific product; remove together |
| products | product_recommendations | product_id | CASCADE | Recommendations are derived; recompute after delete |
| products | product_recommendations | recommended_product_id | CASCADE | Remove invalid recommendations |
| warehouses | inventory | warehouse_id | CASCADE | Inventory tied to location; redistribute before closing |
| orders | order_items | order_id | CASCADE | Items are part of order; delete together |
| orders | reviews | order_id | SET NULL | Keep review; just lose "verified purchase" link |

### Why Tables Are Structured This Way

#### 1. Separate `sellers` from `users`

**Decision**: Use a separate `sellers` table instead of embedding seller fields in `users`.

**Rationale**:
- **Role separation**: Most users are buyers, not sellers. Embedding seller fields wastes space and complicates queries.
- **Extensibility**: Seller-specific features (storefront settings, payout info, seller metrics) can grow independently.
- **Query optimization**: Product queries JOIN to sellers, not the larger users table.

#### 2. Hierarchical Categories with Self-Reference

**Decision**: `parent_id` references same table with `ON DELETE SET NULL`.

**Rationale**:
- **Unlimited depth**: Supports Electronics → Smartphones → Cases without schema changes.
- **Graceful deletion**: Deleting "Smartphones" promotes "Cases" to root level rather than orphaning.
- **Simple queries**: Recursive CTEs efficiently traverse hierarchy for breadcrumbs and navigation.

#### 3. Composite Key for Inventory

**Decision**: `(product_id, warehouse_id)` as PRIMARY KEY instead of separate `id`.

**Rationale**:
- **Natural uniqueness**: Each product exists once per warehouse by definition.
- **Efficient lookups**: Both lookup patterns (by product, by warehouse) use composite index.
- **No orphan rows**: CASCADE deletes ensure inventory always valid.

#### 4. Reserved Inventory Pattern

**Decision**: Track `quantity` and `reserved` separately rather than just available count.

**Rationale**:
- **Audit trail**: Can see both total stock and what's "locked" in carts.
- **Reservation cleanup**: Background job can release expired reservations without affecting real inventory.
- **Concurrency safety**: `reserved` can be incremented atomically during cart operations.

#### 5. Denormalized `product_title` in order_items

**Decision**: Store product title snapshot at purchase time.

**Rationale**:
- **Historical accuracy**: Order history shows what customer actually bought, not current product name.
- **Product deletion**: Orders remain meaningful even if product is discontinued (FK SET NULL).
- **Performance**: Order display doesn't require product table JOIN.

#### 6. JSONB for Addresses

**Decision**: Store addresses as JSONB instead of normalized address table.

**Rationale**:
- **One-time use**: Order addresses are historical snapshots, not reusable entities.
- **Flexibility**: International addresses have varying formats; JSONB adapts without schema changes.
- **Query simplicity**: No JOINs needed; address travels with order.

#### 7. Separate Orders and order_items

**Decision**: Classic order header/line item pattern rather than denormalized single table.

**Rationale**:
- **Normalization**: Order-level data (shipping, totals) stored once, not per item.
- **Item cardinality**: Orders can have 1-N items; array columns would be awkward.
- **Aggregation**: Easy to compute order totals, item counts, etc.

#### 8. Reviews Linked to Orders

**Decision**: Optional `order_id` FK enables "Verified Purchase" badge.

**Rationale**:
- **Trust signal**: Verified reviews carry more weight; reduces fake review spam.
- **Preservation**: `SET NULL` keeps review if order deleted (rare edge case).
- **Business logic**: Can enforce "only review if you bought" policy.

#### 9. Idempotency Keys for Order Safety

**Decision**: Dedicated table for idempotency rather than just order.idempotency_key.

**Rationale**:
- **Processing state**: Track in-flight requests to handle concurrent duplicates.
- **Response caching**: Return same response for duplicate requests.
- **Multi-resource**: Can protect any operation, not just orders.

#### 10. Immutable Audit Logs

**Decision**: INSERT-only table with no UPDATE/DELETE operations.

**Rationale**:
- **Compliance**: Financial regulations require tamper-evident logs.
- **Debugging**: Full history of who did what, when.
- **Correlation**: UUID links events across distributed services.

### Index Strategy

```sql
-- Product discovery (catalog browsing and filtering)
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_seller ON products(seller_id);
CREATE INDEX idx_products_price ON products(price);
CREATE INDEX idx_products_rating ON products(rating);
CREATE INDEX idx_products_active ON products(is_active);

-- Full-text search (PostgreSQL fallback when Elasticsearch unavailable)
CREATE INDEX idx_products_search ON products
  USING gin(to_tsvector('english', title || ' ' || COALESCE(description, '')));

-- Cart operations (user cart lookup, reservation expiry cleanup)
CREATE INDEX idx_cart_user ON cart_items(user_id);
CREATE INDEX idx_cart_reserved ON cart_items(reserved_until);

-- Order management (user order history, status filtering, archival)
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE INDEX idx_orders_idempotency ON orders(idempotency_key);
CREATE INDEX idx_orders_archive_status ON orders(archive_status);

-- Review display (product reviews, user review history)
CREATE INDEX idx_reviews_product ON reviews(product_id);
CREATE INDEX idx_reviews_user ON reviews(user_id);

-- Category navigation (tree traversal, URL routing)
CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE INDEX idx_categories_slug ON categories(slug);

-- Idempotency cleanup (expire old keys)
CREATE INDEX idx_idempotency_created ON idempotency_keys(created_at);
CREATE INDEX idx_idempotency_status ON idempotency_keys(status);

-- Audit log queries (time-based, actor investigation, resource history)
CREATE INDEX idx_audit_created ON audit_logs(created_at);
CREATE INDEX idx_audit_actor ON audit_logs(actor_id, actor_type);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_correlation ON audit_logs(correlation_id);

-- Archive lookups
CREATE INDEX idx_orders_archive_order ON orders_archive(order_id);
CREATE INDEX idx_orders_archive_user ON orders_archive(user_id);
CREATE INDEX idx_orders_archive_created ON orders_archive(created_at);

-- Search analytics
CREATE INDEX idx_search_logs_created ON search_logs(created_at);
CREATE INDEX idx_search_logs_user ON search_logs(user_id);
```

**Index Design Rationale**:

| Index | Query Pattern | Why This Index |
|-------|---------------|----------------|
| idx_products_category | `WHERE category_id = ?` | Category page listing |
| idx_products_price | `ORDER BY price` / `WHERE price BETWEEN` | Price filtering and sorting |
| idx_products_search | `to_tsvector(...) @@ plainto_tsquery(?)` | Fallback when Elasticsearch down |
| idx_cart_reserved | `WHERE reserved_until < NOW()` | Background job finds expired reservations |
| idx_orders_created | `WHERE created_at < ?` | Archival job finds old orders |
| idx_audit_correlation | `WHERE correlation_id = ?` | Trace single request across logs |

### Data Flow for Key Operations

#### 1. Add to Cart with Inventory Reservation

```sql
-- Step 1: Check available inventory (within transaction)
SELECT quantity - reserved AS available
FROM inventory
WHERE product_id = $1
FOR UPDATE;  -- Lock row to prevent race conditions

-- Step 2: Reserve inventory if sufficient
UPDATE inventory
SET reserved = reserved + $2
WHERE product_id = $1
  AND quantity - reserved >= $2;

-- Step 3: Create or update cart item
INSERT INTO cart_items (user_id, product_id, quantity, reserved_until)
VALUES ($3, $1, $2, NOW() + INTERVAL '30 minutes')
ON CONFLICT (user_id, product_id)
DO UPDATE SET
  quantity = cart_items.quantity + EXCLUDED.quantity,
  reserved_until = NOW() + INTERVAL '30 minutes';
```

#### 2. Checkout: Convert Cart to Order

```sql
-- Step 1: Check idempotency (prevent duplicate orders)
INSERT INTO idempotency_keys (key, status)
VALUES ($1, 'processing')
ON CONFLICT (key) DO NOTHING
RETURNING key;
-- If no row returned, check existing key status and return cached response

-- Step 2: Create order (within transaction)
INSERT INTO orders (user_id, subtotal, tax, shipping_cost, total,
                    shipping_address, payment_method, idempotency_key)
VALUES ($2, $3, $4, $5, $6, $7, $8, $1)
RETURNING id;

-- Step 3: Copy cart items to order items
INSERT INTO order_items (order_id, product_id, product_title, quantity, price)
SELECT $order_id, ci.product_id, p.title, ci.quantity, p.price
FROM cart_items ci
JOIN products p ON ci.product_id = p.id
WHERE ci.user_id = $2;

-- Step 4: Convert reserved to decremented (inventory commit)
UPDATE inventory i
SET quantity = quantity - ci.quantity,
    reserved = reserved - ci.quantity
FROM cart_items ci
WHERE i.product_id = ci.product_id
  AND ci.user_id = $2;

-- Step 5: Clear cart
DELETE FROM cart_items WHERE user_id = $2;

-- Step 6: Update idempotency key with result
UPDATE idempotency_keys
SET status = 'completed', response = $response, completed_at = NOW()
WHERE key = $1;
```

#### 3. Release Expired Cart Reservations (Background Job)

```sql
-- Step 1: Find and lock expired items
WITH expired AS (
  SELECT product_id, SUM(quantity) as total_quantity
  FROM cart_items
  WHERE reserved_until < NOW()
  GROUP BY product_id
  FOR UPDATE SKIP LOCKED
)
-- Step 2: Release reserved inventory
UPDATE inventory i
SET reserved = reserved - e.total_quantity
FROM expired e
WHERE i.product_id = e.product_id;

-- Step 3: Delete expired cart items
DELETE FROM cart_items
WHERE reserved_until < NOW();
```

#### 4. Product Search with Facets (Elasticsearch)

```javascript
// Elasticsearch query
{
  "query": {
    "bool": {
      "must": [{ "match": { "title": "wireless headphones" }}],
      "filter": [
        { "term": { "category": "electronics" }},
        { "range": { "price": { "gte": 50, "lte": 200 }}},
        { "term": { "in_stock": true }}
      ]
    }
  },
  "aggs": {
    "categories": { "terms": { "field": "category" }},
    "brands": { "terms": { "field": "brand" }},
    "price_ranges": {
      "range": {
        "field": "price",
        "ranges": [
          { "to": 25 }, { "from": 25, "to": 50 },
          { "from": 50, "to": 100 }, { "from": 100 }
        ]
      }
    }
  }
}
```

```sql
-- PostgreSQL fallback (when circuit breaker trips)
SELECT p.*, c.name as category_name
FROM products p
LEFT JOIN categories c ON p.category_id = c.id
WHERE p.is_active = true
  AND to_tsvector('english', p.title || ' ' || COALESCE(p.description, ''))
      @@ plainto_tsquery('english', $query)
  AND ($category_id IS NULL OR p.category_id = $category_id)
  AND p.price BETWEEN $min_price AND $max_price
ORDER BY ts_rank(to_tsvector('english', p.title), plainto_tsquery('english', $query)) DESC
LIMIT 20;
```

#### 5. Compute "Also Bought" Recommendations (Nightly Batch)

```sql
-- For each product, find co-purchased products
INSERT INTO product_recommendations (product_id, recommended_product_id, score, recommendation_type)
SELECT
  oi1.product_id,
  oi2.product_id,
  COUNT(*)::DECIMAL / (
    SELECT COUNT(DISTINCT order_id) FROM order_items WHERE product_id = oi1.product_id
  ) as score,
  'also_bought'
FROM order_items oi1
JOIN order_items oi2 ON oi1.order_id = oi2.order_id
WHERE oi1.product_id != oi2.product_id
  AND oi1.product_id = $target_product_id
GROUP BY oi1.product_id, oi2.product_id
ORDER BY COUNT(*) DESC
LIMIT 20
ON CONFLICT (product_id, recommended_product_id, recommendation_type)
DO UPDATE SET score = EXCLUDED.score, updated_at = NOW();
```

#### 6. Archive Old Orders (Weekly Batch)

```sql
-- Step 1: Select orders for archival
WITH orders_to_archive AS (
  SELECT o.id, o.user_id, o.created_at,
         jsonb_build_object(
           'order', row_to_json(o),
           'items', (SELECT jsonb_agg(row_to_json(oi))
                     FROM order_items oi WHERE oi.order_id = o.id)
         ) as archive_data
  FROM orders o
  WHERE o.created_at < NOW() - INTERVAL '2 years'
    AND o.status IN ('delivered', 'cancelled', 'refunded')
    AND o.archive_status = 'active'
  LIMIT 1000
  FOR UPDATE SKIP LOCKED
)
-- Step 2: Insert into archive table
INSERT INTO orders_archive (order_id, user_id, archive_data, created_at)
SELECT id, user_id, archive_data, created_at
FROM orders_to_archive;

-- Step 3: Anonymize original order (keep for reference, remove PII)
UPDATE orders
SET archive_status = 'archived',
    archived_at = NOW(),
    shipping_address = '{"anonymized": true}'::jsonb,
    billing_address = NULL,
    notes = NULL
WHERE id IN (SELECT id FROM orders_to_archive);
```

---

## Key Design Decisions

### 1. Reserved Inventory Model

**Decision**: Track reserved quantity separately from available

**Rationale**:
- Prevents overselling during checkout
- Allows cart expiration without order
- Clear separation of concerns

### 2. Elasticsearch for Search

**Decision**: Separate search index from PostgreSQL

**Rationale**:
- Full-text search with relevance scoring
- Faceted filtering (aggregations)
- Better performance than LIKE queries

### 3. Precomputed Recommendations

**Decision**: Batch compute "also bought" nightly

**Rationale**:
- Expensive to compute on-demand
- Recommendations don't need real-time freshness
- Cache in Valkey for fast retrieval

---

## Trade-offs Summary

| Decision | Chosen | Alternative | Reason |
|----------|--------|-------------|--------|
| Inventory | Reserved model | Decrement on add | Prevent overselling |
| Search | Elasticsearch | PostgreSQL FTS | Performance, facets |
| Recommendations | Batch precompute | Real-time ML | Simplicity, cost |
| Cart | Database + cache | Cache only | Durability |

---

## Observability

### Metrics Collection

**Key Service Metrics (Prometheus format):**
```javascript
// Express middleware for request metrics
const promClient = require('prom-client');

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
});

const inventoryReservations = new promClient.Counter({
  name: 'inventory_reservations_total',
  help: 'Total inventory reservation attempts',
  labelNames: ['product_id', 'status'] // status: success, insufficient, error
});

const cartAbandonments = new promClient.Counter({
  name: 'cart_abandonments_total',
  help: 'Carts expired due to reservation timeout'
});

const orderValue = new promClient.Histogram({
  name: 'order_value_dollars',
  help: 'Distribution of order values',
  buckets: [10, 25, 50, 100, 250, 500, 1000]
});

const searchLatency = new promClient.Histogram({
  name: 'search_latency_seconds',
  help: 'Elasticsearch query latency',
  labelNames: ['query_type'], // faceted, simple, autocomplete
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5]
});
```

**Database and Infrastructure Metrics:**
```javascript
// PostgreSQL connection pool metrics
const pgPoolMetrics = {
  pg_pool_total_connections: 'Total connections in pool',
  pg_pool_idle_connections: 'Idle connections available',
  pg_pool_waiting_queries: 'Queries waiting for connection'
};

// Valkey/Redis metrics
const valkeyMetrics = {
  valkey_connected_clients: 'Current client connections',
  valkey_memory_used_bytes: 'Memory consumption',
  valkey_cache_hits_total: 'Cache hit count',
  valkey_cache_misses_total: 'Cache miss count'
};

// Kafka consumer metrics
const kafkaMetrics = {
  kafka_consumer_lag: 'Messages behind latest offset',
  kafka_messages_consumed_total: 'Messages processed',
  kafka_consumer_errors_total: 'Processing errors'
};
```

### Structured Logging

**Log Format (JSON for parsing):**
```javascript
const logger = require('pino')({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label })
  }
});

// Request logging with correlation IDs
app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
  req.log = logger.child({
    correlationId: req.correlationId,
    userId: req.session?.userId,
    method: req.method,
    path: req.path
  });
  next();
});

// Example log entries
req.log.info({ productId: 123, quantity: 2 }, 'Adding to cart');
req.log.warn({ productId: 123, available: 1, requested: 5 }, 'Insufficient inventory');
req.log.error({ err, orderId: 456 }, 'Payment processing failed');
```

**Log Levels by Environment:**
| Level | Local Dev | Staging | Production |
|-------|-----------|---------|------------|
| debug | Yes | Yes | No |
| info | Yes | Yes | Yes |
| warn | Yes | Yes | Yes |
| error | Yes | Yes | Yes |

### Distributed Tracing

**OpenTelemetry Setup (local with Jaeger):**
```javascript
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');
const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');

const provider = new NodeTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(
  new JaegerExporter({
    endpoint: 'http://localhost:14268/api/traces'
  })
));
provider.register();

// Trace a checkout flow
const tracer = trace.getTracer('checkout-service');

async function checkout(userId, cartId) {
  return tracer.startActiveSpan('checkout', async (span) => {
    span.setAttribute('user.id', userId);
    span.setAttribute('cart.id', cartId);

    await tracer.startActiveSpan('validate-inventory', async (child) => {
      // Inventory validation
      child.end();
    });

    await tracer.startActiveSpan('process-payment', async (child) => {
      // Payment processing
      child.end();
    });

    span.end();
  });
}
```

### SLI Dashboards

**Key SLIs and Thresholds:**

| SLI | Target | Warning | Critical | Measurement |
|-----|--------|---------|----------|-------------|
| Search p99 latency | < 100ms | > 150ms | > 300ms | `histogram_quantile(0.99, search_latency_seconds)` |
| Checkout success rate | > 99% | < 98% | < 95% | `sum(checkout_success) / sum(checkout_attempts)` |
| Inventory accuracy | 100% | < 99.9% | < 99% | `1 - (oversells / total_orders)` |
| API availability | 99.9% | < 99.5% | < 99% | `1 - (5xx_errors / total_requests)` |
| Cart reservation success | > 95% | < 90% | < 80% | `reservations_success / reservations_total` |

**Grafana Dashboard Panels (local setup):**
```yaml
# docker-compose.yml addition
grafana:
  image: grafana/grafana:10.0
  ports:
    - "3000:3000"
  volumes:
    - ./grafana/dashboards:/var/lib/grafana/dashboards
  environment:
    - GF_SECURITY_ADMIN_PASSWORD=admin

prometheus:
  image: prom/prometheus:v2.45
  ports:
    - "9090:9090"
  volumes:
    - ./prometheus.yml:/etc/prometheus/prometheus.yml
```

### Alert Thresholds

**Alert Rules (Prometheus AlertManager):**
```yaml
groups:
  - name: amazon-ecommerce
    rules:
      - alert: HighSearchLatency
        expr: histogram_quantile(0.99, rate(search_latency_seconds_bucket[5m])) > 0.3
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Search p99 latency above 300ms"

      - alert: InventoryOversell
        expr: increase(inventory_oversell_total[1h]) > 0
        labels:
          severity: critical
        annotations:
          summary: "Inventory oversell detected"

      - alert: HighCartAbandonment
        expr: rate(cart_abandonments_total[1h]) > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High cart abandonment rate"

      - alert: KafkaConsumerLag
        expr: kafka_consumer_lag > 10000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Kafka consumer falling behind"

      - alert: DatabaseConnectionPoolExhausted
        expr: pg_pool_waiting_queries > 10
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Database connection pool exhausted"
```

### Audit Logging

**Audit Events Schema:**
```sql
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT NOW(),
  actor_id INTEGER,           -- User or system ID
  actor_type VARCHAR(20),     -- 'user', 'admin', 'system'
  action VARCHAR(50) NOT NULL,
  resource_type VARCHAR(50),  -- 'order', 'product', 'inventory'
  resource_id VARCHAR(100),
  old_value JSONB,
  new_value JSONB,
  ip_address INET,
  user_agent TEXT,
  correlation_id UUID
);

CREATE INDEX idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_audit_actor ON audit_logs(actor_id, actor_type);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);
```

**Audit Events to Capture:**
```javascript
const auditEvents = {
  // Order lifecycle
  'order.created': { resource: 'order', severity: 'info' },
  'order.cancelled': { resource: 'order', severity: 'info' },
  'order.refunded': { resource: 'order', severity: 'warning' },

  // Inventory changes
  'inventory.adjusted': { resource: 'inventory', severity: 'warning' },
  'inventory.reserved': { resource: 'inventory', severity: 'info' },
  'inventory.released': { resource: 'inventory', severity: 'info' },

  // Admin actions
  'product.price_changed': { resource: 'product', severity: 'warning' },
  'product.deleted': { resource: 'product', severity: 'critical' },
  'seller.suspended': { resource: 'seller', severity: 'critical' }
};

async function logAudit(event, actor, resource, changes) {
  await db('audit_logs').insert({
    actor_id: actor.id,
    actor_type: actor.type,
    action: event,
    resource_type: resource.type,
    resource_id: resource.id,
    old_value: changes.old,
    new_value: changes.new,
    ip_address: actor.ip,
    correlation_id: actor.correlationId
  });
}
```

---

## Failure Handling

### Retry Strategy with Idempotency Keys

**Idempotency for Order Creation:**
```javascript
// Client generates idempotency key before checkout
const idempotencyKey = `order-${userId}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;

// Server-side handling
async function createOrder(idempotencyKey, orderData) {
  // Check if order already exists for this key
  const existing = await db('orders')
    .where({ idempotency_key: idempotencyKey })
    .first();

  if (existing) {
    // Return cached response
    return existing;
  }

  // Create order with idempotency key
  return await db.transaction(async (trx) => {
    const order = await trx('orders').insert({
      ...orderData,
      idempotency_key: idempotencyKey
    }).returning('*');

    return order[0];
  });
}

// Schema addition
ALTER TABLE orders ADD COLUMN idempotency_key VARCHAR(100) UNIQUE;
CREATE INDEX idx_orders_idempotency ON orders(idempotency_key);
```

**Exponential Backoff for External Services:**
```javascript
async function withRetry(fn, options = {}) {
  const {
    maxAttempts = 3,
    baseDelay = 100,
    maxDelay = 5000,
    factor = 2,
    retryOn = (err) => err.code === 'ECONNRESET' || err.status >= 500
  } = options;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts || !retryOn(err)) {
        throw err;
      }
      const delay = Math.min(baseDelay * Math.pow(factor, attempt - 1), maxDelay);
      const jitter = delay * (0.5 + Math.random() * 0.5);
      await new Promise(resolve => setTimeout(resolve, jitter));
    }
  }
  throw lastError;
}

// Usage for payment service
const paymentResult = await withRetry(
  () => paymentGateway.charge(orderId, amount),
  { maxAttempts: 3, baseDelay: 200 }
);
```

### Circuit Breakers

**Circuit Breaker Implementation:**
```javascript
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 2;
    this.timeout = options.timeout || 30000; // 30 seconds
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
  }

  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  onSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.successThreshold) {
        this.state = 'CLOSED';
        this.failures = 0;
        this.successes = 0;
      }
    } else {
      this.failures = 0;
    }
  }

  onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }
}

// Circuit breakers per external service
const circuitBreakers = {
  elasticsearch: new CircuitBreaker({ failureThreshold: 3, timeout: 10000 }),
  paymentGateway: new CircuitBreaker({ failureThreshold: 5, timeout: 60000 }),
  recommendationService: new CircuitBreaker({ failureThreshold: 3, timeout: 5000 })
};

// Usage
async function searchProducts(query) {
  try {
    return await circuitBreakers.elasticsearch.execute(
      () => es.search({ index: 'products', body: query })
    );
  } catch (err) {
    if (err.message === 'Circuit breaker is OPEN') {
      // Fallback to PostgreSQL full-text search
      return await pgFallbackSearch(query);
    }
    throw err;
  }
}
```

**Circuit Breaker Metrics:**
```javascript
const circuitBreakerState = new promClient.Gauge({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
  labelNames: ['service']
});

// Update on state change
circuitBreakers.elasticsearch.onStateChange = (newState) => {
  const stateValue = { 'CLOSED': 0, 'HALF_OPEN': 1, 'OPEN': 2 };
  circuitBreakerState.set({ service: 'elasticsearch' }, stateValue[newState]);
};
```

### Multi-Region Disaster Recovery (Conceptual for Local Learning)

**Local Simulation of Multi-Region:**
```yaml
# docker-compose.yml - Simulate two "regions"
services:
  postgres-primary:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: amazon_primary

  postgres-replica:
    image: postgres:16
    ports:
      - "5433:5432"
    environment:
      POSTGRES_DB: amazon_replica
    # In production: configure streaming replication

  valkey-primary:
    image: valkey/valkey:7
    ports:
      - "6379:6379"

  valkey-replica:
    image: valkey/valkey:7
    ports:
      - "6380:6379"
    command: valkey-server --replicaof valkey-primary 6379
```

**Failover Strategy:**
```javascript
class DatabaseClient {
  constructor() {
    this.primary = new Pool({ connectionString: process.env.DATABASE_PRIMARY_URL });
    this.replica = new Pool({ connectionString: process.env.DATABASE_REPLICA_URL });
    this.usePrimary = true;
  }

  async query(sql, params, options = {}) {
    const { readOnly = false } = options;

    // Writes always go to primary
    if (!readOnly) {
      return this.primary.query(sql, params);
    }

    // Reads can go to replica
    try {
      if (this.usePrimary) {
        return await this.primary.query(sql, params);
      } else {
        return await this.replica.query(sql, params);
      }
    } catch (err) {
      if (this.usePrimary) {
        // Failover to replica for reads
        console.warn('Primary failed, failing over to replica for reads');
        this.usePrimary = false;
        return await this.replica.query(sql, params);
      }
      throw err;
    }
  }

  async healthCheck() {
    try {
      await this.primary.query('SELECT 1');
      this.usePrimary = true;
    } catch {
      console.warn('Primary database unhealthy');
    }
  }
}
```

### Backup and Restore Testing

**Backup Scripts:**
```bash
#!/bin/bash
# scripts/backup-database.sh
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./backups"

# PostgreSQL backup
pg_dump -h localhost -U postgres amazon_db \
  --format=custom \
  --file="${BACKUP_DIR}/amazon_db_${TIMESTAMP}.dump"

# Elasticsearch snapshot (requires snapshot repository configured)
curl -X PUT "localhost:9200/_snapshot/backups/snapshot_${TIMESTAMP}" \
  -H 'Content-Type: application/json' \
  -d '{"indices": "products", "include_global_state": false}'

# Valkey RDB snapshot
docker exec amazon-valkey valkey-cli BGSAVE
docker cp amazon-valkey:/data/dump.rdb "${BACKUP_DIR}/valkey_${TIMESTAMP}.rdb"

echo "Backup completed: ${TIMESTAMP}"
```

**Restore Testing Procedure:**
```bash
#!/bin/bash
# scripts/test-restore.sh
BACKUP_FILE=$1

echo "=== Restore Test Started ==="

# 1. Create test database
createdb -h localhost -U postgres amazon_restore_test

# 2. Restore backup
pg_restore -h localhost -U postgres -d amazon_restore_test "${BACKUP_FILE}"

# 3. Verify data integrity
psql -h localhost -U postgres -d amazon_restore_test -c "
  SELECT 'products' as table_name, COUNT(*) as count FROM products
  UNION ALL
  SELECT 'orders', COUNT(*) FROM orders
  UNION ALL
  SELECT 'inventory', COUNT(*) FROM inventory;
"

# 4. Run sample queries to verify relationships
psql -h localhost -U postgres -d amazon_restore_test -c "
  SELECT COUNT(*) as orders_with_items
  FROM orders o
  JOIN order_items oi ON o.id = oi.order_id;
"

# 5. Cleanup
dropdb -h localhost -U postgres amazon_restore_test

echo "=== Restore Test Completed ==="
```

**Backup Schedule (for reference):**
| Data Type | Frequency | Retention | Storage |
|-----------|-----------|-----------|---------|
| PostgreSQL full | Daily | 30 days | Local + S3 |
| PostgreSQL WAL | Continuous | 7 days | Local |
| Elasticsearch snapshots | Daily | 14 days | S3 |
| Valkey RDB | Hourly | 24 hours | Local |

---

## Data Lifecycle Policies

### Retention and TTL Policies

**Data Retention Rules:**
```sql
-- Orders: Keep for 7 years (legal requirement)
-- After 7 years, anonymize and archive

-- Cart items: Auto-expire after 30 minutes (reservation)
-- Already handled by reserved_until column

-- Session data: 24-hour TTL in Valkey
-- Search logs: 90-day retention
-- Audit logs: 3-year retention

-- Add retention metadata
ALTER TABLE orders ADD COLUMN archived_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN retention_expires_at TIMESTAMP
  GENERATED ALWAYS AS (created_at + INTERVAL '7 years') STORED;
```

**TTL Implementation:**
```javascript
// Valkey TTL for various data types
const ttlPolicies = {
  session: 86400,           // 24 hours
  cartReservation: 1800,    // 30 minutes
  productCache: 3600,       // 1 hour
  recommendations: 86400,   // 24 hours
  searchResults: 300,       // 5 minutes
  rateLimit: 60            // 1 minute
};

// Set with TTL
await valkey.setex(`session:${sessionId}`, ttlPolicies.session, sessionData);
await valkey.setex(`product:${productId}`, ttlPolicies.productCache, productData);
```

**Automated Cleanup Jobs:**
```javascript
// Run daily: Clean up expired data
const cleanupJobs = [
  {
    name: 'expired-cart-reservations',
    schedule: '*/5 * * * *', // Every 5 minutes
    async run() {
      const result = await db('cart_items')
        .where('reserved_until', '<', new Date())
        .delete();
      logger.info({ count: result }, 'Cleaned expired cart reservations');
    }
  },
  {
    name: 'old-search-logs',
    schedule: '0 2 * * *', // Daily at 2 AM
    async run() {
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const result = await db('search_logs')
        .where('created_at', '<', cutoff)
        .delete();
      logger.info({ count: result }, 'Cleaned old search logs');
    }
  },
  {
    name: 'archive-old-orders',
    schedule: '0 3 * * 0', // Weekly on Sunday at 3 AM
    async run() {
      // Archive orders older than 2 years to cold storage
      const cutoff = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);
      await archiveOrdersToColdStorage(cutoff);
    }
  }
];
```

### Archival to Cold Storage

**Archive Strategy:**
```javascript
// Archive old orders to MinIO (S3-compatible)
async function archiveOrdersToColdStorage(beforeDate) {
  const batchSize = 1000;
  let archived = 0;

  while (true) {
    const orders = await db('orders')
      .where('created_at', '<', beforeDate)
      .whereNull('archived_at')
      .limit(batchSize);

    if (orders.length === 0) break;

    // Export to JSON Lines format
    const archiveData = orders.map(order => JSON.stringify(order)).join('\n');
    const archiveKey = `orders/archive/${beforeDate.toISOString().slice(0, 7)}/${Date.now()}.jsonl`;

    // Upload to MinIO
    await minioClient.putObject(
      'amazon-archive',
      archiveKey,
      archiveData,
      { 'Content-Type': 'application/x-ndjson' }
    );

    // Mark as archived (keep minimal reference in DB)
    const orderIds = orders.map(o => o.id);
    await db('orders')
      .whereIn('id', orderIds)
      .update({
        archived_at: new Date(),
        shipping_address: null,  // Remove PII from hot storage
        archived_location: archiveKey
      });

    archived += orders.length;
    logger.info({ archived, batch: orders.length }, 'Archived orders batch');
  }

  return archived;
}
```

**Archive Schema:**
```sql
-- Add archive tracking columns
ALTER TABLE orders ADD COLUMN archived_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN archived_location VARCHAR(500);

-- Partitioning for older data (optional, for learning)
CREATE TABLE orders_archive (
  LIKE orders INCLUDING ALL
) PARTITION BY RANGE (created_at);

CREATE TABLE orders_archive_2023 PARTITION OF orders_archive
  FOR VALUES FROM ('2023-01-01') TO ('2024-01-01');
```

### Backfill and Replay Procedures

**Elasticsearch Reindex from PostgreSQL:**
```javascript
// Full reindex when Elasticsearch data is stale or corrupted
async function reindexProducts() {
  const batchSize = 500;
  let offset = 0;
  let indexed = 0;

  // Create new index with timestamp
  const newIndex = `products_${Date.now()}`;
  await es.indices.create({
    index: newIndex,
    body: {
      mappings: productMappings,
      settings: productSettings
    }
  });

  while (true) {
    const products = await db('products')
      .join('inventory', 'products.id', 'inventory.product_id')
      .select('products.*', db.raw('SUM(inventory.quantity - inventory.reserved) as available'))
      .groupBy('products.id')
      .offset(offset)
      .limit(batchSize);

    if (products.length === 0) break;

    const bulkBody = products.flatMap(product => [
      { index: { _index: newIndex, _id: product.id } },
      {
        title: product.title,
        description: product.description,
        category: product.category_id,
        price: product.price,
        rating: product.rating,
        in_stock: product.available > 0
      }
    ]);

    await es.bulk({ body: bulkBody });

    offset += batchSize;
    indexed += products.length;
    logger.info({ indexed }, 'Reindex progress');
  }

  // Atomic swap using alias
  await es.indices.updateAliases({
    body: {
      actions: [
        { remove: { index: 'products_*', alias: 'products' } },
        { add: { index: newIndex, alias: 'products' } }
      ]
    }
  });

  logger.info({ totalIndexed: indexed }, 'Reindex completed');
}
```

**Kafka Message Replay:**
```javascript
// Replay events from a specific offset for recovery
async function replayOrderEvents(fromTimestamp) {
  const admin = kafka.admin();
  await admin.connect();

  // Get partition offsets for timestamp
  const offsets = await admin.fetchTopicOffsetsByTimestamp('order-events', fromTimestamp);

  // Reset consumer group to those offsets
  await admin.setOffsets({
    groupId: 'order-processor',
    topic: 'order-events',
    partitions: offsets.map(o => ({
      partition: o.partition,
      offset: o.offset
    }))
  });

  logger.info({ fromTimestamp, offsets }, 'Consumer offsets reset for replay');
  await admin.disconnect();

  // Consumer will replay from new offsets on restart
}

// Replay recommendations calculation
async function replayRecommendations(fromDate) {
  logger.info({ fromDate }, 'Starting recommendations replay');

  // Get all orders since fromDate
  const orders = await db('orders')
    .where('created_at', '>=', fromDate)
    .select('id');

  // Recompute "also bought" for affected products
  const affectedProducts = await db('order_items')
    .whereIn('order_id', orders.map(o => o.id))
    .distinct('product_id');

  for (const { product_id } of affectedProducts) {
    await updateProductRecommendations(product_id);
  }

  logger.info({ productsUpdated: affectedProducts.length }, 'Recommendations replay completed');
}
```

**Backfill Checklist:**
```markdown
## Backfill Runbook

### Before Backfill
- [ ] Notify team of upcoming backfill
- [ ] Check system load (avoid peak hours)
- [ ] Verify source data integrity
- [ ] Create backup of target data

### During Backfill
- [ ] Monitor memory/CPU usage
- [ ] Watch for replication lag
- [ ] Check error logs every 15 minutes
- [ ] Track progress metrics

### After Backfill
- [ ] Verify record counts match
- [ ] Spot-check random samples
- [ ] Run integration tests
- [ ] Update documentation with timestamp
```

---

## Implementation Notes

This section documents the rationale behind key resilience and observability features implemented in the backend codebase.

### Why Idempotency Prevents Duplicate Orders and Charges

**Problem Statement:**
In e-commerce, duplicate orders are a critical failure mode. They can occur from:
- Network timeouts causing client retries
- Users double-clicking the "Place Order" button
- Mobile apps retrying on connection drops
- Load balancer failovers mid-request

Each duplicate order means:
- Customer charged multiple times
- Inventory decremented incorrectly
- Fulfillment confusion and shipping costs
- Customer trust erosion and support burden

**Solution: Idempotency Keys**

The implementation uses a client-provided `Idempotency-Key` header to ensure exactly-once order creation:

```javascript
// Client sends unique key with checkout request
POST /api/orders
Headers: { "Idempotency-Key": "order-user123-1705432800000-abc123" }

// Server flow:
// 1. Check Redis for existing key
// 2. If found with status='completed', return cached response
// 3. If not found, create record with status='processing'
// 4. Process order
// 5. Update record with status='completed' and response
```

**Why This Works:**
- **Atomicity**: Redis `SETNX` ensures only one request "wins" the race
- **Durability**: PostgreSQL backup ensures keys survive Redis failures
- **Fast Lookups**: Redis provides sub-millisecond duplicate detection
- **Graceful Retries**: Failed requests (status='failed') allow retries with same key

**Key Design Decisions:**
1. **24-hour TTL**: Balances storage costs against legitimate retry windows
2. **Processing state**: Handles concurrent requests gracefully (returns 409 Conflict)
3. **PostgreSQL fallback**: Ensures durability if Redis is temporarily unavailable

See: `/backend/src/shared/idempotency.js`

---

### Why Circuit Breakers Protect Checkout Flow

**Problem Statement:**
E-commerce checkout depends on external services:
- Payment gateways (Stripe, PayPal)
- Inventory systems
- Tax calculation services
- Fraud detection

When these services fail, naive retry logic causes:
- **Cascade failures**: Overwhelmed services fail faster
- **Resource exhaustion**: Threads/connections blocked waiting
- **User frustration**: Slow failures are worse than fast failures

**Solution: Circuit Breaker Pattern**

```
CLOSED (normal) ──failures exceed threshold──> OPEN (fail fast)
     ↑                                              │
     │                                              │ timeout expires
     │                                              ▼
     └────successes exceed threshold───── HALF-OPEN (test)
```

**Implementation Details:**

```javascript
// Payment circuit breaker configuration
const paymentCircuitBreakerOptions = {
  timeout: 30000,           // Payment can take longer
  errorThresholdPercentage: 30,  // Trip faster for payment (critical)
  resetTimeout: 60000,      // Wait longer before retrying
  volumeThreshold: 3        // Trip after fewer failures
};

// Usage in checkout
const paymentBreaker = createPaymentCircuitBreaker(processPayment, paymentFallback);
const result = await paymentBreaker.fire(order, paymentDetails);
```

**Why This Works:**
- **Fast Failure**: Open circuit returns immediately (no waiting)
- **Automatic Recovery**: Half-open state tests if service recovered
- **Fallback Support**: Graceful degradation (queue for later, use backup gateway)
- **Metrics**: Circuit state exposed to Prometheus for alerting

**Service-Specific Configurations:**
| Service | Timeout | Error Threshold | Reset Timeout |
|---------|---------|-----------------|---------------|
| Payment Gateway | 30s | 30% | 60s |
| Inventory | 5s | 50% | 15s |
| Elasticsearch | 5s | 60% | 10s |

See: `/backend/src/shared/circuitBreaker.js`

---

### Why Audit Logging Enables Order Dispute Resolution

**Problem Statement:**
E-commerce disputes require answering questions like:
- "Did the customer actually place this order?"
- "When was the order cancelled, and by whom?"
- "What was the original price before the refund?"
- "Was this a valid refund or potential fraud?"

Without audit logs, resolving disputes requires:
- Guessing from database state
- Asking customers to prove claims
- Legal liability exposure

**Solution: Immutable Audit Trail**

Every order/payment operation creates an audit record:

```javascript
await createAuditLog({
  action: 'order.created',
  actor: { id: userId, type: 'user' },
  resource: { type: 'order', id: orderId },
  changes: {
    new: { total: 149.99, items: [...] }
  },
  context: { ip: '192.168.1.1', correlationId: 'uuid' }
});
```

**Audit Events Captured:**
| Event | Severity | Use Case |
|-------|----------|----------|
| order.created | info | Proof of purchase |
| order.cancelled | warning | Cancellation disputes |
| order.refunded | critical | Fraud investigation |
| payment.completed | info | Payment verification |
| payment.failed | warning | Debugging failures |
| inventory.adjusted | warning | Stock discrepancy investigation |
| admin.* | critical | Admin action accountability |

**Query Capabilities:**
```javascript
// Get complete order history for dispute resolution
const trail = await getOrderAuditTrail(orderId);
// Returns chronological list of all events for this order

// Find all actions by a user (fraud investigation)
const logs = await queryAuditLogs({
  actorId: userId,
  startDate: '2024-01-01',
  severity: 'critical'
});
```

**Why This Works:**
- **Immutability**: INSERT-only table, never UPDATE/DELETE
- **Correlation IDs**: Link related events across services
- **IP/User Agent**: Identify suspicious patterns
- **Old/New Values**: Full before/after state for reversibility

See: `/backend/src/shared/audit.js`

---

### Why Order Archival Balances History vs Storage Costs

**Problem Statement:**
E-commerce generates massive order data:
- 1M orders/day = 365M orders/year
- Each order has items, addresses, payment details
- Legal requirement: Keep 7 years (2.5B+ orders)

Keeping all data in PostgreSQL causes:
- **Storage costs**: Terabytes of expensive SSD storage
- **Query performance**: Indexes become huge, queries slow
- **Backup time**: Full backups take hours
- **Migration risk**: Schema changes on billion-row tables are dangerous

**Solution: Tiered Storage with Lifecycle Policies**

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  HOT STORAGE    │ ──> │  WARM STORAGE   │ ──> │  COLD STORAGE   │
│  PostgreSQL     │     │  orders_archive │     │  MinIO/S3       │
│  < 2 years      │     │  2-7 years      │     │  > 7 years      │
│  Full queries   │     │  JSONB blob     │     │  Anonymized     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

**Retention Policies:**

```javascript
const RetentionPolicies = {
  ORDERS: {
    hotStorageDays: 730,        // 2 years in PostgreSQL
    archiveRetentionDays: 2555, // 7 years total
    anonymizeAfterDays: 2555    // Remove PII after 7 years
  },
  CART_ITEMS: {
    reservationMinutes: 30      // Short-lived
  },
  AUDIT_LOGS: {
    hotStorageDays: 365,        // 1 year queryable
    archiveRetentionDays: 1095  // 3 years total
  }
};
```

**Archival Process:**
1. **Identify**: Find orders older than 2 years with completed/cancelled status
2. **Export**: Serialize full order with items to JSONB
3. **Store**: Insert into `orders_archive` table
4. **Clean**: Remove PII from original order (shipping address, notes)
5. **Mark**: Set `archive_status = 'archived'`

**Why This Works:**
- **Query Performance**: Hot storage stays small and fast
- **Cost Efficiency**: Cold storage is 10x cheaper per GB
- **Legal Compliance**: 7-year retention maintained
- **Privacy Compliance**: GDPR/CCPA anonymization after retention period
- **Recoverability**: Archived data retrievable for disputes

**Automated Jobs:**
```javascript
// Run daily at 3 AM
setInterval(runArchivalJobs, 24 * 60 * 60 * 1000);

// Jobs run:
// - cleanupExpiredCartItems (every 5 minutes)
// - cleanupIdempotencyKeys (hourly)
// - archiveOrders (daily)
// - anonymizeOldOrders (daily)
```

See: `/backend/src/shared/archival.js`

---

### Observability Stack Summary

The implementation provides three pillars of observability:

**1. Metrics (Prometheus)**
- Endpoint: `GET /metrics`
- Key metrics: `orders_total`, `order_value_dollars`, `circuit_breaker_state`
- Dashboards: Order rates, payment success, search latency

**2. Logging (Pino JSON)**
- Structured JSON format for log aggregation
- Correlation IDs for request tracing
- Log levels: debug/info/warn/error

**3. Health Checks**
- `GET /api/health` - Simple liveness
- `GET /api/health/detailed` - Full service status
- `GET /api/health/ready` - Kubernetes readiness probe

**Files Added:**
```
backend/src/shared/
├── logger.js          # Pino structured logging
├── metrics.js         # Prometheus metrics
├── circuitBreaker.js  # Opossum circuit breakers
├── retry.js           # Exponential backoff
├── idempotency.js     # Duplicate order prevention
├── audit.js           # Order/payment audit trail
└── archival.js        # Data lifecycle management
```
