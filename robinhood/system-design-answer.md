# Robinhood - Stock Trading Platform - System Design Interview Answer

## Introduction (2 minutes)

"Thanks for this challenge. I'll be designing a stock trading platform similar to Robinhood, focusing on real-time market data, order execution, and portfolio management. This is a domain where reliability and speed are critical. Let me clarify the requirements."

---

## 1. Requirements Clarification (5 minutes)

### Functional Requirements

1. **Real-Time Quotes** - Display live stock prices with minimal delay
2. **Order Placement** - Buy and sell stocks with market, limit, and stop orders
3. **Portfolio Tracking** - View holdings, P&L, and portfolio value in real-time
4. **Market Data** - Historical charts, company info, news integration
5. **Watchlists** - Track favorite stocks with live prices

### Non-Functional Requirements

- **Latency** - Quote updates within 100ms of market data source
- **Reliability** - 99.99% uptime during market hours; orders cannot be lost
- **Consistency** - Order execution must be atomic and correct
- **Scalability** - Handle millions of users with concentrated activity at market open

### Out of Scope

"For this discussion, I'll set aside: options trading, margin accounts, cryptocurrency, and regulatory compliance details (though I'll mention them where relevant)."

---

## 2. Scale Estimation (3 minutes)

### Assumptions
- 15 million registered users
- 2 million DAU during market hours (9:30 AM - 4:00 PM ET)
- 10,000 tradeable securities (stocks + ETFs)
- Average user places 2 orders per day

### Traffic Estimates
- **Quote requests**: 2M users x 10 stocks watching = 20M price subscriptions
- **Quote updates**: 10K stocks x 1 update/second = 10K updates/second
- **Order volume**: 4M orders/day = ~600 orders/second average, 3,000/second at market open

### Storage Estimates
- User profiles: 15M x 2 KB = 30 GB
- Portfolio positions: 15M users x 10 positions x 200 bytes = 30 GB
- Order history: 4M orders/day x 500 bytes = 2 GB/day
- Market data (1-minute candles, 10K stocks, 5 years): ~50 GB

---

## 3. High-Level Architecture (8 minutes)

```
                         ┌─────────────────────────────────────┐
                         │        Market Data Providers        │
                         │     (NYSE, NASDAQ, IEX, etc.)       │
                         └─────────────────┬───────────────────┘
                                           │
                         ┌─────────────────▼───────────────────┐
                         │      Market Data Ingestion          │
                         │         (Kafka Streams)             │
                         └───────────────┬─────────────────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        │                                │                                │
        ▼                                ▼                                ▼
┌───────────────┐              ┌─────────────────┐              ┌─────────────────┐
│  Quote Cache  │              │   Price Alert   │              │  Historical     │
│   (Redis)     │              │    Service      │              │  Data Store     │
└───────┬───────┘              └─────────────────┘              └─────────────────┘
        │
        │     ┌─────────────────────────────────────────────────────────────┐
        │     │                      API Gateway                            │
        │     │         (Authentication, Rate Limiting, Routing)            │
        │     └───────────────────────────┬─────────────────────────────────┘
        │                                 │
        │     ┌───────────────────────────┼───────────────────────────┐
        │     │                           │                           │
┌───────▼─────▼───┐            ┌──────────▼──────────┐     ┌─────────▼─────────┐
│  Quote Service  │            │   Order Service     │     │ Portfolio Service │
│  (WebSocket)    │            │                     │     │                   │
└─────────────────┘            └──────────┬──────────┘     └─────────┬─────────┘
                                          │                         │
                               ┌──────────▼──────────┐              │
                               │    Order Router     │              │
                               │  (Smart Routing)    │              │
                               └──────────┬──────────┘              │
                                          │                         │
                   ┌──────────────────────┼──────────────────────┐  │
                   │                      │                      │  │
            ┌──────▼──────┐        ┌──────▼──────┐        ┌──────▼──┴───┐
            │   Broker    │        │   Broker    │        │  PostgreSQL │
            │  Interface  │        │  Interface  │        │  (Orders,   │
            │  (Market A) │        │  (Market B) │        │  Positions) │
            └─────────────┘        └─────────────┘        └─────────────┘
```

