# Local Delivery Service - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Problem Statement

Design a local delivery platform like DoorDash, Instacart, or Uber Eats. The core challenges are real-time driver location tracking with geo-indexing, efficient driver-order matching with scoring algorithms, route optimization for multi-stop deliveries, and handling the three-sided marketplace dynamics between customers, merchants, and drivers.

## Requirements Clarification

### Functional Requirements
- **Order placement**: Customers order from local merchants with item customization
- **Driver matching**: Match orders to nearby available drivers using scoring algorithm
- **Real-time tracking**: Live driver location and ETA updates via WebSocket
- **Route optimization**: Efficient routing for single and multi-stop deliveries
- **Notifications**: Order status updates to all parties
- **Ratings**: Two-way ratings for drivers and customers

### Non-Functional Requirements
- **Latency**: Driver match within 30 seconds, location updates every 3 seconds
- **Scale**: 1M orders/day, 100K concurrent drivers
- **Availability**: 99.99% for order placement
- **Accuracy**: ETA within 3 minutes 90% of the time

### Scale Estimates
- **Peak orders**: 35 orders/second (3x average during lunch/dinner)
- **Location updates**: 10,000 updates/second (30K drivers x 3-second intervals)
- **Storage**: 5GB/day orders, 86GB/day location history

## High-Level Architecture

```
                                    +-----------------------------+
                                    |       Client Apps           |
                                    | (Customer, Driver, Admin)   |
                                    +-------------+---------------+
                                                  |
                                       +----------+----------+
                                       |                     |
                                  HTTPS|                     |WebSocket
                                       |                     |
                            +----------v---------+   +-------v--------+
                            |    API Gateway     |   |   Real-time    |
                            |                    |   |    Gateway     |
                            +----------+---------+   +-------+--------+
                                       |                     |
        +------------------------------+---------------------+---------------+
        |                              |                     |               |
+-------v-------+           +----------v----------+   +------v------+       |
| Order Service |           |  Location Service   |   |  Tracking   |       |
|               |           |                     |   |  Service    |       |
| - Create      |           | - Driver positions  |   |             |       |
| - State machine|          | - Geo indexing      |   | - Pub/Sub   |       |
| - History     |           | - Nearby search     |   | - ETA       |       |
+-------+-------+           +----------+----------+   +-------------+       |
        |                              |                                     |
        |                   +----------+----------+                          |
        |                   |                     |                          |
        |            +------v------+      +-------v------+                   |
        |            |    Redis    |      |  TimeSeries  |                   |
        |            | (Geo Index) |      |     DB       |                   |
        |            +-------------+      +--------------+                   |
        |                                                                    |
        +------------------------------------+-------------------------------+
                                             |
                              +--------------v--------------+
                              |         PostgreSQL          |
                              |  (Orders, Users, Merchants) |
                              +-----------------------------+
```

## Deep Dives

### 1. PostgreSQL Schema Design

The schema handles the three-sided marketplace with 13 interconnected tables:

**Core Tables with Relationships:**

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **users** | id (UUID PK), email (unique), password_hash, name, phone, role, created_at, updated_at | Primary key on id, unique on email | Role CHECK constraint: customer, driver, merchant, admin |
| **drivers** | id (UUID PK, FK→users), vehicle_type, license_plate, status, rating, total_deliveries, acceptance_rate, current_lat, current_lng, location_updated_at | Primary key on id | 1:1 with users via shared UUID; status CHECK: offline, available, busy; vehicle_type CHECK: bicycle, motorcycle, car, van |
| **orders** | id (UUID PK), customer_id (FK→users), merchant_id (FK→merchants), driver_id (FK→drivers), status, delivery_address, delivery_lat/lng, subtotal, delivery_fee, tip, total, estimated_delivery_time, created_at, confirmed_at, picked_up_at, delivered_at, cancelled_at, archived_at, retention_days | Primary key on id | Status CHECK: pending, confirmed, preparing, ready_for_pickup, driver_assigned, picked_up, in_transit, delivered, cancelled |

**Why ON DELETE SET NULL for Orders?**

Orders use `SET NULL` for customer_id, merchant_id, and driver_id to preserve order history even if the associated entity is deleted. This is critical for:
- Financial auditing (orders remain queryable)
- Dispute resolution
- Historical analytics

**Driver Offers Table for Sequential Matching:**

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **driver_offers** | id (UUID PK), order_id (FK→orders), driver_id (FK→drivers), status, offered_at, expires_at, responded_at | Primary key on id | Status CHECK: pending, accepted, rejected, expired; expires_at set to 30 seconds after offer |

