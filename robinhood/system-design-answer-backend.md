# Robinhood - Stock Trading Platform - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Problem Statement

"Design a stock trading platform like Robinhood that enables users to view real-time stock quotes, place orders, and track their portfolio. I'll focus on the backend architecture: market data ingestion, order execution engine, database design, caching strategies, and reliability patterns."

---

## 1. Requirements Clarification (3 minutes)

### Functional Requirements (Backend Scope)
1. **Market Data Ingestion** - Consume and distribute real-time quotes from exchange feeds
2. **Order Execution Engine** - Process buy/sell orders with ACID guarantees
3. **Portfolio Service** - Track positions, calculate P&L, manage buying power
4. **Alerting System** - Monitor price thresholds and trigger notifications
5. **Session Management** - Token-based authentication with secure session storage

### Non-Functional Requirements
| Requirement | Target | Backend Implication |
|-------------|--------|---------------------|
| Quote Latency | < 100ms from source | Kafka streaming, Redis caching |
| Order Latency | p95 < 500ms | Optimized transactions, connection pooling |
| Availability | 99.99% during market hours | Circuit breakers, graceful degradation |
| Consistency | Strong for orders | PostgreSQL transactions, row-level locking |
| Throughput | 3,000 orders/second at market open | Horizontal scaling, queue-based processing |

### Scale Estimates
- 15M registered users, 2M DAU during market hours
- 10,000 tradeable securities with 1 update/second each
- 4M orders/day, concentrated at market open (9:30 AM ET)
- Order history: 2 GB/day, 730 GB/year

---

## 2. High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MARKET DATA PROVIDERS                              │
│                    (NYSE, NASDAQ, IEX - UDP/TCP Feeds)                      │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │     Feed Handler Pool     │
                    │  (Parse, Normalize, Emit) │
                    └─────────────┬─────────────┘
                                  │
              ┌───────────────────▼───────────────────┐
              │              Kafka Cluster            │
              │     quotes topic (partitioned by      │
              │           symbol hash)                │
              └───────┬───────────┬───────────┬───────┘
                      │           │           │
         ┌────────────▼──┐  ┌─────▼─────┐  ┌──▼────────────┐
         │  Quote Cache  │  │  Alert    │  │  Historical   │
         │   Consumer    │  │  Checker  │  │  Data Writer  │
         └───────┬───────┘  └───────────┘  └───────────────┘
                 │
         ┌───────▼───────┐
         │     Redis     │
         │ (Quote Cache) │
         └───────┬───────┘
                 │ Pub/Sub
    ┌────────────┼────────────┐
    │            │            │
┌───▼───┐   ┌────▼────┐   ┌───▼───┐
│ WS    │   │ WS      │   │ WS    │
│Server1│   │ Server2 │   │Server3│
└───────┘   └─────────┘   └───────┘

                    ┌─────────────────────────────────────┐
                    │           API Gateway               │
                    │  (Auth, Rate Limit, Load Balance)   │
                    └───────────────┬─────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
┌───────▼───────┐         ┌─────────▼─────────┐       ┌─────────▼─────────┐
│ Order Service │         │ Portfolio Service │       │ Watchlist Service │
│               │         │                   │       │                   │
└───────┬───────┘         └─────────┬─────────┘       └─────────┬─────────┘
        │                           │                           │
        └───────────────────────────┼───────────────────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │         PostgreSQL            │
                    │   (Orders, Positions, Users)  │
                    └───────────────────────────────┘
