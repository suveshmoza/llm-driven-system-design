# Coinbase (Crypto Exchange) - Development with Claude

## Project Context

Building a cryptocurrency exchange platform to understand order matching engines, real-time price feeds, wallet management with DECIMAL precision, and 24/7 market operations.

**Key Learning Goals:**
- Design an order matching engine with price-time priority
- Implement DECIMAL(28,18) precision for monetary values
- Build real-time price simulation using Geometric Brownian Motion
- Handle per-currency wallets with reserved balance management
- Stream price updates via WebSocket and Kafka
- Implement idempotent order placement

---

## Key Challenges Explored

### 1. Order Matching Engine

**Problem**: Match buy and sell limit orders with price-time priority.

**Solution: In-memory order book per trading pair**
- Bids sorted by price DESC, then timestamp ASC (best bid first)
- Asks sorted by price ASC, then timestamp ASC (best ask first)
- Match when best bid >= best ask at the earlier order's price
- Update filled quantities and trigger wallet transfers atomically

### 2. DECIMAL Precision

**Problem**: Floating point arithmetic causes rounding errors with money.

**Solution**:
- PostgreSQL `DECIMAL(28,18)` for all monetary columns
- All API responses return amounts as strings (not numbers)
- Frontend handles display formatting, not arithmetic

### 3. Price Simulation

**Problem**: Need realistic price movement for development without real market data.

**Solution: Geometric Brownian Motion**
```
newPrice = price * exp((mu - sigma²/2)*dt + sigma*sqrt(dt)*Z)
```
- Different volatility (sigma) per asset (BTC: 1.5%, DOGE: 5%)
- Slight upward drift (mu = 0.0001)
- Clamped to 50%-200% of base price to prevent extreme values

### 4. Wallet Management

**Problem**: Prevent double-spending while orders are pending.

**Solution: Balance + Reserved Balance pattern**
- `available = balance - reserved_balance`
- On order placement: increase reserved_balance
- On order fill: decrease both balance and reserved_balance, add to counterparty
- On order cancel: decrease reserved_balance only

---

## Development Phases

### Phase 1: Infrastructure & Schema (Complete)
- [x] PostgreSQL schema with DECIMAL(28,18) precision
- [x] Currencies and trading pairs seed data
- [x] Session auth with Redis
- [x] Docker Compose for all services

### Phase 2: Market Service & Price Simulation (Complete)
- [x] Geometric Brownian Motion price simulation
- [x] Per-pair volatility configuration
- [x] 1-minute candle aggregation
- [x] Price history tracking

### Phase 3: Order System (Complete)
- [x] In-memory order book (bid/ask sorted)
- [x] Order matching with price-time priority
- [x] Market and limit order support
- [x] Idempotency via Redis keys
- [x] Wallet balance reservation

### Phase 4: Real-time Streaming (Complete)
- [x] WebSocket server for price feeds
- [x] Channel-based subscriptions (ticker, orderbook, user)
- [x] Price broadcaster worker (every 2 seconds)
- [x] Kafka integration for event streaming

### Phase 5: Frontend (Complete)
- [x] Dark theme matching Coinbase design
- [x] Market overview with asset list
- [x] TradingView lightweight-charts integration
- [x] Order book visualization with depth bars
- [x] Trade form with market/limit toggle
- [x] Portfolio summary with allocation
- [x] Order history with cancel support

---

## Design Decisions Log

### Decision 1: In-Memory Order Book
**Context**: Need fast order matching for crypto exchange
**Decision**: In-memory data structure, not database-backed
**Trade-off**: Lost on restart, but much faster matching
**Rationale**: Learning project; production would use replicated state

### Decision 2: Simulated Market Orders
**Context**: Market orders need counterparty; order book may be empty
**Decision**: If no matching limit orders, fill at current market price (simulated)
**Trade-off**: Not realistic matching, but allows testing the full flow
**Rationale**: Real exchange would always have liquidity providers

### Decision 3: String-based Monetary Values in API
**Context**: JSON numbers lose precision for large decimals
**Decision**: All DECIMAL values returned as strings
**Trade-off**: Frontend must parse; slightly more complex
**Rationale**: Prevents silent precision loss (critical for crypto)

### Decision 4: Session Auth (Not JWT)
**Context**: Need simple auth for learning project
**Decision**: Express sessions stored in Redis
**Trade-off**: Not suitable for mobile apps
**Rationale**: Simpler than JWT, follows repo patterns

---

## Resources

- [TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/)
- [Geometric Brownian Motion](https://en.wikipedia.org/wiki/Geometric_Brownian_motion)
- [Order Book Data Structures](https://web.archive.org/web/20110219163448/http://howtohft.wordpress.com/2011/02/15/how-to-build-a-fast-limit-order-book/)
