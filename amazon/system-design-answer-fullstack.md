# Amazon E-Commerce Platform - System Design Answer (Fullstack Focus)

*45-minute system design interview format - Fullstack Engineer Position*

## Opening Statement

"Today I'll design an e-commerce platform like Amazon, focusing on end-to-end flows that span frontend and backend. The key technical challenges are building a responsive shopping experience with real-time inventory feedback, implementing a robust checkout flow that prevents overselling while maintaining excellent UX, and creating a search experience with faceted filtering that stays fast at scale. I'll walk through how these components integrate across the stack."

---

## Step 1: Requirements Clarification (3 minutes)

### Functional Requirements

1. **Product Discovery**: Search with faceted filtering, category browsing
2. **Shopping Cart**: Add/remove items with real-time inventory feedback
3. **Checkout Flow**: Multi-step process with payment integration
4. **Order Tracking**: View order history and status updates
5. **Recommendations**: "Also bought" suggestions on product pages

### Non-Functional Requirements

- **Availability**: 99.99% for browsing and cart operations
- **Consistency**: Strong consistency for inventory (no overselling)
- **Latency**: < 100ms for API responses, < 50ms for UI updates
- **Scale**: 100M products, 1M orders/day, 500K concurrent users

### End-to-End Scale Estimates

| Operation | Volume | E2E Latency Target |
|-----------|--------|-------------------|
| Product search | 100K QPS | < 300ms total |
| Add to cart | 10K QPS | < 200ms total |
| Checkout | 1K QPS | < 2s total |
| Page load | 500K concurrent | < 1s TTI |

---

## Step 2: High-Level Architecture (7 minutes)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND LAYER                                 │
│    React + TanStack Router + Zustand + TanStack Query                   │
├─────────────────────────────────────────────────────────────────────────┤
│  Product Search  │  Product Detail  │  Shopping Cart  │  Checkout Flow  │
│  - Faceted UI    │  - Image gallery │  - Cart sidebar │  - Multi-step   │
│  - Virtualized   │  - Recommendations  - Quantity      │  - Payment      │
│  - Infinite      │  - Reviews       │  - Inventory    │  - Confirmation │
└────────┬─────────┴────────┬─────────┴────────┬────────┴────────┬────────┘
         │                  │                  │                 │
         ▼                  ▼                  ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           API GATEWAY                                    │
│                    Rate Limiting + Auth + CORS                          │
└────────┬─────────────────┬─────────────────┬────────────────────────────┘
         │                 │                 │
         ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Catalog Service │ │  Cart Service   │ │  Order Service  │
│                 │ │                 │ │                 │
│ - Search API    │ │ - Cart CRUD     │ │ - Checkout      │
│ - Product API   │ │ - Reservations  │ │ - Idempotency   │
│ - Recommendations│ │ - Inventory    │ │ - Order history │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           DATA LAYER                                     │
├──────────────┬──────────────┬──────────────┬────────────────────────────┤
│  PostgreSQL  │ Elasticsearch│    Valkey    │          Kafka             │
│  - Products  │  - Search    │  - Sessions  │  - Order events            │
│  - Orders    │  - Facets    │  - Cart      │  - Inventory updates       │
│  - Inventory │              │  - Cache     │  - Recommendations         │
└──────────────┴──────────────┴──────────────┴────────────────────────────┘
```

### Why This Architecture?

**Separation of Concerns**: Each service handles one domain, enabling independent scaling and deployment.

**Optimistic UI**: Frontend assumes success and rolls back on failure, providing instant feedback.

**Event-Driven Updates**: Kafka enables async processing (recommendations, notifications) without blocking user flows.

---

## Step 3: End-to-End Add to Cart Flow (10 minutes)

This is the most critical user journey, requiring tight frontend-backend coordination.

### Data Flow Diagram

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│   Browser    │   │   Cart API   │   │  PostgreSQL  │   │    Valkey    │
│  (React)     │   │  (Express)   │   │  (Inventory) │   │   (Cache)    │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │                  │
       │ 1. Click "Add"   │                  │                  │
       │ ──────────────>  │                  │                  │
       │ 2. Optimistic    │                  │                  │
       │    UI Update     │                  │                  │
       │ <──────────────  │                  │                  │
       │                  │ 3. BEGIN TRANS   │                  │
       │                  │ ──────────────>  │                  │
       │                  │ 4. SELECT...     │                  │
       │                  │    FOR UPDATE    │                  │
       │                  │ ──────────────>  │                  │
       │                  │ 5. Check avail   │                  │
       │                  │ <──────────────  │                  │
       │                  │ 6. UPDATE        │                  │
       │                  │    reserved +=   │                  │
       │                  │ ──────────────>  │                  │
       │                  │ 7. INSERT cart   │                  │
       │                  │ ──────────────>  │                  │
       │                  │ 8. COMMIT        │                  │
       │                  │ <──────────────  │                  │
       │                  │                  │ 9. Invalidate    │
       │                  │                  │    cart cache    │
       │                  │ ─────────────────────────────────>  │
       │ 10. Confirm      │                  │                  │
       │ <──────────────  │                  │                  │
       │                  │                  │                  │
```