```

---

## 3. Deep Dive: Market Data Pipeline (10 minutes)

### Feed Handler Architecture

The feed handler connects to exchange data feeds, parses proprietary protocols, and publishes normalized quotes to Kafka.

The handler establishes a socket connection to the exchange. As raw binary data arrives, it parses fields (symbol, bid, ask, last price, volume) from the proprietary format (e.g., FIX protocol). Each parsed quote is published to the Kafka `quotes` topic, keyed by symbol to ensure ordered processing per security. A circuit breaker wraps the Kafka publish to handle producer failures gracefully.

### Quote Cache Consumer

Consumes from Kafka and updates Redis cache with latest prices.

The consumer subscribes to the `quotes` topic and buffers incoming quotes in a map keyed by symbol (last write wins). Every 50ms, the buffer is flushed in a single Redis pipeline:

1. For each symbol, `HSET` the quote fields (bid, ask, last, volume, timestamp) into a hash at `quote:{symbol}`
2. Publish the entire batch of updated quotes to a Redis Pub/Sub channel (`quote_updates`) so WebSocket servers receive them
3. Clear the buffer

This 50ms batching reduces Redis round-trips while keeping quotes fresh.

### Redis Pub/Sub for WebSocket Distribution

Each WebSocket server subscribes to Redis and filters quotes by client subscriptions.

The distributor maintains a map of symbol to connected WebSocket clients. When a batch of quote updates arrives via Redis Pub/Sub on the `quote_updates` channel, the server:

1. Groups the quotes by subscribing clients (each client only receives quotes for symbols they are watching)
2. Batches all relevant quotes per client into a single message
3. Sends the batch to each client whose WebSocket connection is still open

This avoids sending every quote to every client, reducing bandwidth and client-side processing.

---

## 4. Deep Dive: Order Execution Engine (10 minutes)

### Order State Machine

```
┌─────────┐     ┌───────────┐     ┌────────────┐     ┌────────┐
│ Created │────▶│ Validated │────▶│ Submitted  │────▶│ Filled │
└─────────┘     └───────────┘     └────────────┘     └────────┘
     │               │                  │                │
     ▼               ▼                  ▼                ▼
┌─────────┐     ┌───────────┐     ┌────────────┐     ┌────────┐
│Rejected │     │ Rejected  │     │ Cancelled  │     │Partial │
└─────────┘     └───────────┘     └────────────┘     └────────┘
```

### Transactional Order Placement with Idempotency

The order placement flow ensures ACID guarantees with idempotency:

1. **Check idempotency** — look up the idempotency key in Redis. If a completed result exists, return it immediately. If a pending entry exists, reject as a duplicate.
2. **Acquire idempotency lock** — set the key in Redis with `NX` (only if not exists) and a 24-hour TTL, storing a "pending" status.
3. **Begin database transaction** — all subsequent steps happen within a single PostgreSQL transaction.
4. **Reserve funds or shares** — for buys, `SELECT ... FOR UPDATE` on the user's buying power row, verify sufficient funds, then deduct the estimated cost. For sells, lock the position row, verify available (non-reserved) shares, then increment reserved_quantity.
5. **Create order record** — insert into the orders table with status "pending", returning the new order.
6. **Write audit log** — insert into audit_logs with the idempotency key, user ID, and order details.
7. **Commit transaction** — if any step fails, rollback and delete the idempotency key from Redis.
8. **Store result for idempotency** — on success, update the Redis key with "completed" status and the order data.
9. **Execute or queue** — market orders are executed immediately; limit orders are queued for matching.

### Smart Order Routing

```typescript
class OrderRouter {
  private brokers: Map<string, BrokerInterface> = new Map([
    ['citadel', new CitadelBroker()],
    ['virtu', new VirtuBroker()],
    ['nasdaq', new NasdaqDirectBroker()]
  ]);
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();

  constructor() {
    // Initialize circuit breakers for each broker
    for (const [name, broker] of this.brokers) {
      this.circuitBreakers.set(name, new CircuitBreaker(broker.execute.bind(broker), {
        timeout: 5000,
        errorThresholdPercentage: 50,
        resetTimeout: 30000
      }));
    }
  }

