# Ticketmaster - Event Ticketing Platform - System Design Interview Answer

## Introduction (2 minutes)

"Thanks for this challenge. I'll be designing an event ticketing platform like Ticketmaster. This system is known for extreme traffic spikes when popular events go on sale, making it a fascinating distributed systems problem. Let me clarify requirements."

---

## 1. Requirements Clarification (5 minutes)

### Functional Requirements

1. **Event Browsing** - Search and discover events by location, date, artist, venue
2. **Seat Selection** - Interactive venue maps with available seats
3. **Ticket Purchase** - Reserve seats, checkout, payment processing
4. **Inventory Management** - Real-time seat availability across all sales channels
5. **Order Management** - View tickets, transfers, refunds

### Non-Functional Requirements

- **Handle Traffic Spikes** - 10x-100x normal traffic when popular events drop
- **No Overselling** - Each seat can only be sold once
- **Fairness** - Users who arrive first should have priority
- **Low Latency** - Seat selection must feel instant (<200ms)
- **Availability** - Cannot go down during high-profile on-sales

### Out of Scope

"For this discussion, I'll set aside: primary vs. secondary market (resale), venue management, artist contracts, and mobile ticket delivery."

---

## 2. Scale Estimation (3 minutes)

### Assumptions
- 50,000 events per year
- 100 million registered users
- Average event: 10,000 seats
- Normal traffic: 10,000 RPM
- Peak traffic: 1 million RPM (Taylor Swift on-sale)

### Traffic Patterns

```
Normal day: ~~~~~~~~~~~~~~~~~~~~~

On-sale event:         /\
                      /  \
                     /    \
                    /      \_____
            _______/
```

### Storage Estimates
- Event metadata: 50K events x 10 KB = 500 MB
- Seat inventory: 50K events x 10K seats x 100 bytes = 50 GB
- Orders: 100M orders/year x 500 bytes = 50 GB/year
- User profiles: 100M x 1 KB = 100 GB

---

## 3. High-Level Architecture (8 minutes)

```
                            ┌─────────────────┐
                            │      CDN        │
                            │ (Static assets, │
                            │  event pages)   │
                            └────────┬────────┘
                                     │
┌──────────────┐            ┌────────▼────────┐
│   Virtual    │◀───────────│    Global       │
│   Waiting    │            │    Load         │
│   Room       │───────────▶│    Balancer     │
└──────────────┘            └────────┬────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
       ┌──────▼──────┐       ┌───────▼───────┐      ┌───────▼───────┐
       │   Event     │       │   Inventory   │      │   Checkout    │
       │  Discovery  │       │   Service     │      │   Service     │
       │   Service   │       │               │      │               │
       └─────────────┘       └───────┬───────┘      └───────┬───────┘
                                     │                      │
                             ┌───────▼───────┐              │
                             │   Seat        │              │
                             │   Reservation │              │
                             │   Service     │              │
                             └───────┬───────┘              │
                                     │                      │
           ┌─────────────────────────┼──────────────────────┤
           │                         │                      │
    ┌──────▼──────┐          ┌───────▼───────┐      ┌───────▼───────┐
    │   Redis     │          │  PostgreSQL   │      │    Payment    │
    │   Cluster   │          │   (Sharded)   │      │    Gateway    │
    │(Seat Locks) │          │               │      │               │
    └─────────────┘          └───────────────┘      └───────────────┘
```

### Core Components

1. **Virtual Waiting Room** - Queue system for high-demand events
2. **Event Discovery** - Search, browse, event details (cacheable)
3. **Inventory Service** - Real-time seat availability
4. **Seat Reservation Service** - Temporary seat holds, distributed locks
5. **Checkout Service** - Payment processing, order creation
6. **Queue System** - Fair ordering during high-traffic on-sales

---

## 4. Data Model (5 minutes)

### Core Entities

```sql
-- Events
CREATE TABLE events (
    id              UUID PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    venue_id        UUID NOT NULL,
    artist_id       UUID,
    event_date      TIMESTAMP NOT NULL,
    on_sale_date    TIMESTAMP NOT NULL,
    status          VARCHAR(20) DEFAULT 'upcoming',
    total_capacity  INTEGER NOT NULL,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- Venue seat map (template)
CREATE TABLE venue_sections (
    id              UUID PRIMARY KEY,
    venue_id        UUID NOT NULL,
    name            VARCHAR(50) NOT NULL,
    row_count       INTEGER,
    seats_per_row   INTEGER
);

-- Event seat inventory
CREATE TABLE event_seats (
    id              UUID PRIMARY KEY,
    event_id        UUID NOT NULL,
    section         VARCHAR(50) NOT NULL,
    row             VARCHAR(10) NOT NULL,
    seat_number     VARCHAR(10) NOT NULL,
    price_tier      VARCHAR(20),
    price           DECIMAL(10,2) NOT NULL,
    status          VARCHAR(20) DEFAULT 'available',  -- available, held, sold
    held_until      TIMESTAMP,
    held_by_session VARCHAR(64),
    order_id        UUID,
    UNIQUE(event_id, section, row, seat_number)
);

-- Orders
CREATE TABLE orders (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    event_id        UUID NOT NULL,
    status          VARCHAR(20) DEFAULT 'pending',
    total_amount    DECIMAL(10,2) NOT NULL,
    payment_id      VARCHAR(64),
    created_at      TIMESTAMP DEFAULT NOW(),
    completed_at    TIMESTAMP
);

-- Order items
CREATE TABLE order_items (
    id              UUID PRIMARY KEY,
    order_id        UUID NOT NULL,
    seat_id         UUID NOT NULL,
    price           DECIMAL(10,2) NOT NULL
);
```

