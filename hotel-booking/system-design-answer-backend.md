# Hotel Booking System - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Opening Statement

"Today I'll design a hotel booking system like Booking.com or Expedia. The core backend challenges are preventing double bookings through pessimistic locking, building a two-phase search combining Elasticsearch with real-time PostgreSQL availability checks, implementing dynamic pricing with date-specific overrides, and ensuring idempotency for payment retries. I'll focus on the database schema, concurrency control, and distributed locking patterns."

---

## Step 1: Requirements Clarification (3-5 minutes)

### Functional Requirements

1. **Hotel and room inventory** - Hotels list properties with room types and availability counts
2. **Search with availability** - Two-phase search: Elasticsearch for filtering, PostgreSQL for real-time availability
3. **Booking with reservation holds** - Create reserved booking, confirm after payment, expire if abandoned
4. **Dynamic pricing** - Base price with date-specific overrides for seasonality/demand
5. **Review system** - Post-stay reviews linked to confirmed bookings

### Non-Functional Requirements

- **Availability**: 99.99% uptime for booking-critical paths
- **Consistency**: Strong consistency for bookings - zero double-booking tolerance
- **Latency**: Search p95 < 500ms, booking confirmation p95 < 1s
- **Scale**: 100M searches/day, 1M bookings/day, 1M hotels

### Backend Focus Areas

- PostgreSQL schema design with proper locking strategies
- Distributed locking for concurrent booking prevention
- Idempotency for payment retry safety
- Availability caching with intelligent invalidation
- Background workers for reservation expiry

---

## Step 2: Scale Estimation (2-3 minutes)

**Traffic Analysis:**
- 100M searches/day = 1,150 QPS (peak 3x = 3,500 QPS)
- 1M bookings/day = 12 bookings/second (peak = 50/second)
- Read:Write ratio = 100:1 (search-heavy)

**Storage Calculations:**
- Hotels: 1M * 2KB = 2 GB
- Room types: 50M * 1KB = 50 GB
- Bookings: 365M/year * 500B = 180 GB/year
- Availability cache: 1M hotels * 365 days * 100B = 36 GB Redis

**Key Insight:** Search is the hot path requiring aggressive caching, but bookings require strong consistency with pessimistic locking. The 100:1 ratio means lock contention is rare.

---

## Step 3: High-Level Architecture (8 minutes)

```
                                 ┌───────────────────────────────────┐
                                 │            API Gateway            │
                                 │   (Rate limiting, Auth, Routing)  │
                                 └───────────────────┬───────────────┘
                                                     │
                    ┌────────────────────────────────┼────────────────────────────────┐
                    │                                │                                │
          ┌─────────▼─────────┐           ┌─────────▼─────────┐           ┌─────────▼─────────┐
          │   Search Service  │           │  Booking Service  │           │  Pricing Service  │
          │                   │           │                   │           │                   │
          │ - ES Query Build  │           │ - Pessimistic Lock│           │ - Base + Override │
          │ - Avail. Filter   │           │ - Idempotency     │           │ - Demand Scoring  │
          │ - Price Enrich    │           │ - Payment Coord.  │           │ - Seasonal Factor │
          └─────────┬─────────┘           └─────────┬─────────┘           └───────────────────┘
                    │                               │
    ┌───────────────┴───────────────┐               │
    │               │               │               │
┌───▼────┐    ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
│Elastic │    │   Redis   │   │ PostgreSQL│   │  RabbitMQ │
│search  │    │  (Cache + │   │ (Primary) │   │  (Jobs)   │
│        │    │   Locks)  │   │           │   │           │
└────────┘    └───────────┘   └───────────┘   └───────────┘
                                    │
                              ┌─────▼─────┐
                              │ Background│
                              │  Workers  │
                              │           │
                              │- Expiry   │
                              │- ES Sync  │
                              │- Cleanup  │
                              └───────────┘
```

---

## Step 4: Database Schema Deep Dive (10 minutes)

### Core Tables

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **room_types** | id (UUID PK), hotel_id (FK cascade), name, base_price (decimal), max_guests, total_rooms (inventory count), amenities (JSONB) | — | Room categories with inventory tracking |
| **bookings** | id (UUID PK), user_id (FK), hotel_id (FK), room_type_id (FK), check_in (date), check_out (date), room_count (default 1), total_price (decimal), status (reserved/confirmed/cancelled/expired), guest_name, guest_email, expires_at (for 15-min hold), idempotency_key (unique) | idx_bookings_availability (room_type_id, check_in, check_out, partial: WHERE status IN reserved/confirmed), idx_bookings_expires (expires_at, partial: WHERE status = reserved) | Range-based bookings with reservation hold pattern; CHECK constraint ensures check_out > check_in |
| **price_overrides** | id (UUID PK), room_type_id (FK cascade), date, price (decimal), reason (weekend/holiday/high_demand/promotion) | idx_price_overrides_lookup (room_type_id, date) | Date-specific pricing overrides; unique on (room_type_id, date) |