### Frontend Implementation

```typescript
// stores/cartStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CartItem {
  productId: string;
  quantity: number;
  price: number;
  title: string;
  image: string;
  reservedUntil: Date;
}

interface CartStore {
  items: CartItem[];
  isLoading: boolean;
  error: string | null;
  addItem: (product: Product, quantity: number) => Promise<void>;
  removeItem: (productId: string) => Promise<void>;
  updateQuantity: (productId: string, quantity: number) => Promise<void>;
  clearCart: () => void;
  getTotal: () => number;
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      isLoading: false,
      error: null,

      addItem: async (product, quantity) => {
        const previousItems = get().items;

        // Optimistic update - add immediately
        set(state => ({
          items: [...state.items, {
            productId: product.id,
            quantity,
            price: product.price,
            title: product.title,
            image: product.images[0],
            reservedUntil: new Date(Date.now() + 30 * 60 * 1000)
          }],
          isLoading: true,
          error: null
        }));

        try {
          const response = await fetch('/api/cart/items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: product.id, quantity })
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to add item');
          }

          const cartItem = await response.json();

          // Update with server response (may include different reservedUntil)
          set(state => ({
            items: state.items.map(item =>
              item.productId === product.id
                ? { ...item, reservedUntil: new Date(cartItem.reservedUntil) }
                : item
            ),
            isLoading: false
          }));

        } catch (error) {
          // Rollback on failure
          set({
            items: previousItems,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          throw error;
        }
      },

      // ... other methods
    }),
    {
      name: 'amazon-cart',
      partialize: (state) => ({ items: state.items })
    }
  )
);
```

### Backend Implementation