### Seat Status State Machine

```
┌───────────┐     ┌────────┐     ┌────────┐
│ Available │────▶│  Held  │────▶│  Sold  │
└───────────┘     └────────┘     └────────┘
      ▲               │
      │               │
      └───────────────┘
         (timeout)
```

---

## 5. Deep Dive: Seat Reservation (10 minutes)

"The core challenge is preventing overselling while handling thousands of concurrent attempts to buy the same seats."

### Distributed Locking with Redis

```python
class SeatReservationService:
    HOLD_DURATION = 600  # 10 minutes

    async def reserve_seats(self, session_id, event_id, seat_ids):
        reserved_seats = []
        failed_seats = []

        for seat_id in seat_ids:
            lock_key = f"seat_lock:{event_id}:{seat_id}"

            # Try to acquire lock
            acquired = await redis.set(
                lock_key,
                session_id,
                nx=True,  # Only if not exists
                ex=self.HOLD_DURATION
            )

            if acquired:
                reserved_seats.append(seat_id)
            else:
                failed_seats.append(seat_id)

        if failed_seats:
            # Release any seats we did acquire
            await self.release_seats(session_id, event_id, reserved_seats)
            raise SeatsUnavailableError(failed_seats)

        # Update database
        await self.update_seats_status(
            event_id,
            reserved_seats,
            status='held',
            held_by=session_id,
            held_until=now() + timedelta(seconds=self.HOLD_DURATION)
        )

        return ReservationResult(
            seats=reserved_seats,
            expires_at=now() + timedelta(seconds=self.HOLD_DURATION)
        )

    async def release_seats(self, session_id, event_id, seat_ids):
        for seat_id in seat_ids:
            lock_key = f"seat_lock:{event_id}:{seat_id}"

            # Only release if we hold the lock
            current_holder = await redis.get(lock_key)
            if current_holder == session_id:
                await redis.delete(lock_key)

        await self.update_seats_status(event_id, seat_ids, status='available')
```

### Optimistic Locking for Database Updates

```python
async def update_seats_status(self, event_id, seat_ids, status, **kwargs):
    async with db.transaction():
        # Use SELECT FOR UPDATE to prevent race conditions
        seats = await db.query("""
            SELECT * FROM event_seats
            WHERE event_id = :event_id
            AND id = ANY(:seat_ids)
            FOR UPDATE NOWAIT
        """, event_id=event_id, seat_ids=seat_ids)

        for seat in seats:
            if status == 'held' and seat.status != 'available':
                raise SeatNotAvailableError(seat.id)

            if status == 'sold' and seat.status != 'held':
                raise InvalidStateTransitionError()

        await db.execute("""
            UPDATE event_seats
            SET status = :status,
                held_until = :held_until,
                held_by_session = :held_by
            WHERE id = ANY(:seat_ids)
        """, status=status, seat_ids=seat_ids, **kwargs)
```

### Real-Time Availability

```python
async def get_seat_availability(event_id, section=None):
    # Try cache first
    cache_key = f"availability:{event_id}:{section or 'all'}"
    cached = await redis.get(cache_key)

    if cached:
        return json.loads(cached)

    # Query database
    query = """
        SELECT section, row, seat_number, status, price, price_tier
        FROM event_seats
        WHERE event_id = :event_id
    """
    if section:
        query += " AND section = :section"

    seats = await db.query(query, event_id=event_id, section=section)

    result = format_seat_map(seats)

    # Cache briefly (5 seconds during high traffic)
    await redis.setex(cache_key, 5, json.dumps(result))

    return result
```

---

## 6. Deep Dive: Virtual Waiting Room (8 minutes)

"During high-demand on-sales, we can't let everyone hit the checkout at once. The virtual waiting room provides fairness and protects our systems."