**Performance Indexes:**

| Index | Target Column(s) | Purpose |
|-------|-------------------|---------|
| idx_orders_status | orders(status) | Filter orders by lifecycle state |
| idx_orders_driver | orders(driver_id) WHERE status IN ('driver_assigned', 'picked_up', 'in_transit') | Partial index for active driver orders only |
| idx_orders_created | orders(created_at DESC) | Recent orders listing |
| idx_drivers_status | drivers(status) | Filter available drivers |
| idx_drivers_location | drivers(current_lat, current_lng) WHERE status = 'available' | Partial index for geo queries on available drivers only |

### 2. Redis Geo-Indexing for Driver Location

Redis GEOADD/GEORADIUS provides sub-millisecond nearby driver queries:

**Updating driver location:**

1. Store the driver's position using GEOADD into the `drivers:locations` sorted set (Redis uses longitude, latitude order)
2. Store metadata (lat, lng, updated_at, status) in a hash at `driver:{driverId}`
3. Publish the new coordinates to the `driver:{driverId}:location` pub/sub channel for real-time tracking subscribers

**Finding nearby drivers:**

1. Query GEORADIUS on the `drivers:locations` key with the pickup coordinates and radius (e.g., 5km)
2. Results come back sorted by distance ascending, limited to the top N candidates
3. For each result, fetch the driver's metadata hash and check the status field
4. Filter out drivers who are not currently available

**Geohash Partitioning for Scale:**

For millions of drivers, partition the geo index by geohash cells to distribute load across multiple Redis keys:

1. Compute the geohash of the search center at an appropriate precision level (precision 6 for sub-1km, 5 for sub-10km, 4 for wider searches)
2. Get the center cell plus its 8 neighbors (9 cells total to cover boundary cases)
3. Query GEORADIUS on each cell's Redis key (`drivers:geo:{cell}`) in parallel
4. Merge and deduplicate results

**Redis Data Structures:**

```
# Driver locations (geo index)
drivers:locations          -> GEOADD (lng, lat, driver_id)
drivers:geo:{geohash}      -> GEOADD (partitioned by geohash)

# Driver metadata
driver:{id}                -> HASH (lat, lng, status, updated_at)

# Active orders by driver
driver:{id}:orders         -> SET [order_ids]

# Session storage
session:{token}            -> JSON {userId, expiresAt}

# Real-time location pubsub
driver:{id}:location       -> PUBSUB channel
order:{id}:status          -> PUBSUB channel
```

### 3. Driver Matching Algorithm

Multi-factor scoring considers distance, rating, acceptance rate, and current load:

The matching algorithm works in three steps:

**Step 1 -- Find nearby available drivers** within a 5km radius of the merchant using Redis GEORADIUS (as described above). If no drivers are found, return null.

**Step 2 -- Score each driver** using four weighted factors:

| Factor | Weight | Calculation | Rationale |
|--------|--------|-------------|-----------|
| Distance | 40% | 1 - (distance / 5km), floored at 0 | Closer drivers reach the merchant faster |
| Rating | 25% | rating / 5 (normalized 0-1) | Higher-rated drivers provide better service |
| Acceptance rate | 20% | Raw rate (already 0-1) | Drivers who accept more are more reliable |
| Load balancing | 15% | 1 - (current_orders / 3), floored at 0 | Fewer active orders means faster delivery |

**Step 3 -- Sort by total score** descending and return the highest-scoring driver.

> "Distance dominates at 40% because it's the primary determinant of pickup time, which directly impacts the customer's wait. However, we don't want to always pick the closest driver -- a driver with a 3.2 rating at 0.5km is worse than a 4.9-rated driver at 1.5km. The weighted approach lets us balance immediacy against quality."

**Sequential Offer Flow with Timeout:**

Once the best driver is identified, the system offers the order sequentially rather than broadcasting:

1. Attempt up to 5 drivers, one at a time
2. For each attempt: create a driver_offers record with a 30-second expiry, send the offer via WebSocket, and wait for a response
3. If the driver accepts, assign the order and return success
4. If the driver rejects or the 30-second timer expires, add them to an exclusion set and try the next best driver
5. If all 5 attempts fail, notify the customer that no driver is available

### 4. Idempotency for Order Creation

Prevent duplicate orders on network retries:

The idempotency wrapper follows these steps:

