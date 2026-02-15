# Scalable API - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

---

## 1. Problem Statement (2 minutes)

"Design a scalable API platform that can handle millions of requests per day with consistent low latency, high availability, and protection against abuse."

This is an **infrastructure-focused problem** requiring expertise in:
- Horizontal scaling and stateless design
- Multi-level caching strategies
- Rate limiting algorithms
- Circuit breaker patterns
- Load balancing and health monitoring

---

## 2. Requirements Clarification (3 minutes)

### Functional Requirements
- RESTful API endpoints with versioning
- API key authentication and authorization
- Tiered rate limiting (anonymous, free, pro, enterprise)
- Request/response logging and analytics
- Health check endpoints for orchestration

### Non-Functional Requirements
- **Latency**: P99 < 100ms for cached responses
- **Throughput**: 100K+ requests per minute at peak
- **Availability**: 99.9% uptime (8.7 hours downtime/year)
- **Scalability**: Horizontal scaling without code changes

### Backend-Specific Clarifications
- "What caching strategy?" - Two-level: local L1 (5s TTL) + Redis L2 (configurable)
- "Rate limiting algorithm?" - Sliding window with Redis sorted sets
- "Failure handling?" - Circuit breakers per dependency, graceful degradation
- "Database choice?" - PostgreSQL with partitioned tables for request logs

---

## 3. High-Level Architecture (5 minutes)

```
                                    ┌─────────────────┐
                                    │   API Gateway   │
                                    │  (Rate Limit)   │
                                    └────────┬────────┘
                                             │
                                    ┌────────▼────────┐
                                    │  Load Balancer  │
                                    │ (Least Conns)   │
                                    └────────┬────────┘
                         ┌───────────────────┼───────────────────┐
                         │                   │                   │
                    ┌────▼────┐         ┌────▼────┐         ┌────▼────┐
                    │ API-1   │         │ API-2   │         │ API-3   │
                    │ :3001   │         │ :3002   │         │ :3003   │
                    └────┬────┘         └────┬────┘         └────┬────┘
                         │                   │                   │
         ┌───────────────┴───────────────────┴───────────────────┘
         │
    ┌────▼────┐     ┌─────────────┐     ┌──────────────┐
    │ L1 Cache│────▶│ Redis (L2)  │     │  PostgreSQL  │
    │ (Local) │     │   Cache     │     │  (Primary)   │
    └─────────┘     └─────────────┘     └──────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| API Gateway | Rate limiting, authentication, request routing |
| Load Balancer | Traffic distribution, health checking, connection management |
| API Servers | Stateless request processing, business logic |
| L1 Cache | In-memory hot data, reduces Redis round-trips |
| Redis (L2) | Distributed cache, rate limit counters, session storage |
| PostgreSQL | Persistent storage, request logs, API key metadata |

---

## 4. Deep Dives (25 minutes)

### Deep Dive 1: Two-Level Caching Architecture (8 minutes)

**Challenge**: Minimize latency while maintaining cache consistency across distributed servers.

**Solution**: Cache-aside pattern with local L1 and Redis L2 caches.

The cache service implements a two-level lookup:

1. **L1 check** — look up the key in a local in-memory Map with 5-second TTL entries. On hit, increment `cache.l1.hit` metric and return immediately.
2. **L2 check** — on L1 miss, query Redis. On hit, parse the JSON value, populate L1 from the L2 result, increment `cache.l2.hit`, and return.
3. **Full miss** — increment `cache.miss` and return null.

**Writing**: When setting a cache value, both L1 (local Map with TTL timestamp) and L2 (Redis with configurable TTL, default 5 minutes) are updated simultaneously.

**Get-or-fetch pattern**: A `getOrFetch` helper wraps the two-level lookup with a fallback function. On miss, the fetch function is called, and the result is stored in both cache levels before returning.

**Cache Invalidation Strategies**:

| Strategy | Use Case | Implementation |
|----------|----------|----------------|
| TTL-based | Static resources, config | Automatic expiry |
| Event-driven | User data updates | Pub/sub invalidation |
| Write-through | Critical data | Update cache on write |
| Stale-while-revalidate | Non-critical data | Serve stale, refresh async |

**L1 Cache Considerations**:
- Short TTL (5s) prevents stale data across instances
- No coordination needed between servers
- Automatic cleanup via TTL checks
- Memory bounded by LRU eviction

---

### Deep Dive 2: Sliding Window Rate Limiting (8 minutes)

**Challenge**: Accurate rate limiting across distributed servers without race conditions.

**Solution**: Sliding window algorithm using Redis sorted sets for atomic operations.

The rate limiter defines tier-based limits:

| Tier | Requests/Minute | Window |
|------|-----------------|--------|
| Anonymous | 100 | 60s |
| Free | 1,000 | 60s |
| Pro | 10,000 | 60s |
| Enterprise | 100,000 | 60s |

The core algorithm is implemented as an atomic Lua script on Redis:

1. Remove expired entries from the sorted set (score < window start timestamp)
2. Count remaining entries (current request count)
3. If under the limit, add the current timestamp as both score and member, set an expiry on the key, and return allowed with the updated count
4. If at or over the limit, return denied

The middleware extracts the client identifier (API key ID or IP address), determines the tier, calls the rate limiter, and sets standard response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. If denied, it adds `Retry-After` and returns 429.

**Why Sliding Window over Fixed Window**: Fixed window allows 2x burst at window boundaries. Sliding window provides smooth distribution and accurate limiting. The trade-off is O(requests per window) memory in the sorted set, but atomic operations prevent race conditions across distributed servers.

---

### Deep Dive 3: Circuit Breaker Pattern (5 minutes)

**Challenge**: Prevent cascading failures when downstream dependencies fail.

**Solution**: Per-dependency circuit breakers with three states.

The circuit breaker tracks failure counts and transitions between states:

- **CLOSED** (normal operation): Requests pass through. Failures are counted. When failures exceed the threshold (default 5), the breaker opens.
- **OPEN** (failing fast): All requests are immediately rejected or routed to the fallback. After a reset timeout (default 60 seconds), the breaker moves to half-open.
- **HALF_OPEN** (recovery testing): Requests pass through tentatively. If enough succeed (default 3), the breaker closes. If any fail, it reopens.

Each operation has a timeout (default 30 seconds). If the operation exceeds this, it is treated as a failure. The `execute` method accepts an optional fallback function that is invoked when the circuit is open or a failure occurs.

**State Transitions**:

```
                    ┌─────────────────────────────────────┐
                    │                                     │
                    ▼                                     │
    ┌──────────┐  failure   ┌──────────┐  timeout   ┌────┴─────┐
    │  CLOSED  │──threshold─▶│   OPEN   │───────────▶│HALF_OPEN │
    │          │            │          │            │          │
    └────┬─────┘            └──────────┘            └────┬─────┘
         │                        ▲                      │
         │                        │                      │
         └────────────────────────┼──────────────────────┘
                             failure               success threshold