### Core Components

1. **Market Data Ingestion** - Consumes feeds from exchanges, normalizes data
2. **Quote Service** - Streams live prices to clients via WebSocket
3. **Order Service** - Validates, persists, and routes orders
4. **Order Router** - Smart routing to get best execution price
5. **Portfolio Service** - Tracks holdings, calculates P&L
6. **Broker Interface** - Communicates with clearing brokers and exchanges

---

## 4. Data Model (5 minutes)

### Core Entities

```sql
-- User accounts
CREATE TABLE users (
    id              UUID PRIMARY KEY,
    email           VARCHAR(255) UNIQUE NOT NULL,
    phone           VARCHAR(20),
    account_status  VARCHAR(20) DEFAULT 'active',
    buying_power    DECIMAL(14,2) DEFAULT 0,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- Portfolio positions
CREATE TABLE positions (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    symbol          VARCHAR(10) NOT NULL,
    quantity        DECIMAL(14,6) NOT NULL,
    avg_cost_basis  DECIMAL(14,4) NOT NULL,
    updated_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, symbol)
);

-- Orders
CREATE TABLE orders (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    symbol          VARCHAR(10) NOT NULL,
    side            VARCHAR(4) NOT NULL,      -- 'buy' or 'sell'
    order_type      VARCHAR(20) NOT NULL,     -- 'market', 'limit', 'stop', 'stop_limit'
    quantity        DECIMAL(14,6) NOT NULL,
    limit_price     DECIMAL(14,4),
    stop_price      DECIMAL(14,4),
    status          VARCHAR(20) NOT NULL,     -- 'pending', 'submitted', 'filled', 'partial', 'cancelled'
    filled_quantity DECIMAL(14,6) DEFAULT 0,
    avg_fill_price  DECIMAL(14,4),
    submitted_at    TIMESTAMP,
    filled_at       TIMESTAMP,
    created_at      TIMESTAMP DEFAULT NOW(),
    version         INTEGER DEFAULT 0
);

-- Order executions (fills)
CREATE TABLE executions (
    id              UUID PRIMARY KEY,
    order_id        UUID NOT NULL,
    quantity        DECIMAL(14,6) NOT NULL,
    price           DECIMAL(14,4) NOT NULL,
    exchange        VARCHAR(20),
    executed_at     TIMESTAMP NOT NULL
);

-- Watchlists
CREATE TABLE watchlist_items (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    symbol          VARCHAR(10) NOT NULL,
    created_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, symbol)
);
```

### Market Data Schema (Redis)

```
# Live quotes
quote:{symbol} -> {
    "symbol": "AAPL",
    "bid": 150.25,
    "ask": 150.27,
    "last": 150.26,
    "volume": 45678900,
    "timestamp": 1699900000000
}

# User subscriptions
subs:{user_id} -> Set of symbols
```

---

## 5. Deep Dive: Real-Time Market Data (10 minutes)

"Delivering live stock quotes to millions of users is the most challenging part. Let me walk through the architecture."

### Market Data Pipeline

```
Exchange Feeds     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
(UDP/TCP)    ─────▶│  Feed       │────▶│   Kafka      │────▶│  Quote      │
                   │  Handler    │     │   Topics     │     │  Cache      │
                   └──────────────┘     └──────────────┘     └─────────────┘
                          │                    │                    │
                          │                    │                    │
                   ┌──────▼──────┐      ┌──────▼──────┐      ┌──────▼──────┐
                   │  Ticker     │      │  Analytics  │      │  WebSocket  │
                   │  DB Write   │      │  Consumer   │      │  Broadcast  │
                   └─────────────┘      └─────────────┘      └─────────────┘
```

### Feed Handler

