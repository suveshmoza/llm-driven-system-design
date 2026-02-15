# Bitly (URL Shortener) - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Problem Statement

Design the backend infrastructure for a URL shortening service that:
- Generates unique 7-character short codes at scale
- Handles 100:1 read-to-write ratio with sub-50ms redirect latency
- Tracks analytics (clicks, referrers, devices, geography)
- Supports custom short codes and link expiration

## Requirements Clarification

### Functional Requirements
1. **URL Shortening**: Generate short codes from long URLs
2. **URL Redirection**: Fast lookup and redirect to original URL
3. **Custom Short Codes**: User-specified short codes with validation
4. **Analytics Tracking**: Click counts, referrers, device types, timestamps
5. **Link Expiration**: Optional TTL for short URLs
6. **User Management**: Session-based authentication, URL ownership

### Non-Functional Requirements
1. **Latency**: < 50ms p99 for redirects, < 200ms for API calls
2. **Throughput**: 40,000 RPS for redirects at peak
3. **Availability**: 99.99% uptime for redirect service
4. **Consistency**: Strong for URL creation, eventual for analytics

### Scale Estimates
- 100M URLs created/month (~40 writes/second)
- 10B redirects/month (~4,000 reads/second)
- 6B URLs stored (5-year retention)
- 100:1 read-to-write ratio

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Load Balancer (nginx/GeoDNS)                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │ API Server  │ │ API Server  │ │ API Server  │
            │   (Node)    │ │   (Node)    │ │   (Node)    │
            └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
                   │               │               │
                   └───────────────┼───────────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            │                      │                      │
            ▼                      ▼                      ▼
    ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
    │    Valkey    │      │  PostgreSQL  │      │   RabbitMQ   │
    │   (Cache +   │      │   (Primary   │      │  (Analytics  │
    │   Sessions)  │      │   Sharded)   │      │    Queue)    │
    └──────────────┘      └──────────────┘      └──────────────┘
                                                       │
                                                       ▼
                                               ┌──────────────┐
                                               │  ClickHouse  │
                                               │  (Analytics) │
                                               └──────────────┘