```typescript
// routes/cart.ts
import { Router } from 'express';
import { pool } from '../shared/db';
import { logger } from '../shared/logger';

const router = Router();

router.post('/items', async (req, res) => {
  const { productId, quantity } = req.body;
  const userId = req.session.userId;
  const correlationId = req.headers['x-correlation-id'] as string;

  const log = logger.child({ correlationId, userId, productId, quantity });
  log.info('Adding item to cart');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Lock inventory row and check availability
    const inventoryResult = await client.query(`
      SELECT quantity, reserved, quantity - reserved AS available
      FROM inventory
      WHERE product_id = $1
      FOR UPDATE
    `, [productId]);

    if (inventoryResult.rows.length === 0) {
      throw new NotFoundError('Product not found');
    }

    const { available } = inventoryResult.rows[0];

    if (available < quantity) {
      log.warn({ available, requested: quantity }, 'Insufficient inventory');
      throw new InsufficientInventoryError(productId, available, quantity);
    }

    // 2. Reserve inventory
    await client.query(`
      UPDATE inventory
      SET reserved = reserved + $1
      WHERE product_id = $2
    `, [quantity, productId]);

    // 3. Add or update cart item
    const reservedUntil = new Date(Date.now() + 30 * 60 * 1000);

    const cartResult = await client.query(`
      INSERT INTO cart_items (user_id, product_id, quantity, reserved_until)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, product_id) DO UPDATE
      SET quantity = cart_items.quantity + EXCLUDED.quantity,
          reserved_until = EXCLUDED.reserved_until
      RETURNING *
    `, [userId, productId, quantity, reservedUntil]);

    await client.query('COMMIT');

    log.info({ cartItemId: cartResult.rows[0].id }, 'Item added to cart');

    // 4. Invalidate cart cache
    await redis.del(`cart:${userId}`);

    res.status(201).json(cartResult.rows[0]);

  } catch (error) {
    await client.query('ROLLBACK');

    if (error instanceof InsufficientInventoryError) {
      return res.status(409).json({
        error: 'INSUFFICIENT_INVENTORY',
        message: `Only ${error.available} units available`,
        available: error.available
      });
    }

    log.error({ error }, 'Failed to add item to cart');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});
```

### Error Handling Across the Stack

```typescript
// Frontend error handling with user feedback
const handleAddToCart = async (product: Product) => {
  try {
    await addItem(product, 1);
    toast.success(`${product.title} added to cart`);
  } catch (error) {
    if (error instanceof InsufficientInventoryError) {
      toast.error(`Only ${error.available} units available`);
      // Optionally show in-stock quantity
      queryClient.invalidateQueries(['product', product.id]);
    } else if (error instanceof ReservationExpiredError) {
      toast.warning('Item reservation expired. Please try again.');
    } else {
      toast.error('Failed to add to cart. Please try again.');
    }
  }
};
```

---

## Step 4: Search with Faceted Filtering (8 minutes)

### End-to-End Flow

```
User types "wireless headphones"
        │
        ▼
┌──────────────────┐
│ SearchInput.tsx  │ debounce(300ms)
│ - Controlled     │ ──────────────────>  URL state update
│ - Debounced      │                      /search?q=wireless+headphones
└──────────────────┘
        │
        ▼
┌──────────────────┐
│ useSearchQuery   │ TanStack Query
│ - Cache 5min     │ ──────────────────>  GET /api/search?q=...
│ - Stale-while-   │
│   revalidate     │
└──────────────────┘
        │
        ▼
┌──────────────────┐
│ Catalog Service  │
│ - ES query build │ ──────────────────>  Elasticsearch
│ - Aggregations   │                      products index
│ - Circuit breaker│
└──────────────────┘
        │
        ▼
┌──────────────────┐
│ SearchResults    │ Response includes:
│ - Virtualized    │ - products[]
│ - Facets sidebar │ - facets (categories, brands, prices)
│ - Infinite scroll│ - totalCount
└──────────────────┘
```

### Frontend: Search Component