```python
class MarketDataFeedHandler:
    def __init__(self):
        self.kafka_producer = KafkaProducer(bootstrap_servers=['kafka:9092'])
        self.symbols = load_tradeable_symbols()  # ~10,000

    async def connect_to_exchange(self, exchange_url):
        # Connect to exchange data feed (typically UDP multicast or TCP)
        self.socket = await create_exchange_connection(exchange_url)

        while True:
            raw_data = await self.socket.receive()
            quote = self.parse_exchange_format(raw_data)

            # Publish to Kafka for distribution
            await self.kafka_producer.send(
                topic='quotes',
                key=quote.symbol.encode(),
                value=json.dumps(quote.to_dict()).encode()
            )

    def parse_exchange_format(self, raw_data):
        # Exchange-specific parsing (FIX, binary, etc.)
        return Quote(
            symbol=raw_data['symbol'],
            bid=raw_data['bid'],
            ask=raw_data['ask'],
            last=raw_data['last'],
            volume=raw_data['volume'],
            timestamp=raw_data['timestamp']
        )
```

### Quote Cache with Redis

```python
class QuoteCacheConsumer:
    async def run(self):
        consumer = KafkaConsumer('quotes', group_id='quote-cache')

        async for message in consumer:
            quote = json.loads(message.value)
            symbol = quote['symbol']

            # Update Redis with latest quote
            await redis.hset(f'quote:{symbol}', mapping={
                'bid': quote['bid'],
                'ask': quote['ask'],
                'last': quote['last'],
                'volume': quote['volume'],
                'timestamp': quote['timestamp']
            })

            # Publish for WebSocket broadcast
            await redis.publish('quote_updates', json.dumps(quote))
```

### WebSocket Quote Streaming

```python
class QuoteWebSocketServer:
    def __init__(self):
        self.user_subscriptions = {}  # user_id -> set of symbols
        self.symbol_subscribers = {}  # symbol -> set of user websockets

    async def handle_connection(self, websocket, user_id):
        self.user_subscriptions[user_id] = set()

        try:
            async for message in websocket:
                cmd = json.loads(message)

                if cmd['type'] == 'subscribe':
                    symbols = cmd['symbols']
                    await self.subscribe_user(user_id, websocket, symbols)

                    # Send current prices immediately
                    quotes = await self.get_current_quotes(symbols)
                    await websocket.send(json.dumps({'type': 'quotes', 'data': quotes}))

                elif cmd['type'] == 'unsubscribe':
                    await self.unsubscribe_user(user_id, websocket, cmd['symbols'])

        finally:
            await self.cleanup_user(user_id, websocket)

    async def broadcast_loop(self):
        pubsub = redis.pubsub()
        await pubsub.subscribe('quote_updates')

        async for message in pubsub.listen():
            if message['type'] != 'message':
                continue

            quote = json.loads(message['data'])
            symbol = quote['symbol']

            # Send to all subscribers of this symbol
            subscribers = self.symbol_subscribers.get(symbol, set())
            if subscribers:
                payload = json.dumps({'type': 'quote', 'data': quote})
                await asyncio.gather(*[
                    ws.send(payload) for ws in subscribers
                ])
```

### Optimization: Batching Updates

```python
class BatchedQuoteBroadcaster:
    def __init__(self, batch_interval=0.05):  # 50ms batches
        self.pending_updates = {}
        self.batch_interval = batch_interval

    async def add_update(self, quote):
        self.pending_updates[quote['symbol']] = quote

    async def broadcast_loop(self):
        while True:
            await asyncio.sleep(self.batch_interval)

            if self.pending_updates:
                batch = list(self.pending_updates.values())
                self.pending_updates.clear()

                # Group updates by subscriber
                user_updates = self.group_by_user(batch)

                for user_ws, quotes in user_updates.items():
                    await user_ws.send(json.dumps({
                        'type': 'quote_batch',
                        'data': quotes
                    }))
```

---

## 6. Deep Dive: Order Execution (5 minutes)

"Order handling requires strict correctness. Let me walk through the order lifecycle."

### Order States

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

### Order Placement Flow