```

## Deep Dive: Database Schema

### Core Tables

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **users** | id (UUID PK), email (unique), password_hash, role (user/admin) | — | Standard user table with role-based access |
| **key_pool** | short_code (VARCHAR(7) PK), is_used (boolean), allocated_to (server instance ID), allocated_at | idx_key_pool_unused (partial: WHERE is_used = FALSE) | Pre-generated short codes for allocation to server instances |
| **urls** | id (UUID PK), short_code (unique VARCHAR(7)), long_url (text), user_id (FK), is_custom, is_active, expires_at, click_count (bigint) | idx_urls_short_code, idx_urls_user_id, idx_urls_expires (partial: WHERE expires_at IS NOT NULL) | Main URL mapping table with optional expiration |
| **click_events** | id (UUID PK), url_id (FK cascade), short_code, referrer, user_agent, device_type (mobile/tablet/desktop), country_code, ip_hash (SHA-256) | idx_clicks_short_code, idx_clicks_time (clicked_at) | Click tracking for analytics, IP hashed for privacy |
| **sessions** | id (UUID PK), user_id (FK cascade), token (unique), expires_at | idx_sessions_token | Session-based authentication |

### Why PostgreSQL?

| Consideration | PostgreSQL | Cassandra | DynamoDB |
|---------------|------------|-----------|----------|
| ACID transactions | Full | Limited | Limited |
| Custom code validation | Easy (unique constraint) | Complex | Complex |
| Query flexibility | Excellent | Limited | Limited |
| Sharding | Manual but predictable | Automatic | Automatic |

**Decision**: PostgreSQL with manual sharding by short_code prefix. The unique constraint on short_code ensures no collisions between custom codes and generated codes.

## Deep Dive: Short Code Generation

### Pre-generated Key Pool Service

Each API server maintains a local in-memory cache of pre-allocated short codes. The process works as follows:

1. **Get a short code** - Pop a code from the local cache. If the cache drops below 20 entries, trigger a background refill.
2. **Refill the cache** - Atomically fetch a batch of 100 unused, unallocated codes from the key_pool table using a CTE with `FOR UPDATE SKIP LOCKED` to avoid contention between servers. Mark the fetched codes as allocated to this server instance.
3. **Generate new keys** - A background process generates random 7-character codes from a base-62 alphabet (a-z, A-Z, 0-9), batch-inserts them into the key_pool table, and uses `ON CONFLICT DO NOTHING` to skip any collisions with existing codes.

### Why Pre-generated Pool?

| Approach | Pros | Cons |
|----------|------|------|
| Hash-based | Deterministic, dedup built-in | Collisions, predictable, privacy issues |
| Counter-based | Simple, guaranteed unique | Single point of failure, predictable |
| **Pre-generated pool** | No coordination, random, unique | Slight complexity, key management |

**Decision**: Pre-generated pool with batch allocation to each server instance.

## Deep Dive: Redirect Service

### Cache-Aside Pattern with Fallback

The redirect service uses a three-tier lookup strategy to resolve short codes to long URLs:

1. **Tier 1 - Local LRU cache** (in-memory, 10K entries max, 60-second TTL): Check the local in-process cache first. This avoids any network call for hot URLs and provides sub-millisecond lookups.

2. **Tier 2 - Redis cache** (shared across servers, 24-hour TTL): On local cache miss, check Redis. If found, populate the local cache and return. Redis errors are caught and treated as cache misses (the system continues to the database).

3. **Tier 3 - PostgreSQL** (source of truth, wrapped in a circuit breaker): Query the urls table by short_code. Check that the URL is active and not expired. On success, populate both Redis (24-hour TTL) and local cache.

If the URL is not found at any tier, return null. The circuit breaker prevents cascading database failures from overwhelming the system.

### Redirect Endpoint

The redirect handler at `GET /:shortCode` works as follows:

1. Look up the long URL via the three-tier cache (local, Redis, database).
2. If not found, return 404.
3. If found, immediately return a **302 redirect** to the long URL.
4. **After** sending the response, asynchronously (non-blocking) track the click by publishing an analytics event with the short code, referrer, user agent, and IP address. Analytics errors are logged but never block the redirect.
5. Record redirect latency and cache hit/miss metrics.

### Why 302 vs 301?

| Response Code | Behavior | Analytics Impact |
|---------------|----------|------------------|
| 301 Permanent | Browser caches, never hits server again | Loses all future clicks |
| **302 Temporary** | Browser always requests server | Captures every click |

**Decision**: Use 302 for accurate analytics tracking, accepting slightly higher server load.

## Deep Dive: Analytics Pipeline

### Async Processing with RabbitMQ

**Analytics Producer:** When a click occurs, the service enriches the raw event with a UUID, parsed device type (mobile/tablet/desktop based on user-agent regex), geolocated country code from the IP address, and a SHA-256 hash of the IP (for privacy). The enriched event is published to the "click_events" routing key on the "analytics" exchange in RabbitMQ.

**Analytics Worker:** The worker consumes click events from the queue and performs two database operations: (1) Insert the click event into the click_events table, joining with the urls table to resolve the url_id from the short_code. (2) Increment the denormalized click_count on the urls table for fast read access.

### ClickHouse for Analytics (Production)

At production scale, click events are stored in ClickHouse for high-volume analytical queries.

| Table | Key Columns | Engine | Notes |
|-------|-------------|--------|-------|
| **click_events** | short_code (String), clicked_at (DateTime), referrer (String), device_type (LowCardinality String), country_code (LowCardinality String), url_id (UUID) | MergeTree, partitioned by month (toYYYYMM), ordered by (short_code, clicked_at) | Raw click events optimized for time-range queries |
| **clicks_daily_mv** (materialized view) | short_code, date, clicks (count), unique_visitors (uniqExact of ip_hash) | SummingMergeTree, ordered by (short_code, date) | Pre-aggregated daily summaries that update automatically as new events arrive |

## Deep Dive: Caching Strategy

### Multi-Tier Cache Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Request Flow                            │
│                                                              │
│  Redirect ──► Local LRU (60s) ──► Redis (24h) ──► PostgreSQL│
│  Session  ──► Redis (7d) ──► PostgreSQL                     │
│  Rate Limit ──► Redis (1m sliding window)                   │
│  Idempotency ──► Redis (24h)                                │
└─────────────────────────────────────────────────────────────┘
```

### Cache Key Design

| Cache Key Pattern | Purpose | TTL |
|-------------------|---------|-----|
| `url:{shortCode}` | URL lookup (hot path) | 24h |
| `session:{token}` | Session storage | 7d |
| `rate:{ip}:{endpoint}` | Rate limiting | 1 min |
| `idempotency:{fingerprint}` | Idempotency for URL creation | 24h |