```tsx
// components/Search/SearchPage.tsx
import { useVirtualizer } from '@tanstack/react-virtual';
import { useSearchParams } from '@tanstack/react-router';
import { useInfiniteQuery } from '@tanstack/react-query';

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const parentRef = useRef<HTMLDivElement>(null);

  const query = searchParams.get('q') || '';
  const category = searchParams.get('category');
  const priceMin = searchParams.get('priceMin');
  const priceMax = searchParams.get('priceMax');
  const brands = searchParams.getAll('brand');

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = useInfiniteQuery({
    queryKey: ['search', query, category, priceMin, priceMax, brands],
    queryFn: ({ pageParam = 0 }) =>
      searchProducts({ query, category, priceMin, priceMax, brands, page: pageParam }),
    getNextPageParam: (lastPage, pages) =>
      lastPage.hasMore ? pages.length : undefined,
    staleTime: 5 * 60 * 1000,
  });

  const allProducts = data?.pages.flatMap(page => page.products) ?? [];
  const facets = data?.pages[0]?.facets;

  const virtualizer = useVirtualizer({
    count: hasNextPage ? allProducts.length + 1 : allProducts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 280,
    overscan: 5,
  });

  // Infinite scroll trigger
  useEffect(() => {
    const [lastItem] = [...virtualizer.getVirtualItems()].reverse();
    if (!lastItem) return;

    if (
      lastItem.index >= allProducts.length - 1 &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      fetchNextPage();
    }
  }, [virtualizer.getVirtualItems(), hasNextPage, isFetchingNextPage]);

  return (
    <div className="flex gap-6">
      {/* Facets Sidebar */}
      <aside className="w-64 shrink-0">
        <FacetFilters
          facets={facets}
          selected={{ category, priceMin, priceMax, brands }}
          onChange={(filters) => setSearchParams(filters)}
        />
      </aside>

      {/* Virtualized Results */}
      <div ref={parentRef} className="flex-1 h-[calc(100vh-120px)] overflow-auto">
        <div
          style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {virtualRow.index < allProducts.length ? (
                <ProductCard product={allProducts[virtualRow.index]} />
              ) : (
                <LoadingSpinner />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

### Backend: Search API with Fallback

```typescript
// routes/search.ts
import { Router } from 'express';
import { esClient } from '../shared/elasticsearch';
import { pool } from '../shared/db';
import { searchCircuitBreaker } from '../shared/circuitBreaker';

const router = Router();

router.get('/', async (req, res) => {
  const { q, category, priceMin, priceMax, brand, page = 0, limit = 20 } = req.query;
  const startTime = Date.now();

  try {
    // Try Elasticsearch with circuit breaker
    const results = await searchCircuitBreaker.fire(async () => {
      return await esClient.search({
        index: 'products',
        body: buildEsQuery({ q, category, priceMin, priceMax, brand, page, limit })
      });
    });

    const products = results.hits.hits.map(hit => ({
      ...hit._source,
      id: hit._id,
      score: hit._score
    }));

    const facets = {
      categories: results.aggregations.categories.buckets,
      brands: results.aggregations.brands.buckets,
      priceRanges: results.aggregations.price_ranges.buckets,
      avgRating: results.aggregations.avg_rating.value
    };

    // Log search for analytics
    await logSearch({
      query: q,
      filters: { category, priceMin, priceMax, brand },
      resultsCount: results.hits.total.value,
      latencyMs: Date.now() - startTime,
      engine: 'elasticsearch'
    });

    res.json({
      products,
      facets,
      totalCount: results.hits.total.value,
      page: Number(page),
      hasMore: (Number(page) + 1) * Number(limit) < results.hits.total.value
    });

  } catch (error) {
    if (error.message === 'Circuit breaker is OPEN') {
      // Fallback to PostgreSQL full-text search
      const fallbackResults = await pgFallbackSearch({ q, category, priceMin, priceMax, page, limit });

      await logSearch({
        query: q,
        filters: { category, priceMin, priceMax },
        resultsCount: fallbackResults.totalCount,
        latencyMs: Date.now() - startTime,
        engine: 'postgres_fts'
      });

      return res.json(fallbackResults);
    }
    throw error;
  }
});