```python
async def place_order(user_id, order_request):
    # 1. Validate order
    validate_order(order_request)

    # 2. Check buying power / shares available
    async with db.transaction():
        user = await db.get_user_for_update(user_id)

        if order_request.side == 'buy':
            estimated_cost = estimate_cost(order_request)
            if user.buying_power < estimated_cost:
                raise InsufficientFundsError()
            # Reserve buying power
            user.buying_power -= estimated_cost
            await db.update_user(user)

        elif order_request.side == 'sell':
            position = await db.get_position_for_update(user_id, order_request.symbol)
            if not position or position.quantity < order_request.quantity:
                raise InsufficientSharesError()
            # Reserve shares
            position.reserved += order_request.quantity
            await db.update_position(position)

        # 3. Create order record
        order = await db.create_order(
            user_id=user_id,
            symbol=order_request.symbol,
            side=order_request.side,
            order_type=order_request.type,
            quantity=order_request.quantity,
            limit_price=order_request.limit_price,
            status='pending'
        )

    # 4. Submit to order router (async)
    await order_queue.enqueue('submit_order', order.id)

    return order
```

### Order Router

```python
class OrderRouter:
    def __init__(self):
        self.brokers = {
            'citadel': CitadelBrokerInterface(),
            'virtu': VirtuBrokerInterface(),
            'nasdaq': NasdaqDirectInterface()
        }

    async def route_order(self, order):
        # Smart order routing for best execution
        best_broker = await self.find_best_execution(order)

        try:
            # Submit to selected broker
            result = await best_broker.submit_order(order)

            await db.update_order(order.id,
                status='submitted',
                submitted_at=datetime.now(),
                broker_ref=result.reference
            )

        except BrokerRejectError as e:
            await db.update_order(order.id, status='rejected', reject_reason=str(e))
            await release_reserved_funds(order)

    async def find_best_execution(self, order):
        # Get quotes from each venue
        quotes = await asyncio.gather(*[
            broker.get_quote(order.symbol)
            for broker in self.brokers.values()
        ])

        # Select best price (lowest ask for buy, highest bid for sell)
        if order.side == 'buy':
            best = min(quotes, key=lambda q: q.ask)
        else:
            best = max(quotes, key=lambda q: q.bid)

        return self.brokers[best.broker]
```

### Handling Fills

```python
async def process_fill(fill_event):
    order = await db.get_order(fill_event.order_id)

    async with db.transaction():
        # Record execution
        await db.create_execution(
            order_id=order.id,
            quantity=fill_event.quantity,
            price=fill_event.price,
            executed_at=fill_event.timestamp
        )

        # Update order
        new_filled_qty = order.filled_quantity + fill_event.quantity
        new_avg_price = calculate_avg_price(order, fill_event)

        status = 'filled' if new_filled_qty >= order.quantity else 'partial'

        await db.update_order(order.id,
            filled_quantity=new_filled_qty,
            avg_fill_price=new_avg_price,
            status=status,
            filled_at=fill_event.timestamp if status == 'filled' else None
        )

        # Update position
        await update_position(order.user_id, order.symbol, fill_event)

        # Update buying power
        await update_buying_power(order.user_id, order, fill_event)

    # Notify user
    await notify_user(order.user_id, 'order_filled', {
        'order_id': order.id,
        'quantity': fill_event.quantity,
        'price': fill_event.price
    })
```

---

## 7. Portfolio Calculations (3 minutes)

### Real-Time Portfolio Value

```python
async def get_portfolio_value(user_id):
    positions = await db.get_positions(user_id)

    # Get current prices from cache
    symbols = [p.symbol for p in positions]
    quotes = await redis.mget([f'quote:{s}' for s in symbols])

    total_value = Decimal('0')
    holdings = []

    for position, quote in zip(positions, quotes):
        current_price = Decimal(quote['last'])
        market_value = position.quantity * current_price
        cost_basis = position.quantity * position.avg_cost_basis
        gain_loss = market_value - cost_basis

        total_value += market_value
        holdings.append({
            'symbol': position.symbol,
            'quantity': position.quantity,
            'avg_cost': position.avg_cost_basis,
            'current_price': current_price,
            'market_value': market_value,
            'gain_loss': gain_loss,
            'gain_loss_pct': (gain_loss / cost_basis * 100) if cost_basis else 0
        })

    return {
        'total_value': total_value,
        'buying_power': user.buying_power,
        'holdings': holdings
    }
```