### Cache Invalidation

Cache invalidation follows three patterns:

- **URL deactivated or expired**: Delete the key from both Redis and the local LRU cache immediately.
- **URL updated** (long URL changed): Write-through update -- set the new value in Redis with a fresh 24-hour TTL and update the local cache simultaneously.

## Deep Dive: Rate Limiting

### Sliding Window Counter in Redis

The rate limiter uses a Redis sorted set to implement a sliding window counter:

1. **Remove old entries** - Use ZREMRANGEBYSCORE to remove all entries with timestamps before the window start (current time minus window duration).
2. **Add current request** - ZADD the current timestamp with a unique member (timestamp + UUID to avoid collisions).
3. **Count requests in window** - ZCOUNT entries between the window start and now.
4. **Set key expiry** - Set the sorted set TTL to the window duration to auto-clean up.

All four operations run in a single Redis pipeline for atomicity.

**Rate limit configuration:**

| Endpoint | Limit | Window |
|----------|-------|--------|
| Create URL | 10 requests | 60 seconds |
| Redirect | 1,000 requests | 60 seconds |
| Auth (login) | 5 requests | 60 seconds |

## Deep Dive: Database Sharding

### Sharding Strategy by Short Code Prefix

The shard router maintains a pool of PostgreSQL connections for each shard. Routing is determined by the first character of the short code:

| Shard | Character Range |
|-------|----------------|
| shard_0 | 0-9, a-f |
| shard_1 | g-m |
| shard_2 | n-t |
| shard_3 | u-z |
| shard_4 | A-Z |

Given a short code, the router extracts the first character, maps it to the appropriate shard, and returns the corresponding database connection pool.

### Why Shard by Short Code?

- **Primary access pattern**: All redirects query by short_code
- **Even distribution**: Base62 characters are uniformly distributed
- **Simple routing**: First character determines shard
- **Future growth**: Add shards by splitting existing ones

## API Design

### RESTful Endpoints

```
# URL Operations
POST   /api/v1/shorten              Create short URL
GET    /api/v1/urls/:code           Get URL metadata
GET    /api/v1/urls/:code/stats     Get click analytics
DELETE /api/v1/urls/:code           Deactivate URL

# Redirect (no /api prefix)
GET    /:short_code                 302 redirect to long URL

# Authentication
POST   /api/v1/auth/register        Create account
POST   /api/v1/auth/login           Start session
POST   /api/v1/auth/logout          End session

# Admin
GET    /api/v1/admin/stats          System statistics
POST   /api/v1/admin/key-pool       Repopulate key pool
```

### Request/Response Examples

**Create Short URL**:

A POST request to `/api/v1/shorten` with an Idempotency-Key header accepts a JSON body containing the long_url, an optional custom_code, and an optional expires_at timestamp. On success (201 Created), the response includes the full short_url, the short_code, the original long_url, expiration time, and creation timestamp.

## Monitoring and Observability

### Key Metrics

Application metrics exposed via Prometheus include: total HTTP requests (by method, endpoint, status), request duration histogram (by method, endpoint), URL shortening operations (by status), redirect counts (by cache tier), cache hits and misses (by tier), available keys in the key pool, pending queue messages, and circuit breaker state (by service).

### Health Checks

The detailed health endpoint at `GET /health/detailed` checks connectivity to all dependencies (database, Redis, RabbitMQ) and reports the key pool local cache size and circuit breaker state. It returns 200 if all dependencies are connected, or 503 if any dependency is unhealthy.

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Pre-generated key pool | No coordination, random codes | Key management complexity |
| 302 redirect | Accurate analytics | Higher server load |
| Two-tier cache | Low latency, shared state | Memory overhead |
| Async analytics | Non-blocking redirects | Slight delay in stats |
| PostgreSQL sharding | Predictable, ACID | Manual shard management |
| RabbitMQ for analytics | Backpressure handling | Additional infrastructure |

## Future Backend Enhancements

1. **Bloom Filter**: Skip database lookup for non-existent codes
2. **CDN Edge Workers**: Redirect at edge for global latency
3. **Malicious URL Detection**: Integrate Google Safe Browsing API
4. **Bulk API**: Create multiple short URLs in single request
5. **Webhooks**: Notify on click thresholds
6. **Multi-region**: Active-active deployment with cross-region replication
7. **Event Sourcing**: Audit trail for all URL operations