### Queue Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Virtual Waiting Room                           │
│                                                                     │
│  User arrives    Queue Position    Admitted to Shop    Checkout    │
│      │               │                  │                 │        │
│      ▼               ▼                  ▼                 ▼        │
│  ┌───────┐     ┌───────────┐      ┌───────────┐    ┌───────────┐  │
│  │ Join  │────▶│  Waiting  │─────▶│ Shopping  │───▶│ Complete  │  │
│  │ Queue │     │  (5,234)  │      │  (browse) │    │           │  │
│  └───────┘     └───────────┘      └───────────┘    └───────────┘  │
│                     │                                              │
│                     │ periodic poll                                │
│                     ▼                                              │
│            "Your position: 5,234                                   │
│             Est. wait: 12 min"                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Queue Implementation

```python
class VirtualWaitingRoom:
    def __init__(self, event_id, max_concurrent=5000):
        self.event_id = event_id
        self.max_concurrent = max_concurrent
        self.queue_key = f"queue:{event_id}"
        self.active_key = f"active:{event_id}"

    async def join_queue(self, user_id, session_id):
        # Check if already in queue or active
        existing = await redis.zscore(self.queue_key, session_id)
        if existing:
            return await self.get_position(session_id)

        # Add to queue with timestamp as score
        position = await redis.zadd(
            self.queue_key,
            {session_id: time.time()}
        )

        return QueueStatus(
            position=position,
            estimated_wait=self.estimate_wait(position)
        )

    async def get_position(self, session_id):
        rank = await redis.zrank(self.queue_key, session_id)
        if rank is None:
            # Check if already active
            is_active = await redis.sismember(self.active_key, session_id)
            if is_active:
                return QueueStatus(position=0, status='active')
            return QueueStatus(status='not_in_queue')

        return QueueStatus(
            position=rank + 1,
            estimated_wait=self.estimate_wait(rank + 1)
        )

    async def admit_next_batch(self):
        """Called periodically to admit users from queue."""
        # Count current active users
        active_count = await redis.scard(self.active_key)
        slots_available = self.max_concurrent - active_count

        if slots_available <= 0:
            return 0

        # Get next batch from queue
        next_users = await redis.zrange(
            self.queue_key, 0, slots_available - 1
        )

        if not next_users:
            return 0

        # Move to active set
        for session_id in next_users:
            await redis.sadd(self.active_key, session_id)
            # Set TTL for active session (e.g., 15 minutes)
            await redis.setex(f"active_session:{session_id}", 900, "1")

        # Remove from queue
        await redis.zrem(self.queue_key, *next_users)

        # Notify admitted users
        await self.notify_admitted(next_users)

        return len(next_users)

    async def is_session_active(self, session_id):
        """Check if session is allowed to shop."""
        return await redis.exists(f"active_session:{session_id}")
```

### Fair Queue with Randomization

```python
async def join_queue_fair(self, user_id, session_id):
    """
    Add slight randomization to prevent clock-synced bots
    from always getting first positions.
    """
    # Small random delay (0-500ms)
    await asyncio.sleep(random.uniform(0, 0.5))

    # Add jitter to timestamp
    timestamp = time.time() + random.uniform(-0.1, 0.1)

    await redis.zadd(self.queue_key, {session_id: timestamp})
```

---

## 7. Checkout Flow (4 minutes)

### Checkout Process

```python
async def checkout(session_id, payment_info):
    # 1. Verify session is active
    if not await waiting_room.is_session_active(session_id):
        raise NotActiveSessionError()

    # 2. Get reserved seats
    reservation = await get_reservation(session_id)
    if not reservation or reservation.expired:
        raise ReservationExpiredError()

    # 3. Create order
    order = await db.create_order(
        user_id=current_user.id,
        event_id=reservation.event_id,
        total_amount=reservation.total_price,
        status='pending'
    )

    # 4. Process payment
    try:
        payment_result = await payment_gateway.charge(
            amount=reservation.total_price,
            payment_method=payment_info,
            idempotency_key=f"order:{order.id}"
        )
    except PaymentFailedError as e:
        await db.update_order(order.id, status='payment_failed')
        raise

    # 5. Convert holds to sold (atomic)
    async with db.transaction():
        await db.update_order(
            order.id,
            status='completed',
            payment_id=payment_result.id,
            completed_at=now()
        )

        for seat_id in reservation.seat_ids:
            await db.execute("""
                UPDATE event_seats
                SET status = 'sold',
                    order_id = :order_id,
                    held_until = NULL,
                    held_by_session = NULL
                WHERE id = :seat_id
                AND status = 'held'
                AND held_by_session = :session_id
            """, order_id=order.id, seat_id=seat_id, session_id=session_id)

    # 6. Release Redis locks
    await release_seat_locks(session_id, reservation.seat_ids)

    # 7. Send confirmation
    await send_order_confirmation(order)

    return order
```

### Timeout Handling