```

---

### Deep Dive 4: Load Balancer with Health Checks (4 minutes)

**Solution**: Least connections algorithm with active health monitoring.

The load balancer maintains a list of backend servers, each with a health status, active connection count, and weight. The server selection algorithm picks the healthy server with the lowest `connections / weight` ratio, which naturally distributes traffic to less-loaded or higher-capacity servers.

**Health checks** run every 10 seconds against each server's `/health/ready` endpoint (5-second timeout). A server is marked unhealthy after 3 consecutive failures and marked healthy again on the next successful check.

**Health check endpoints** follow the Kubernetes convention:

- **Liveness** (`/health/live`): Returns 200 if the process is running. Used to detect deadlocks.
- **Readiness** (`/health/ready`): Checks database connectivity, Redis connectivity, and memory usage. Returns 200 if all checks pass, 503 otherwise. Used by the load balancer to determine if a server can accept traffic.

---

## 5. Database Schema (3 minutes)

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **api_keys** | id (UUID PK), user_id (FK users), key_hash (SHA-256, unique), key_prefix (first 8 chars for display), tier (default 'free'), scopes (TEXT array), rate_limit_override, is_active, created_at, last_used_at, expires_at | key_hash WHERE is_active = true (partial index) | Only the hash is stored, never the raw key |
| **request_logs** | id (BIGSERIAL), timestamp, api_key_id (FK api_keys), method, path, status_code, response_time_ms, request_size, response_size, ip_address, user_agent, error_message, server_id | timestamp DESC; (api_key_id, timestamp DESC) | Partitioned by RANGE on timestamp with monthly partitions for lifecycle management |
| **rate_limit_configs** | id (SERIAL PK), tier (unique), requests_per_minute, burst_allowance, updated_at | — | Configurable per-tier rate limits |

**Data Lifecycle**:

| Data Type | Retention | Storage |
|-----------|-----------|---------|
| Request logs (raw) | 7 days | Hot partition |
| Request logs (aggregated) | 90 days | Warm partition |
| API key metadata | Indefinite | Primary tables |
| Rate limit state | Window duration | Redis |

---

## 6. Trade-offs Summary (2 minutes)

| Decision | Trade-off | Rationale |
|----------|-----------|-----------|
| Two-level cache | Memory duplication | L1 reduces Redis latency by 90% for hot keys |
| Sliding window | More Redis operations | Prevents window boundary bursts |
| Per-dependency circuit breakers | Complexity | Isolates failures, prevents cascade |
| Partitioned logs | Query complexity | Enables efficient data lifecycle |
| Stateless servers | No local state | Enables true horizontal scaling |

---

## 7. Future Enhancements

1. **Adaptive Rate Limiting**: Adjust limits based on server load
2. **Request Coalescing**: Deduplicate concurrent identical requests
3. **Geographic Distribution**: Multi-region deployment with routing
4. **Token Bucket Hybrid**: Combine sliding window with burst tokens
5. **Predictive Scaling**: Auto-scale based on traffic patterns