### Availability Query with generate_series

The availability query uses PostgreSQL's generate_series to expand each booking into individual nights, then calculates the maximum rooms booked on any single night within the requested date range. This handles the case where different nights have different occupancy levels.

The query works by: (1) expanding each active booking (reserved or confirmed) into per-night rows using generate_series from check_in to check_out minus one day, (2) summing room_count per night for the target room type, (3) taking the maximum across all nights in the range, and (4) subtracting from total_rooms to get available inventory. This ensures we never show more availability than the most constrained night in the range.

---

## Step 5: Pessimistic Locking for Bookings (8 minutes)

### The Double-Booking Problem

```
Time T0: Server A receives booking for Room 101, Jan 15
Time T0: Server B receives booking for Room 101, Jan 15
Time T1: Server A checks availability → 1 room available
Time T1: Server B checks availability → 1 room available
Time T2: Server A creates booking (success)
Time T2: Server B creates booking (success - OVERSOLD!)
```

### Solution: SELECT FOR UPDATE with Transaction

The booking service creates reservations through a transactional process:

1. **Lock the room_type row** - Use `SELECT ... FOR UPDATE` on the room_types table to serialize concurrent bookings for the same room type. This prevents the race condition where two servers simultaneously read "1 room available" and both create bookings.

2. **Check availability within the lock** - Run the availability query inside the transaction to get an accurate count.

3. **Reject if insufficient inventory** - If available rooms are fewer than requested, throw an error with the actual availability count.

4. **Calculate total price** - Sum per-night prices using base price and any date-specific overrides.

5. **Generate idempotency key** - Create a SHA-256 hash of the booking parameters (user ID, hotel ID, room type ID, dates, room count) to prevent duplicate bookings from retries.

6. **Check for existing booking** - Query by idempotency key. If a matching booking exists, return it as a deduplicated result.

7. **Create the reservation** - Insert the booking with status "reserved" and a 15-minute expiration. This hold prevents the inventory from being sold while the user completes payment.

8. **Invalidate availability cache** - Delete cached availability for the affected hotel, room type, and date range.

### Distributed Locking for High-Contention Scenarios

For flash sales or extremely popular hotels, add Redis distributed lock:

The distributed lock service uses Redis Redlock with 3 retry attempts, 200ms retry delay, and 100ms jitter. Before entering the PostgreSQL transaction, the service acquires a lock keyed by `lock:room:{hotelId}:{roomTypeId}:{checkIn}:{checkOut}` with a 30-second TTL. The booking operation runs inside the lock, and the lock is always released in a finally block regardless of success or failure.

This adds an extra layer of serialization above the database-level `SELECT FOR UPDATE`, reducing contention on the database during extreme traffic spikes.

---

## Step 6: Dynamic Pricing Service (5 minutes)

The pricing service calculates the total price for a stay by summing per-night prices:

1. **Retrieve the base price** from the room_types table.
2. **Query price overrides** for the date range from the price_overrides table to build a date-to-price lookup map.
3. **Iterate each night** from check_in to check_out (exclusive). For each night, use the override price if one exists, otherwise use the base price. Multiply by room count.
4. **Sum all nightly totals** to produce the final price.

**Advanced dynamic pricing** layers additional factors when no manual override exists:

| Factor | Calculation | Impact |
|--------|------------|--------|
| Demand multiplier | Based on booking velocity for the hotel on that date | Up to +30% |
| Seasonality | Month-based factor (e.g., July/August = 1.3x, December = 1.4x) plus weekend premium (Friday/Saturday = 1.15x) | 0.8x to 1.5x |
| Scarcity | If availability drops below 20%, apply 1.2x multiplier | +20% when nearly sold out |

The final dynamic price is: base_price * demand * seasonality * scarcity.

---

## Step 7: Background Worker for Reservation Expiry (4 minutes)

The reservation expiry worker polls every 60 seconds and performs these steps:

1. **Atomically expire stale reservations** - Run a single UPDATE query that sets status to "expired" for all bookings where status is "reserved" and expires_at is in the past. The RETURNING clause provides the affected booking details.

2. **Invalidate availability cache** - For each expired booking, delete all cached availability entries for that hotel/room type combination using a Redis key pattern match. This ensures search results immediately reflect the freed-up inventory.