1. If no idempotency key is provided, execute the operation directly (no deduplication)
2. Check the `idempotency_keys` table for a matching (key, user_id) pair. If a completed record exists, return the cached response immediately
3. Insert a pending record with the key, user_id, operation name, and a 24-hour expiry (using ON CONFLICT DO NOTHING to handle races)
4. Execute the actual operation
5. Update the record to 'completed' and store the serialized response
6. Return the result

The API route uses this wrapper by reading the `X-Idempotency-Key` header and passing it to the wrapper. Cached responses return HTTP 200; fresh responses return HTTP 201.

### 5. Order Status Transitions with Optimistic Locking

Prevent race conditions in status updates:

The status update function uses optimistic locking via a WHERE clause that includes both the order ID and the expected current status. If another process has already changed the status, the UPDATE affects zero rows and returns false, signaling a conflict.

On a successful transition, the function publishes a status change event to the Redis pub/sub channel `order:{orderId}:status` for real-time subscribers.

For example, when a driver picks up an order, the system attempts to transition from 'preparing' to 'picked_up'. If successful, it additionally records the picked_up_at timestamp. If the transition fails (order was already cancelled, or another driver picked it up), the function throws an error rather than silently succeeding.

> "Optimistic locking via the status WHERE clause is simpler than database-level row locks and avoids deadlocks. In practice, status transitions happen sequentially for a given order, so conflicts are rare -- but when they do occur (e.g., simultaneous cancel and pickup), we need the safety net."

### 6. Circuit Breaker for Matching Service

Protect the system when dependencies fail:

The circuit breaker wraps the driver matching function with three configuration parameters: 3-minute timeout per attempt, 50% error threshold to trip the circuit, minimum 3 requests before evaluation, and 30-second recovery wait before testing again.

**Circuit States:**
1. **Closed**: All requests pass through, failures counted
2. **Open**: Requests fail immediately with fallback
3. **Half-Open**: One request allowed to test recovery

When the circuit is open, the fallback handler keeps the order in 'pending' status for manual intervention or later retry, rather than failing the order entirely.

### 7. Data Retention Policies

Tiered storage for cost-effective data lifecycle:

| Table | Hot Storage (days) | Warm Storage (days) | Archive Enabled |
|-------|-------------------|---------------------|-----------------|
| orders | 30 | 365 | Yes |
| driver_location_history | 7 | 30 | Yes |
| idempotency_keys | 1 | 1 | Yes |
| sessions | 1 | 1 | Yes |

These policies are stored in a `retention_policies` table with columns for table_name (unique), hot_storage_days, warm_storage_days, archive_enabled, and last_cleanup_at.

**Cleanup Job:**

The retention cleanup runs as a scheduled job and performs three operations:

1. **Delete expired idempotency keys**: Remove all records where expires_at is in the past
2. **Archive old orders**: Select orders older than 30 days that haven't been archived yet, export each to object storage (MinIO/S3), then mark them with an archived_at timestamp
3. **Purge old location history**: Delete driver_location_history records older than 30 days

> "We keep the order rows in PostgreSQL even after archival (just marked with archived_at) to support quick lookups by ID. The object storage archive is for bulk analytical queries and regulatory compliance. Location history, being high-volume and low-value after 30 days, is deleted outright."

## Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Geo-indexing | Redis GEOADD | PostgreSQL PostGIS | Sub-ms queries for real-time matching; PostGIS better for analytics |
| Location updates | 3-second interval | 1-second / 5-second | Balance accuracy vs. bandwidth/battery drain |
| Driver offers | Sequential | Broadcast to all | Fairer to drivers, avoids race conditions |
| Order matching | Scoring algorithm | First available | Multi-factor scoring improves quality and driver satisfaction |
| Idempotency | PostgreSQL table | Redis with TTL | ACID guarantees for financial operations |
| Authentication | Session tokens + Redis | JWT | Instant revocation, simpler refresh flow |
| Partitioning | Geohash cells | City-based | Finer granularity, better edge case handling |

## Future Enhancements

1. **Surge pricing**: Monitor demand/supply ratio by zone, apply dynamic multipliers
2. **Multi-stop TSP optimization**: Solve traveling salesman for batched deliveries
3. **ML demand prediction**: Train model on historical data for driver positioning
4. **Real-time traffic integration**: Use Google Maps traffic API for accurate ETAs
5. **PostgreSQL partitioning**: Partition orders by month for efficient archival
6. **Read replicas**: Scale read-heavy endpoints (merchant browsing, order history)
