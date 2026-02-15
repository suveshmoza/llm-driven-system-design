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

The smart order router maintains connections to multiple broker/venue interfaces (e.g., Citadel, Virtu, NASDAQ Direct), each wrapped in its own circuit breaker (5s timeout, 50% error threshold, 30s reset).

**Routing algorithm**:

1. Request quotes from all healthy venues in parallel using `Promise.allSettled`, skipping venues whose circuit breakers are open
2. Filter to successful responses
3. Select the best execution price — lowest ask for buys, highest bid for sells
4. Execute the order through the selected venue's circuit breaker

This ensures best execution while isolating venue failures.

### Fill Processing with Position Updates

Fill processing happens within a single database transaction:

1. **Record execution** — insert into executions table with order ID, quantity, price, exchange, and timestamp
2. **Update order with optimistic locking** — increment filled_quantity, recalculate avg_fill_price as a weighted average, set status to "filled" (if fully filled) or "partial", and increment the version number. The WHERE clause includes the expected version to detect concurrent modifications.
3. **Update position** — for buys, upsert into positions (insert or update quantity and recalculate average cost basis as a weighted average). For sells, decrement both quantity and reserved_quantity.
4. **Adjust buying power** — for buys, refund any overestimate (estimated cost minus actual fill cost). For sells, credit the sale proceeds.
5. **Write audit log** — record the fill event for compliance.
6. **Commit** — if any step fails (including an optimistic lock conflict), rollback the entire transaction.

---

## 5. Deep Dive: Database Design (5 minutes)

### Schema with Partitioning Strategy

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **orders** | id (UUID PK), user_id (UUID FK), symbol, side (buy/sell), order_type, quantity (DECIMAL 14,6), limit_price, stop_price, status (default 'pending'), filled_quantity, avg_fill_price, time_in_force (default 'day'), submitted_at, filled_at, version (INT for optimistic locking), created_at | (user_id, status) WHERE status IN pending/submitted/partial; (symbol) WHERE status IN pending/submitted/partial | Partitioned by RANGE on created_at with monthly partitions for query performance and archival |
| **audit_logs** | id (UUID PK), user_id, action, entity_type, entity_id, details (JSONB), ip_address, user_agent, request_id, idempotency_key, status, error_message, created_at | (user_id, created_at DESC); (entity_type, entity_id) | Append-only (WORM semantics for SEC compliance) — UPDATE and DELETE revoked from PUBLIC |

### Performance Indexes

Additional indexes for hot paths:

- **positions(user_id)** — portfolio queries
- **sessions(token) WHERE expires_at > NOW()** — session validation (partial index for active sessions only)

---

## 6. Deep Dive: Reliability Patterns (5 minutes)

### Circuit Breaker Implementation

A factory function creates per-dependency circuit breakers with consistent configuration:

- **Timeout**: 5 seconds per operation
- **Error threshold**: Opens after 50% of requests fail (minimum 10 requests)
- **Reset timeout**: 30 seconds before attempting half-open recovery

Each breaker emits metrics on state transitions (closed = 0, half-open = 0.5, open = 1). An optional fallback function is invoked when the circuit is open — for example, the market data breaker falls back to serving stale quotes from the Redis cache.

### Graceful Shutdown

On SIGTERM or SIGINT, the shutdown procedure:

1. Stop accepting new HTTP and WebSocket connections
2. Stop all background workers (quote service, limit order matcher, alert checker)
3. Wait for in-flight requests to complete, with a 30-second maximum timeout
4. Close database connections and Redis clients
5. Exit the process

### End-of-Day Processing

A transactional batch job runs after market close:

1. **Expire unfilled day orders** — set status to "expired" for all pending/submitted/partial orders with `time_in_force = 'day'` created before today
2. **Release reserved buying power** — calculate the unrealized portion of expired buy orders (estimated cost minus filled value) and credit it back to each user's buying power
3. **Archive old orders** — copy orders older than 90 days to an `orders_archive` table, then delete them from the active orders table to keep partitions lean

All steps run within a single transaction to ensure consistency.

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