function buildEsQuery({ q, category, priceMin, priceMax, brand, page, limit }) {
  return {
    query: {
      function_score: {
        query: {
          bool: {
            must: q ? [{ match: { title: { query: q, fuzziness: 'AUTO' } } }] : [],
            filter: [
              category && { term: { category } },
              priceMin && { range: { price: { gte: Number(priceMin) } } },
              priceMax && { range: { price: { lte: Number(priceMax) } } },
              brand && { terms: { brand: Array.isArray(brand) ? brand : [brand] } },
              { term: { is_active: true } }
            ].filter(Boolean)
          }
        },
        functions: [
          { filter: { term: { in_stock: true } }, weight: 2 },
          { field_value_factor: { field: 'rating', modifier: 'sqrt', factor: 1.2 } }
        ],
        score_mode: 'multiply'
      }
    },
    aggs: {
      categories: { terms: { field: 'category', size: 20 } },
      brands: { terms: { field: 'brand', size: 20 } },
      price_ranges: {
        range: {
          field: 'price',
          ranges: [
            { key: 'Under $25', to: 25 },
            { key: '$25-$50', from: 25, to: 50 },
            { key: '$50-$100', from: 50, to: 100 },
            { key: 'Over $100', from: 100 }
          ]
        }
      },
      avg_rating: { avg: { field: 'rating' } }
    },
    size: Number(limit),
    from: Number(page) * Number(limit),
    sort: [
      { _score: 'desc' },
      { rating: 'desc' }
    ]
  };
}
```

---

## Step 5: Checkout Flow (10 minutes)

### Multi-Step Process Overview

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Step 1    │ -> │   Step 2    │ -> │   Step 3    │ -> │   Step 4    │
│  Shipping   │    │   Payment   │    │   Review    │    │ Confirmation│
│             │    │             │    │             │    │             │
│ - Address   │    │ - Card form │    │ - Summary   │    │ - Order ID  │
│ - Validation│    │ - Stripe    │    │ - Edit      │    │ - Email     │
│ - Save      │    │   Elements  │    │ - Place     │    │ - Next steps│
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

### Frontend: Checkout State Machine

```tsx
// components/Checkout/CheckoutFlow.tsx
import { useMachine } from '@xstate/react';
import { checkoutMachine } from './checkoutMachine';

export function CheckoutFlow() {
  const [state, send] = useMachine(checkoutMachine);
  const { items, getTotal } = useCartStore();
  const [idempotencyKey] = useState(() => generateIdempotencyKey());

  const steps = [
    { id: 'shipping', label: 'Shipping' },
    { id: 'payment', label: 'Payment' },
    { id: 'review', label: 'Review' },
    { id: 'confirmation', label: 'Confirmation' }
  ];

  return (
    <div className="max-w-3xl mx-auto">
      {/* Step Indicator */}
      <nav className="flex justify-between mb-8">
        {steps.map((step, index) => (
          <div
            key={step.id}
            className={cn(
              'flex items-center',
              state.matches(step.id) && 'text-blue-600 font-medium',
              state.context.completedSteps.includes(step.id) && 'text-green-600'
            )}
          >
            <span className="w-8 h-8 rounded-full border-2 flex items-center justify-center">
              {state.context.completedSteps.includes(step.id) ? (
                <CheckIcon />
              ) : (
                index + 1
              )}
            </span>
            <span className="ml-2">{step.label}</span>
          </div>
        ))}
      </nav>

      {/* Step Content */}
      {state.matches('shipping') && (
        <ShippingForm
          onSubmit={(address) => send({ type: 'SUBMIT_SHIPPING', address })}
          defaultValues={state.context.shippingAddress}
        />
      )}

      {state.matches('payment') && (
        <PaymentForm
          onSubmit={(payment) => send({ type: 'SUBMIT_PAYMENT', payment })}
          onBack={() => send({ type: 'BACK' })}
        />
      )}

      {state.matches('review') && (
        <OrderReview
          items={items}
          total={getTotal()}
          shippingAddress={state.context.shippingAddress}
          paymentMethod={state.context.paymentMethod}
          onPlace={() => send({ type: 'PLACE_ORDER', idempotencyKey })}
          onBack={() => send({ type: 'BACK' })}
          isLoading={state.matches('review.placing')}
        />
      )}

      {state.matches('confirmation') && (
        <OrderConfirmation
          orderId={state.context.orderId}
          email={state.context.email}
        />
      )}

      {state.matches('error') && (
        <ErrorDisplay
          error={state.context.error}
          onRetry={() => send({ type: 'RETRY' })}
        />
      )}
    </div>
  );
}