```python
async def cleanup_expired_holds():
    """Background job to release expired holds."""
    while True:
        await asyncio.sleep(60)  # Run every minute

        # Find expired holds
        expired = await db.query("""
            SELECT id, event_id, held_by_session
            FROM event_seats
            WHERE status = 'held'
            AND held_until < NOW()
        """)

        for seat in expired:
            # Release in database
            await db.execute("""
                UPDATE event_seats
                SET status = 'available',
                    held_until = NULL,
                    held_by_session = NULL
                WHERE id = :id
                AND status = 'held'
            """, id=seat.id)

            # Release Redis lock
            lock_key = f"seat_lock:{seat.event_id}:{seat.id}"
            await redis.delete(lock_key)

        if expired:
            # Invalidate availability cache
            event_ids = set(s.event_id for s in expired)
            for event_id in event_ids:
                await redis.delete(f"availability:{event_id}:*")
```

---

## 8. Scalper Prevention (3 minutes)

### Bot Detection

```python
class BotDetectionService:
    async def evaluate_request(self, request, session_id):
        score = 0

        # Check request timing patterns
        request_history = await get_request_history(session_id)
        if is_too_regular(request_history):
            score += 30  # Humans have irregular timing

        # Check browser fingerprint
        fingerprint = request.headers.get('X-Fingerprint')
        if is_known_bot_fingerprint(fingerprint):
            score += 50

        # Check IP reputation
        ip_info = await get_ip_info(request.remote_addr)
        if ip_info.is_datacenter:
            score += 40

        # Check user account
        if user.account_age_days < 1:
            score += 20

        if score > 70:
            return BotEvaluation(is_bot=True, require_captcha=True)
        elif score > 40:
            return BotEvaluation(is_bot=False, require_captcha=True)

        return BotEvaluation(is_bot=False, require_captcha=False)
```

### Purchase Limits

```python
async def check_purchase_limits(user_id, event_id, quantity):
    # Per-event limit (e.g., 4 tickets)
    existing = await db.count_tickets(user_id, event_id)
    if existing + quantity > MAX_TICKETS_PER_EVENT:
        raise PurchaseLimitExceededError()

    # Velocity check
    recent_purchases = await db.count_recent_purchases(
        user_id,
        since=now() - timedelta(hours=24)
    )
    if recent_purchases > MAX_DAILY_PURCHASES:
        raise DailyLimitExceededError()
```

---

## 9. Trade-offs and Alternatives (3 minutes)

### Trade-off 1: Waiting Room vs. First-Come-First-Served

**Chose**: Virtual waiting room for high-demand events
**Trade-off**: Perceived slower, but fairer and more reliable
**Alternative**: No queue (faster for early arrivals, but system may crash)

### Trade-off 2: Seat Holds Duration

**Chose**: 10-minute holds
**Trade-off**: Long enough for payment; short enough for turnover
**Alternative**: Shorter holds (faster turnover, more abandoned checkouts)

### Trade-off 3: Database Sharding

**Chose**: Shard by event_id
**Trade-off**: Single hot event still bottlenecks one shard
**Alternative**: No sharding with read replicas (simpler, less write scale)

---

## 10. Handling Traffic Spikes (2 minutes)

### Auto-Scaling Strategy

```yaml
# Scale based on queue length and response time
scaling_rules:
  - metric: queue_length
    threshold: 10000
    action: scale_up_web_by_50_percent

  - metric: response_time_p99
    threshold: 500ms
    action: scale_up_api_by_25_percent

  - metric: redis_cpu
    threshold: 70%
    action: add_redis_read_replica
```

### Graceful Degradation

```python
async def get_event_details(event_id):
    # During high load, serve cached/static content
    if is_high_load():
        return await cdn_cache.get(f"event:{event_id}")

    return await event_service.get_details(event_id)
```

---

## Summary

"To summarize, I've designed a ticketing platform with:

1. **Distributed seat locking** using Redis for sub-millisecond reservation
2. **Virtual waiting room** for fair access during high-demand on-sales
3. **Optimistic locking** in database to prevent overselling
4. **Time-limited holds** with automatic cleanup for abandoned carts
5. **Bot prevention** through behavior analysis and purchase limits

The key insight is separating the fast-path (browsing, seat map) from the slow-path (payment) and protecting both with appropriate queuing and caching strategies."

---

## Questions I'd Expect

**Q: What happens if Redis fails during an on-sale?**
A: We fall back to database-only locking with FOR UPDATE NOWAIT. It's slower but still prevents overselling. Redis failure would trigger immediate alerts.

**Q: How do you handle users on mobile with poor connectivity?**
A: Extended hold times, optimistic UI updates with conflict resolution, and mobile-specific CDN caching. We also support "offline ticket" viewing once purchased.

**Q: What about the secondary market (resale)?**
A: That's a separate inventory pool with different rules - variable pricing, seller approval flow, and transfer mechanics. The core reservation logic remains the same.