  async routeOrder(order: Order): Promise<ExecutionResult> {
    // Get quotes from all healthy venues
    const quotes = await Promise.allSettled(
      Array.from(this.brokers.entries()).map(async ([name, broker]) => {
        const breaker = this.circuitBreakers.get(name)!;
        if (breaker.opened) return null;

        const quote = await breaker.fire(() => broker.getQuote(order.symbol));
        return { name, quote };
      })
    );

    // Filter successful quotes
    const validQuotes = quotes
      .filter((r): r is PromiseFulfilledResult<{name: string, quote: Quote}> =>
        r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);

    // Select best execution price
    const best = order.side === 'buy'
      ? validQuotes.reduce((a, b) => a.quote.ask < b.quote.ask ? a : b)
      : validQuotes.reduce((a, b) => a.quote.bid > b.quote.bid ? a : b);

    // Execute with selected broker
    const broker = this.brokers.get(best.name)!;
    const breaker = this.circuitBreakers.get(best.name)!;

    return breaker.fire(() => broker.execute(order));
  }
}
```

### Fill Processing with Position Updates

```typescript
async processFill(fillEvent: FillEvent): Promise<void> {
  const client = await this.pool.connect();

  try {
    await client.query('BEGIN');

    // Record execution
    await client.query(
      `INSERT INTO executions (order_id, quantity, price, exchange, executed_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [fillEvent.orderId, fillEvent.quantity, fillEvent.price,
       fillEvent.exchange, fillEvent.timestamp]
    );

    // Update order with optimistic locking
    const { rows: [order] } = await client.query(
      `UPDATE orders SET
         filled_quantity = filled_quantity + $1,
         avg_fill_price = ((avg_fill_price * filled_quantity) + ($2 * $1)) / (filled_quantity + $1),
         status = CASE WHEN filled_quantity + $1 >= quantity THEN 'filled' ELSE 'partial' END,
         filled_at = CASE WHEN filled_quantity + $1 >= quantity THEN NOW() ELSE NULL END,
         version = version + 1
       WHERE id = $3 AND version = $4
       RETURNING *`,
      [fillEvent.quantity, fillEvent.price, fillEvent.orderId, fillEvent.expectedVersion]
    );

    if (!order) {
      throw new OptimisticLockError('Order modified by another process');
    }

    // Update position (UPSERT)
    if (order.side === 'buy') {
      await client.query(
        `INSERT INTO positions (user_id, symbol, quantity, avg_cost_basis)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, symbol) DO UPDATE SET
           quantity = positions.quantity + $3,
           avg_cost_basis = (positions.avg_cost_basis * positions.quantity + $4 * $3)
                           / (positions.quantity + $3)`,
        [order.user_id, order.symbol, fillEvent.quantity, fillEvent.price]
      );
    } else {
      await client.query(
        `UPDATE positions SET
           quantity = quantity - $1,
           reserved_quantity = reserved_quantity - $1
         WHERE user_id = $2 AND symbol = $3`,
        [fillEvent.quantity, order.user_id, order.symbol]
      );
    }

    // Adjust buying power
    const adjustment = order.side === 'buy'
      ? order.estimated_cost - (fillEvent.quantity * fillEvent.price) // Refund overestimate
      : fillEvent.quantity * fillEvent.price; // Credit proceeds

    await client.query(
      'UPDATE users SET buying_power = buying_power + $1 WHERE id = $2',
      [adjustment, order.user_id]
    );

    // Audit log
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, status)
       VALUES ($1, 'ORDER_FILLED', 'order', $2, $3, 'success')`,
      [order.user_id, order.id, JSON.stringify(fillEvent)]
    );

    await client.query('COMMIT');

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

---

## 5. Deep Dive: Database Design (5 minutes)

### Schema with Partitioning Strategy

```sql
-- Orders partitioned by created_at for query performance and archival
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    symbol VARCHAR(10) NOT NULL,
    side VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
    order_type VARCHAR(20) NOT NULL,
    quantity DECIMAL(14,6) NOT NULL,
    limit_price DECIMAL(14,4),
    stop_price DECIMAL(14,4),
    status VARCHAR(20) DEFAULT 'pending',
    filled_quantity DECIMAL(14,6) DEFAULT 0,
    avg_fill_price DECIMAL(14,4),
    time_in_force VARCHAR(10) DEFAULT 'day',
    submitted_at TIMESTAMP,
    filled_at TIMESTAMP,
    version INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Create monthly partitions
CREATE TABLE orders_2024_01 PARTITION OF orders
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
CREATE TABLE orders_2024_02 PARTITION OF orders
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

-- Audit logs with WORM semantics for SEC compliance
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(20) NOT NULL,
    entity_id UUID NOT NULL,
    details JSONB NOT NULL,
    ip_address INET,
    user_agent TEXT,
    request_id VARCHAR(100),
    idempotency_key VARCHAR(100),
    status VARCHAR(20) NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Make audit logs append-only
REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC;
```

### Performance Indexes

```sql
-- Order lookups
CREATE INDEX idx_orders_user_status ON orders(user_id, status)
    WHERE status IN ('pending', 'submitted', 'partial');
CREATE INDEX idx_orders_symbol_pending ON orders(symbol)
    WHERE status IN ('pending', 'submitted', 'partial');

-- Portfolio queries
CREATE INDEX idx_positions_user_id ON positions(user_id);

-- Session validation (hot path)
CREATE INDEX idx_sessions_token ON sessions(token) WHERE expires_at > NOW();

-- Audit log queries (for compliance reporting)
CREATE INDEX idx_audit_user_time ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
```

---

## 6. Deep Dive: Reliability Patterns (5 minutes)

### Circuit Breaker Implementation

```typescript
import CircuitBreaker from 'opossum';

function createServiceBreaker<T>(
  fn: (...args: any[]) => Promise<T>,
  options: { name: string; fallback?: (...args: any[]) => T }
): CircuitBreaker {
  const breaker = new CircuitBreaker(fn, {
    timeout: 5000,
    errorThresholdPercentage: 50,
    volumeThreshold: 10,
    resetTimeout: 30000,
    name: options.name
  });

  // Metrics integration
  breaker.on('success', () => circuitBreakerMetric.set({ name: options.name }, 0));
  breaker.on('open', () => circuitBreakerMetric.set({ name: options.name }, 1));
  breaker.on('halfOpen', () => circuitBreakerMetric.set({ name: options.name }, 0.5));

  if (options.fallback) {
    breaker.fallback(options.fallback);
  }

  return breaker;
}

// Usage for market data
const marketDataBreaker = createServiceBreaker(
  (symbol: string) => marketDataProvider.getQuote(symbol),
  {
    name: 'market-data',
    fallback: (symbol) => redisCache.get(`quote:${symbol}`) // Stale data fallback
  }
);
```

### Graceful Shutdown

```typescript
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close();
  wsServer.close();

  // Stop background workers
  quoteService.stop();
  limitOrderMatcher.stop();
  alertChecker.stop();

  // Wait for in-flight requests (max 30 seconds)
  await Promise.race([
    waitForInflightRequests(),
    new Promise(resolve => setTimeout(resolve, 30000))
  ]);

  // Close database connections
  await pool.end();
  await redis.quit();

  console.log('Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

### End-of-Day Processing

```typescript
async function endOfDayProcessing(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Expire unfilled day orders
    await client.query(`
      UPDATE orders SET status = 'expired', version = version + 1
      WHERE status IN ('pending', 'submitted', 'partial')
        AND time_in_force = 'day'
        AND DATE(created_at) < CURRENT_DATE
    `);

    // Release reserved buying power from expired orders
    await client.query(`
      UPDATE users u SET buying_power = u.buying_power + expired.reserved
      FROM (
        SELECT user_id, SUM(estimated_cost - (filled_quantity * avg_fill_price)) as reserved
        FROM orders
        WHERE status = 'expired' AND side = 'buy'
        GROUP BY user_id
      ) expired
      WHERE u.id = expired.user_id
    `);

    // Archive old orders to cold storage
    await client.query(`
      INSERT INTO orders_archive SELECT * FROM orders
      WHERE created_at < NOW() - INTERVAL '90 days'
    `);
    await client.query(`
      DELETE FROM orders WHERE created_at < NOW() - INTERVAL '90 days'
    `);

    await client.query('COMMIT');

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

---

## 7. Trade-offs Summary

| Decision | Chose | Alternative | Trade-off |
|----------|-------|-------------|-----------|
| Message Queue | Kafka | RabbitMQ | Higher throughput vs simpler operations |
| Quote Cache | Redis | In-memory | Shared across processes vs lower latency |
| Order Storage | PostgreSQL | Event sourcing | Simpler queries vs complete audit trail |
| Session Storage | PostgreSQL + Redis | JWT | Easy revocation vs stateless scaling |
| Order Routing | Smart routing | Single venue | Best execution vs simplicity |
| Idempotency | Redis + 24h TTL | Database | Fast lookup vs guaranteed durability |

---

## 8. Future Enhancements

1. **Event Sourcing for Orders** - Complete audit trail with replay capability
2. **CQRS Pattern** - Separate read/write models for portfolio queries
3. **Kafka Streams** - Real-time analytics on order flow
4. **Read Replicas** - Scale portfolio queries independently
5. **PgBouncer** - Connection pooling for higher concurrency
6. **Order Book Simulation** - Local matching engine for limit orders