// State machine definition
const checkoutMachine = createMachine({
  id: 'checkout',
  initial: 'shipping',
  context: {
    shippingAddress: null,
    paymentMethod: null,
    orderId: null,
    error: null,
    completedSteps: []
  },
  states: {
    shipping: {
      on: {
        SUBMIT_SHIPPING: {
          target: 'payment',
          actions: assign({
            shippingAddress: (_, event) => event.address,
            completedSteps: (ctx) => [...ctx.completedSteps, 'shipping']
          })
        }
      }
    },
    payment: {
      on: {
        SUBMIT_PAYMENT: {
          target: 'review',
          actions: assign({
            paymentMethod: (_, event) => event.payment,
            completedSteps: (ctx) => [...ctx.completedSteps, 'payment']
          })
        },
        BACK: 'shipping'
      }
    },
    review: {
      initial: 'idle',
      states: {
        idle: {
          on: { PLACE_ORDER: 'placing' }
        },
        placing: {
          invoke: {
            src: 'placeOrder',
            onDone: {
              target: '#checkout.confirmation',
              actions: assign({
                orderId: (_, event) => event.data.orderId,
                completedSteps: (ctx) => [...ctx.completedSteps, 'review']
              })
            },
            onError: {
              target: '#checkout.error',
              actions: assign({ error: (_, event) => event.data })
            }
          }
        }
      },
      on: { BACK: 'payment' }
    },
    confirmation: { type: 'final' },
    error: {
      on: { RETRY: 'review' }
    }
  }
});
```

### Backend: Idempotent Order Creation

```typescript
// routes/orders.ts
import { Router } from 'express';
import { pool } from '../shared/db';
import { processPayment } from '../shared/payment';
import { logger } from '../shared/logger';

const router = Router();