### End-of-Day Processing

```python
async def end_of_day_processing():
    # Run after market close

    # 1. Expire unfilled day orders
    await db.execute("""
        UPDATE orders SET status = 'expired'
        WHERE status IN ('pending', 'submitted', 'partial')
        AND time_in_force = 'day'
        AND DATE(created_at) < CURRENT_DATE
    """)

    # 2. Release reserved buying power
    await release_expired_order_reserves()

    # 3. Store daily portfolio snapshots
    for user in await db.get_all_active_users():
        portfolio = await get_portfolio_value(user.id)
        await db.insert_portfolio_snapshot(user.id, portfolio)

    # 4. Calculate realized gains for tax reporting
    await process_realized_gains()
```

---

## 8. Trade-offs and Alternatives (3 minutes)

### Trade-off 1: Market Data Sources

**Chose**: Premium exchange feeds
**Trade-off**: High cost ($10K+/month) but lowest latency (<10ms)
**Alternative**: Consolidated feeds (cheaper but 15-minute delay for retail)

### Trade-off 2: Order Routing

**Chose**: Payment for Order Flow (PFOF) to market makers
**Trade-off**: Revenue from order flow vs. potential execution quality concerns
**Alternative**: Direct market access (better execution, no PFOF revenue)

### Trade-off 3: Database for Positions

**Chose**: PostgreSQL with row-level locking
**Trade-off**: Simple, ACID-compliant, but potential bottleneck on hot accounts
**Alternative**: Event sourcing (more complex but better audit trail)

---

## 9. Reliability and Recovery (3 minutes)

### Order Durability

```python
# Orders are written to Kafka before acknowledgment for durability
async def submit_order_durable(order):
    # 1. Write to Kafka (synchronous, wait for acks)
    await kafka.produce(
        topic='orders',
        key=order.user_id.encode(),
        value=order.to_json().encode(),
        acks='all'  # Wait for all replicas
    )

    # 2. Now safe to acknowledge to user
    return OrderAck(order.id)
```

### Reconciliation

```python
async def daily_reconciliation():
    # Compare our records with broker reports
    our_fills = await db.get_fills_for_day(today)
    broker_fills = await broker.get_fill_report(today)

    discrepancies = find_discrepancies(our_fills, broker_fills)

    if discrepancies:
        await create_reconciliation_tickets(discrepancies)
        await alert_operations_team(discrepancies)
```

---

## Summary

"To summarize, I've designed a stock trading platform with:

1. **Real-time market data pipeline** using Kafka for ingestion and Redis for caching
2. **WebSocket streaming** with batched updates for efficient quote delivery
3. **Atomic order processing** with proper reservation of funds/shares
4. **Smart order routing** for best execution across venues
5. **Real-time portfolio calculations** with end-of-day reconciliation

The key insight is separating the high-frequency market data path (Kafka + Redis + WebSocket) from the transactional order path (PostgreSQL), allowing each to be optimized for its specific workload."

---

## Questions I'd Expect

**Q: How do you handle market volatility and trading halts?**
A: We subscribe to exchange halt/resume messages. On halt, we reject new orders for that symbol and notify users. Existing limit orders remain pending. On resume, order processing continues.

**Q: What about fractional shares?**
A: We aggregate fractional orders and execute them as whole shares with our clearing broker, then allocate fills proportionally to users. Stored as DECIMAL(14,6) to handle small fractions.

**Q: How do you ensure users see accurate prices?**
A: Quotes include timestamps. Client UI shows "as of" time. If quote is stale (>5 seconds), we show a warning. For order execution, we use limit orders or market orders with price protection collars.