3. **Track metrics** - Increment a Prometheus counter for expired bookings and log the count and processing duration.

4. **Error handling** - Catch and log any errors without crashing the worker, incrementing a worker error metric for monitoring.

---

## Step 8: Availability Caching Strategy (4 minutes)

The availability cache sits in Redis with a 5-minute TTL. Cache keys follow the pattern `availability:{hotelId}:{roomTypeId}:{checkIn}:{checkOut}`.

**Read path:** Check Redis for cached availability. On hit, increment a cache hit metric and return the result. On miss, increment a cache miss metric and fall through to the database query, then cache the result.

**Write path (invalidation):** When a booking is created, confirmed, cancelled, or expired, invalidate all cache entries that might overlap with the affected date range. For simplicity, a Redis key pattern match on the year-month prefix is used (e.g., `availability:{hotelId}:{roomTypeId}:2025-07*`), which may invalidate slightly more keys than necessary but ensures correctness.

> "The 5-minute TTL is acceptable because search results showing slightly stale availability is fine -- the booking service always checks real-time availability with pessimistic locking before confirming. This means search might occasionally show 'available' when the last room was just booked, but the booking attempt will correctly fail."

---

## Step 9: Search Service with Two-Phase Query (4 minutes)

The search service uses a two-phase approach:

**Phase 1 - Elasticsearch filtering:** Build an Elasticsearch query combining geo-distance queries (within 50km of location), city text matching, amenity term filters, star rating range filters, and max price range filters. Retrieve up to 100 candidate hotels.

**Phase 2 - Real-time availability check:** For each candidate hotel, run the PostgreSQL availability query in parallel (using Promise.all). Filter to only hotels with available rooms for the requested date range and room count. Enrich results with the lowest available price and available room type details.

**Ranking:** The available hotels are ranked based on the search parameters (relevance, price, rating, distance) and the top results are returned (default limit of 20).

> "This two-phase approach lets us leverage Elasticsearch's speed for filtering millions of hotels down to hundreds of candidates, then use PostgreSQL's ACID guarantees for the accuracy-critical availability check. The parallelized availability checks keep latency manageable even with 100 candidate hotels."

---

## Step 10: Trade-offs Discussion (3 minutes)

### Backend Trade-offs Table

| Decision | Approach | Trade-off | Rationale |
|----------|----------|-----------|-----------|
| Booking consistency | Pessimistic locking | Lower throughput vs. correctness | Double-booking has severe financial/trust impact |
| Availability storage | Range-based bookings | Complex queries vs. flexibility | One row per booking, easy date modifications |
| Reservation hold | 15-minute expiry | Blocked inventory vs. conversion | Gives users time to pay without permanent blocks |
| Availability cache | 5-min TTL + invalidation | Stale reads vs. DB load | Search tolerates staleness; booking checks fresh |
| Idempotency | SHA-256 of booking params | Storage overhead vs. safety | Prevents double-charges from retries |
| Distributed locks | Redis Redlock | Added complexity vs. safety | Only for flash sales/high-contention scenarios |

### Why Pessimistic Over Optimistic Locking

Optimistic locking (version columns with retry) would provide higher throughput but:
1. Requires complex retry logic with exponential backoff
2. May frustrate users with "room no longer available" after filling forms
3. At 100:1 read:write ratio, lock contention is already rare

Pessimistic locking is simpler and provides better UX for a booking system.

---

## Closing Summary

"I've designed a hotel booking backend with:

1. **PostgreSQL schema** using range-based bookings with generate_series for availability
2. **Pessimistic locking** via SELECT FOR UPDATE to prevent double bookings
3. **Distributed locks** using Redis Redlock for high-contention flash sales
4. **Idempotency keys** generated from booking parameters to prevent duplicate charges
5. **Two-phase search** combining Elasticsearch speed with PostgreSQL accuracy
6. **Background workers** for reservation expiry and cache invalidation

The key insight is separating the eventually-consistent search path from the strongly-consistent booking path, with intelligent caching bridging the performance gap. Happy to dive deeper into any component."

---

## Potential Follow-up Questions

1. **How would you handle payment gateway failures?**
   - Use circuit breaker pattern with Opossum library
   - Queue failed payments for retry with exponential backoff
   - Keep booking in 'reserved' state with extended expiry

2. **How would you implement overbooking?**
   - Add `soft_limit` column to room_types (typically 105% of total_rooms)
   - Use soft_limit for booking creation, total_rooms for hard stop
   - Automatic rebooking workflow when oversold

3. **How would you handle database failover?**
   - PostgreSQL streaming replication with automatic failover
   - PgBouncer for connection pooling and routing
   - Application retries with exponential backoff on connection errors