router.post('/', async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'] as string;
  const { shippingAddress, paymentMethodId } = req.body;
  const userId = req.session.userId;

  const log = logger.child({ idempotencyKey, userId });
  log.info('Starting checkout');

  // 1. Check idempotency
  const existingOrder = await pool.query(`
    SELECT id, status, response FROM orders
    WHERE idempotency_key = $1
  `, [idempotencyKey]);

  if (existingOrder.rows.length > 0) {
    log.info({ orderId: existingOrder.rows[0].id }, 'Returning cached order');
    return res.json(JSON.parse(existingOrder.rows[0].response));
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 2. Get cart items with inventory lock
    const cartResult = await client.query(`
      SELECT ci.*, p.title, p.price, i.quantity - i.reserved as available
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      JOIN inventory i ON ci.product_id = i.product_id
      WHERE ci.user_id = $1
      FOR UPDATE OF i
    `, [userId]);

    if (cartResult.rows.length === 0) {
      throw new EmptyCartError();
    }

    // 3. Verify all items still available
    for (const item of cartResult.rows) {
      if (item.available < 0) {
        throw new InsufficientInventoryError(item.product_id, item.available, item.quantity);
      }
    }

    // 4. Calculate totals
    const subtotal = cartResult.rows.reduce(
      (sum, item) => sum + item.price * item.quantity, 0
    );
    const tax = subtotal * 0.08; // 8% tax
    const shippingCost = subtotal > 50 ? 0 : 5.99;
    const total = subtotal + tax + shippingCost;

    // 5. Process payment (with idempotency)
    const paymentResult = await processPayment({
      amount: Math.round(total * 100),
      paymentMethodId,
      idempotencyKey: `payment-${idempotencyKey}`,
      metadata: { userId, cartItemCount: cartResult.rows.length }
    });

    if (paymentResult.status !== 'succeeded') {
      throw new PaymentFailedError(paymentResult.error);
    }

    // 6. Create order
    const orderResult = await client.query(`
      INSERT INTO orders (
        user_id, status, subtotal, tax, shipping_cost, total,
        shipping_address, payment_method, payment_status, idempotency_key
      ) VALUES ($1, 'confirmed', $2, $3, $4, $5, $6, $7, 'completed', $8)
      RETURNING id
    `, [userId, subtotal, tax, shippingCost, total, shippingAddress, 'card', idempotencyKey]);

    const orderId = orderResult.rows[0].id;

    // 7. Copy cart items to order items
    await client.query(`
      INSERT INTO order_items (order_id, product_id, product_title, quantity, price)
      SELECT $1, ci.product_id, p.title, ci.quantity, p.price
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.user_id = $2
    `, [orderId, userId]);

    // 8. Commit inventory (convert reserved to decremented)
    await client.query(`
      UPDATE inventory i
      SET quantity = quantity - ci.quantity,
          reserved = reserved - ci.quantity
      FROM cart_items ci
      WHERE i.product_id = ci.product_id
        AND ci.user_id = $1
    `, [userId]);

    // 9. Clear cart
    await client.query('DELETE FROM cart_items WHERE user_id = $1', [userId]);

    await client.query('COMMIT');

    // 10. Create response and cache it
    const response = {
      orderId,
      status: 'confirmed',
      total,
      estimatedDelivery: getEstimatedDelivery(shippingAddress)
    };

    await pool.query(`
      UPDATE orders SET response = $1 WHERE id = $2
    `, [JSON.stringify(response), orderId]);

    // 11. Emit order event for async processing
    await kafka.send('order-events', {
      type: 'ORDER_CREATED',
      orderId,
      userId,
      items: cartResult.rows.map(i => ({ productId: i.product_id, quantity: i.quantity }))
    });

    log.info({ orderId, total }, 'Order created successfully');
    res.status(201).json(response);

  } catch (error) {
    await client.query('ROLLBACK');

    // Log audit event for failed checkout
    await logAudit({
      action: 'order.failed',
      actor: { id: userId, type: 'user' },
      resource: { type: 'checkout', id: idempotencyKey },
      changes: { error: error.message }
    });

    if (error instanceof PaymentFailedError) {
      return res.status(402).json({
        error: 'PAYMENT_FAILED',
        message: error.message
      });
    }

    throw error;
  } finally {
    client.release();
  }
});
```

---

## Step 6: Data Synchronization Strategy (5 minutes)

### Real-Time Inventory Updates

```typescript
// Backend: Kafka consumer for inventory updates
import { Kafka } from 'kafkajs';

const consumer = kafka.consumer({ groupId: 'inventory-sync' });

await consumer.subscribe({ topic: 'inventory-updates' });

await consumer.run({
  eachMessage: async ({ message }) => {
    const event = JSON.parse(message.value.toString());

    switch (event.type) {
      case 'INVENTORY_UPDATED':
        // Update Elasticsearch
        await esClient.update({
          index: 'products',
          id: event.productId,
          body: {
            doc: { in_stock: event.available > 0, available: event.available }
          }
        });

        // Invalidate product cache
        await redis.del(`product:${event.productId}`);
        break;
    }
  }
});

// Frontend: WebSocket for real-time updates
export function useInventoryUpdates(productIds: string[]) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const ws = new WebSocket(`${WS_URL}/inventory`);

    ws.onmessage = (event) => {
      const { productId, available } = JSON.parse(event.data);

      if (productIds.includes(productId)) {
        // Update cached product data
        queryClient.setQueryData(['product', productId], (old: Product) => ({
          ...old,
          available,
          inStock: available > 0
        }));

        // Show toast if item in cart became unavailable
        const cartItems = useCartStore.getState().items;
        const cartItem = cartItems.find(i => i.productId === productId);
        if (cartItem && available < cartItem.quantity) {
          toast.warning(`${cartItem.title} availability changed`);
        }
      }
    };

    return () => ws.close();
  }, [productIds]);
}
```

### Search Index Synchronization

```typescript
// Background job: Keep Elasticsearch in sync with PostgreSQL
async function syncProductToElasticsearch(productId: string) {
  const product = await pool.query(`
    SELECT p.*,
           SUM(i.quantity - i.reserved) as available,
           c.name as category_name,
           s.business_name as seller_name
    FROM products p
    LEFT JOIN inventory i ON p.id = i.product_id
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN sellers s ON p.seller_id = s.id
    WHERE p.id = $1
    GROUP BY p.id, c.name, s.business_name
  `, [productId]);

  if (product.rows.length === 0) {
    // Product deleted, remove from index
    await esClient.delete({ index: 'products', id: productId });
    return;
  }

  const p = product.rows[0];

  await esClient.index({
    index: 'products',
    id: productId,
    body: {
      title: p.title,
      description: p.description,
      category: p.category_name,
      brand: p.attributes?.brand,
      price: p.price,
      rating: p.rating,
      review_count: p.review_count,
      in_stock: p.available > 0,
      seller: p.seller_name,
      images: p.images,
      created_at: p.created_at
    }
  });
}
```

---

## Step 7: Key Design Decisions & Trade-offs

### Decision 1: Optimistic UI Updates

| Aspect | Chosen Approach | Alternative | Rationale |
|--------|-----------------|-------------|-----------|
| Cart Operations | Optimistic update | Wait for server | User perceives instant response |
| Rollback | Client-side state restoration | Server push | Simpler, works offline |
| Trade-off | Brief inconsistency on failure | Slower perceived performance | UX wins for common success case |

### Decision 2: State Machine for Checkout

| Aspect | Chosen Approach | Alternative | Rationale |
|--------|-----------------|-------------|-----------|
| Flow Control | XState machine | useState flags | Clear states, impossible transitions prevented |
| Persistence | Context in machine | localStorage | Survives refresh, tracks progress |
| Trade-off | Learning curve | Simpler but error-prone | Correctness for critical flow |

### Decision 3: Search Fallback Strategy

| Aspect | Chosen Approach | Alternative | Rationale |
|--------|-----------------|-------------|-----------|
| Primary Search | Elasticsearch | PostgreSQL FTS | Performance, faceted filtering |
| Fallback | PostgreSQL FTS on circuit open | Return error | Degraded but available |
| Trade-off | Maintain two search impls | Single point of failure | Availability over consistency |

### Decision 4: Inventory Reservation Model

| Aspect | Chosen Approach | Alternative | Rationale |
|--------|-----------------|-------------|-----------|
| Cart Inventory | Reserve on add | Decrement on add | Prevents false out-of-stock |
| Expiration | 30-minute TTL | No expiration | Balance UX vs. availability |
| Trade-off | Background cleanup job | Simpler but inventory locks | Fairness to all users |

---

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Optimistic UI | Instant feedback, better UX | Rollback complexity, brief inconsistency |
| Reserved inventory | Accurate availability, no overselling | Cleanup job needed, complexity |
| State machine checkout | Predictable flow, easy debugging | Learning curve, more code |
| ES + PG fallback | High availability, fast search | Two systems to maintain |
| Idempotency keys | Exactly-once orders, safe retries | Key storage overhead, 24h TTL management |
| WebSocket inventory | Real-time updates, better UX | Connection management, scaling |

---

## Future Fullstack Enhancements

1. **Progressive Web App**: Offline cart access, push notifications for order updates
2. **Server-Sent Events**: Alternative to WebSocket for inventory updates, simpler scaling
3. **GraphQL Federation**: Unified API across services with client-driven queries
4. **Edge Caching**: CDN caching for product pages with stale-while-revalidate
5. **A/B Testing Infrastructure**: Feature flags for checkout flow experiments
6. **Micro-Frontends**: Independent deployment of search, cart, checkout modules
