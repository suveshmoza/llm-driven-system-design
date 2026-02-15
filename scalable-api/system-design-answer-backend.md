# Scalable API Platform — System Design Answer (Backend Focus)

*45-minute system design interview — Backend Engineer Position*

---

## 📋 Opening Statement

"I'll design a scalable API platform that serves millions of requests per day with consistent low latency, high availability, and protection against abuse. The core backend challenges are horizontal scaling with stateless services, multi-level caching to minimize database pressure, distributed rate limiting that works correctly across multiple gateway instances, and circuit breakers that prevent cascading failures when downstream dependencies degrade."

---

## 🎯 Requirements

### Functional Requirements

- Serve RESTful API endpoints with versioning (v1, v2)
- Authenticate requests via API keys with tiered permissions
- Rate limit by tier: anonymous (100/min), free (1K/min), pro (10K/min), enterprise (100K/min)
- Log all requests for analytics, debugging, and auditing
- Expose health check endpoints for load balancer and orchestration

### Non-Functional Requirements

- **Latency**: P99 < 100ms for cached responses, P99 < 500ms for uncached
- **Throughput**: 100K+ requests per minute at peak
- **Availability**: 99.9% uptime (8.7 hours downtime per year)
- **Scalability**: Linear horizontal scaling — doubling instances doubles capacity
- **Durability**: No request log loss under normal operation; graceful degradation under partition

---

## 📊 Capacity Estimation

| Metric | Value | Derivation |
|--------|-------|------------|
| Daily requests | 50M | ~580 RPS average |
| Peak RPS | 1,700 | 3x average (traffic spikes) |
| Request log storage | ~10 GB/day | 50M rows x ~200 bytes each |
| Active API keys | 50K | Across all tiers |
| Rate limit keys in Redis | 100K | API key IDs + anonymous IPs |
| Cache entries (L2 Redis) | 500K | API responses, key metadata |
| L1 cache per instance | ~50 MB | In-memory Map with 5s TTL |

**Instance sizing**: Each Node.js API server handles ~500 RPS under load. At 1,700 peak RPS, we need at minimum 4 instances behind the load balancer, with headroom for failures — so 6 instances in production.

---

## 🏗️ High-Level Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                         Clients                               │
│              (Web, Mobile, Third-party Apps)                   │
└───────────────────────────┬───────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────────┐
│                    API Gateway Layer                           │
│         (Auth, Rate Limiting, Request ID, Logging)            │
└───────────────────────────┬───────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────────┐
│                     Load Balancer                              │
│           (Least Connections + Health Checks)                  │
└───────────────────────────┬───────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
       ┌────▼────┐     ┌────▼────┐     ┌────▼────┐
       │  API-1  │     │  API-2  │     │  API-3  │
       │ :3001   │     │ :3002   │     │ :3003   │
       └────┬────┘     └────┬────┘     └────┬────┘
            │               │               │
            └───────────────┼───────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
    ┌────▼────┐       ┌─────▼─────┐      ┌────▼─────┐
    │  Redis  │       │PostgreSQL │      │ RabbitMQ │
    │ (Cache  │       │ (Primary  │      │ (Async   │
    │  + Rate │       │  + Logs)  │      │  Logs)   │
    │  Limits)│       │           │      │          │
    └─────────┘       └───────────┘      └──────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| API Gateway | Request ID assignment, API key authentication, rate limiting enforcement, request logging trigger |
| Load Balancer | Distribute traffic via least-connections algorithm, active health checking every 10s, remove unhealthy backends |
| API Servers (stateless) | Business logic, cache-aside reads, write-through updates, circuit breaker wrapping for external calls |
| Redis | L2 distributed cache (5-min TTL), rate limit sorted sets, session storage, pub/sub for cache invalidation |
| PostgreSQL | Users, API keys (hashed), request logs (partitioned by month), rate limit config overrides, resources |
| RabbitMQ | Async request log ingestion to decouple hot path from write latency |

---

## 💾 Data Model

### users

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | Auto-generated |
| email | VARCHAR(255), unique | Login identifier |
| password_hash | VARCHAR(64) | SHA-256, never store plaintext |
| role | VARCHAR(20) | 'user' or 'admin' |
| tier | VARCHAR(20) | 'free', 'pro', or 'enterprise' — drives default rate limits |
| created_at | TIMESTAMP | Account creation |
| last_login | TIMESTAMP | Updated on each login |

Indexed on email for authentication lookups. Role column enables simple RBAC without a separate roles table.

### api_keys

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | Auto-generated |
| user_id | UUID (FK to users) | Owning user, CASCADE on delete |
| key_hash | VARCHAR(64), unique | SHA-256 of the raw key — raw key never stored |
| key_prefix | VARCHAR(8) | First 8 chars for display (e.g., "sk_live_") |
| tier | VARCHAR(20) | Can differ from user tier for limited-access keys |
| scopes | TEXT[] | Array of allowed API scopes |
| rate_limit_override | JSONB | Custom limits: {"requests_per_minute": N} |
| is_active | BOOLEAN | Soft-delete flag |
| created_at | TIMESTAMP | Key creation |
| last_used_at | TIMESTAMP | Updated on each API call |
| expires_at | TIMESTAMP | Optional expiration |

Partial index on key_hash WHERE is_active = true for O(1) authentication lookups. The key_prefix allows admins to identify keys in the dashboard without exposing the hash.

### request_logs (partitioned)

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL | Auto-incrementing for partition-local ordering |
| timestamp | TIMESTAMP (PK component) | Request time, partition key |
| api_key_id | UUID (FK) | Which key was used (nullable for session auth) |
| method | VARCHAR(10) | GET, POST, PUT, DELETE |
| path | VARCHAR(500) | Request path |
| status_code | INTEGER | HTTP response status |
| response_time_ms | INTEGER | End-to-end latency |
| request_size | INTEGER | Request body bytes |
| response_size | INTEGER | Response body bytes |
| ip_address | INET | Client IP |
| server_id | VARCHAR(50) | Which instance handled the request |

Partitioned by RANGE on timestamp with monthly partitions. Indexes on (timestamp DESC) and (api_key_id, timestamp DESC) are inherited by each partition. Old partitions are detached and dropped — O(1) vs slow DELETE operations on a monolithic table.

### rate_limit_configs

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL (PK) | Auto-incrementing |
| tier | VARCHAR(20), unique | Target tier |
| requests_per_minute | INTEGER | Allowed requests per minute |
| burst_allowance | INTEGER | Max burst above sustained rate |

Loaded into memory on startup and refreshed periodically. Changes take effect within seconds across all gateway instances.

**Data retention policy**: Raw request logs are kept 7 days in hot PostgreSQL partitions, aggregated summaries for 90 days, and API key metadata indefinitely. Rate limit state lives entirely in Redis with automatic TTL expiry matching the window duration.

---

## 🔌 API Design

### Public API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/resources | List resources (paginated, cached) |
| GET | /api/v1/resources/:id | Get single resource (cached) |
| POST | /api/v1/resources | Create resource |
| PUT | /api/v1/resources/:id | Update resource (invalidates cache) |
| DELETE | /api/v1/resources/:id | Delete resource (invalidates cache) |
| GET | /api/v1/status | Platform status and version |

### Admin API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/admin/metrics/current | Aggregated metrics: RPS, latency percentiles, error rate |
| GET | /api/v1/admin/servers/health | Per-instance health: status, CPU, memory, connections |
| GET | /api/v1/admin/keys | List all API keys with usage stats |
| POST | /api/v1/admin/keys | Create API key, returns raw key once |
| DELETE | /api/v1/admin/keys/:id | Revoke key (soft delete) |
| GET | /api/v1/admin/logs | Query request logs with filters |

### Health Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /health/live | Liveness probe — process is running, no dependency checks |
| GET | /health/ready | Readiness probe — checks DB, Redis, memory; returns 503 if any fail |

All responses use a consistent envelope with data (success), error with message and code (failure), and meta with requestId and timestamp. Rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset) are included on every response.

---

## 🔧 Deep Dive: Two-Level Caching Architecture

**Challenge**: Minimize response latency while maintaining cache consistency across a fleet of stateless API servers.

```
┌─────────────┐
│   Request    │
└──────┬──────┘
       │
       ▼
┌──────────────┐     ┌──────────┐
│  L1 Check    │────▶│  L1 HIT  │──────────────────────────┐
│  (Local Map) │     └──────────┘                          │
└──────┬───────┘                                           │
       │ MISS                                              │
       ▼                                                   │
┌──────────────┐     ┌──────────┐                          │
│  L2 Check    │────▶│  L2 HIT  │──▶ Populate L1 ────────▶│
│  (Redis)     │     └──────────┘                          │
└──────┬───────┘                                           │
       │ MISS                                              │
       ▼                                                   │
┌──────────────┐                                           │
│  Database    │──▶ Populate L1 + L2 ─────────────────────▶│
│  (PostgreSQL)│                                           │
└──────────────┘                                           │
                                                           ▼
                                                    ┌─────────────┐
                                                    │  Return to   │
                                                    │  Caller      │
                                                    └─────────────┘
```

**L1 (local in-memory Map)**: Each API server maintains its own L1 cache with a 5-second TTL. Entries are simple key-value pairs with an expiry timestamp. On hit, the response is served in sub-millisecond time with zero network overhead. The short TTL means stale data is bounded to 5 seconds without requiring cross-instance coordination.

**L2 (Redis)**: Shared across all instances. Configurable TTL (default 5 minutes). On L2 hit, the value is deserialized and populated into L1 for subsequent requests on the same instance. Redis round-trip is typically 1-2ms on a local network.

**Write path**: On data mutation, both L1 (local) and L2 (Redis) are invalidated. For L2, pattern-based invalidation ensures list caches are cleared when individual items change. For L1, only the local instance's cache is cleared — other instances' L1 entries expire naturally within 5 seconds.

**Cache invalidation strategies by data type**:

| Data Type | Strategy | TTL | Rationale |
|-----------|----------|-----|-----------|
| API key metadata | Write-through + event-driven | 1 hour | Must reflect revocation quickly |
| Resource listings | TTL-based | 5 min | Eventual consistency acceptable |
| Individual resources | Write-through | 10 min | Invalidated on update/delete |
| Rate limit config | TTL-based + startup load | 60s | Changes are infrequent |

> **Decision: Two-level cache over Redis-only**
>
> "I added the L1 local cache because profiling showed that 60% of requests within any 5-second window hit the same 50 keys — hot resources, the platform status endpoint, frequently-used API key lookups. Each L1 hit eliminates a Redis round-trip (1-2ms). At 1,700 RPS, that is 1,020 fewer Redis calls per second, which reduces Redis CPU load by 40% and cuts P50 latency from 12ms to under 1ms for hot paths.
>
> The cost is potential staleness: if Instance-1 serves a cached response while Instance-2 has already invalidated the key in Redis, Instance-1's response is up to 5 seconds stale. For an API platform serving resource data (not financial transactions), 5-second staleness is acceptable. If we needed stronger consistency, we could use Redis pub/sub to broadcast invalidation events to all instances' L1 caches — but the complexity is unjustified given the short TTL."

---

## 🔧 Deep Dive: Sliding Window Rate Limiting

**Challenge**: Enforce accurate per-client rate limits across multiple distributed gateway instances without race conditions.

**Tier configuration**:

| Tier | Requests/Minute | Window | Typical Client |
|------|-----------------|--------|----------------|
| Anonymous | 100 | 60s | Unauthenticated users, scrapers |
| Free | 1,000 | 60s | Individual developers |
| Pro | 10,000 | 60s | Small businesses, startups |
| Enterprise | 100,000 | 60s | Large-scale integrations |

**Algorithm**: The gateway uses a Redis sorted set per client identifier (API key ID or IP address). Each request adds the current timestamp as both score and member. Before adding, expired entries (score < current_time - window) are removed. The remaining count determines whether the request is allowed.

```
┌──────────────────────────────────────────────────────────┐
│  Redis Sorted Set: rate_limit:{client_id}                │
│                                                          │
│  Score (timestamp)  │  Member (request ID)               │
│  ────────────────────────────────────────                │
│  1705312800000      │  req_001                           │
│  1705312801000      │  req_002                           │
│  1705312802500      │  req_003                           │
│  ...                │  ...                               │
│                                                          │
│  Operations (atomic Lua script):                         │
│  1. ZREMRANGEBYSCORE ── remove entries before window     │
│  2. ZCARD ── count remaining entries                     │
│  3. If count < limit: ZADD + EXPIRE ── allow            │
│  4. If count >= limit: deny, return Retry-After          │
└──────────────────────────────────────────────────────────┘
```

All four operations execute as a single atomic Lua script on Redis, eliminating race conditions when multiple gateway instances process requests for the same client simultaneously. The key's EXPIRE is set to the window duration so sorted sets for inactive clients are automatically cleaned up.

**Response headers on every request**: X-RateLimit-Limit (total allowed), X-RateLimit-Remaining (requests left), X-RateLimit-Reset (Unix timestamp when window expires). On 429 responses, an additional Retry-After header tells the client exactly how many seconds to wait.

> **Decision: Sliding window over fixed window**
>
> "I chose sliding window because fixed window has a burst problem at window boundaries. A client could send 100 requests at 11:59:59 and another 100 at 12:00:01 — 200 requests in 2 seconds while technically staying under a 100/minute limit. For an API gateway protecting downstream services from overload, this boundary burst can cause cascading failures in the exact scenario where protection matters most.
>
> Sliding window tracks requests in a continuous time range, so the 200-request burst is correctly detected and blocked. The trade-off is memory: each sorted set stores one entry per request in the window. For an enterprise client at 100K/min, that is 100K entries in a single sorted set. At ~50 bytes per entry, that is 5MB per enterprise client. With 100 enterprise clients, we use 500MB of Redis memory just for rate limiting. This is manageable for Redis, but we monitor sorted set sizes and could switch to a probabilistic approach (like a sliding window counter) if memory becomes a constraint.
>
> The latency cost is ~2ms per request for the ZRANGEBYSCORE + ZCARD + ZADD Lua script. At our scale, this is negligible compared to the value of accurate rate limiting."

---

## 🔧 Deep Dive: Circuit Breaker Pattern

**Challenge**: When a downstream dependency (database, external API) fails, prevent request pile-up from exhausting resources and cascading the failure to the entire platform.

```
                    ┌───────────────────────────────────────┐
                    │                                       │
                    ▼                                       │
    ┌──────────┐  failure   ┌──────────┐  timeout   ┌──────┴─────┐
    │  CLOSED  │──threshold─▶│   OPEN   │───────────▶│ HALF-OPEN  │
    │ (normal) │            │ (reject) │            │  (testing) │
    └────┬─────┘            └──────────┘            └──────┬─────┘
         │                        ▲                        │
         │                        │ any failure            │
         │                        └────────────────────────┤
         │                                                 │
         │◀────────────────────── success threshold ───────┘
         │        (3 consecutive successes = close)
    (normal ops)
```

Each external dependency gets its own circuit breaker instance. In the CLOSED state, requests pass through normally and failures are counted. When failures exceed the threshold (default: 5 consecutive), the breaker transitions to OPEN. In OPEN state, all requests fail immediately — zero latency instead of waiting 30 seconds for a timeout. This is the critical benefit: 0ms failure vs 30,000ms timeout means the API server's thread pool is not exhausted by waiting connections.

After a reset timeout (default: 60 seconds), the breaker moves to HALF-OPEN and allows a small number of probe requests through. If 3 consecutive probes succeed, the breaker closes. If any probe fails, it reopens. This prevents "thundering herd" on recovery — only a trickle of traffic tests the dependency rather than a flood.

**Fallback behavior**: When the circuit is open, the breaker can invoke a fallback function. For read operations, this returns cached data (potentially stale). For write operations, the request is queued in RabbitMQ for later retry. For non-critical operations (analytics, logging), the failure is silently recorded and the request continues.

> "I use per-dependency breakers rather than a global breaker because failure isolation matters. If the recommendation service is down, users should still be able to read and write resources. A global breaker would take down the entire API when any single dependency fails. The cost is N breaker instances to monitor and tune, but the operational benefit of independent failure domains justifies this."

---

## ⚖️ Trade-offs Summary

| Decision | Approach | Pros | Cons |
|----------|----------|------|------|
| ✅ Least connections LB | Routes to least-loaded server | Naturally balances heterogeneous load | Requires active connection tracking |
| ❌ Round robin | Simple rotation | Zero state to maintain | Ignores server load differences |
| ✅ Sliding window rate limit | Redis sorted sets | Accurate, no boundary bursts | O(N) memory per client per window |
| ❌ Fixed window | Simple counter per interval | O(1) memory, fast | 2x burst at boundaries |
| ✅ Two-level cache (L1 + L2) | Local Map + Redis | Sub-ms for hot data, shared L2 | 5s potential staleness across instances |
| ❌ Redis only | Single cache layer | Simpler, always consistent | 1-2ms per lookup even for hot data |
| ✅ Partitioned request logs | Monthly PostgreSQL partitions | Fast time-range queries, O(1) drop | More complex queries across partitions |
| ❌ Single table with DELETE | Monolithic log table | Simpler schema | Slow deletes, table bloat, vacuum pressure |
| ✅ Per-dependency circuit breakers | Independent breaker per service | Failure isolation | N breakers to configure and monitor |
| ❌ Global circuit breaker | Single breaker for all deps | Simple | One failure takes down everything |
| ✅ API key hash storage | Store SHA-256 hash only | Key compromise does not expose plaintext | Cannot recover lost keys, must reissue |
| ❌ Encrypted key storage | Reversible encryption | Keys recoverable | Encryption key compromise exposes all keys |

### Deep Trade-off: Stateless Servers vs Session Affinity

> **Decision: Fully stateless API servers with externalized state in Redis and PostgreSQL**
>
> "I designed the API servers to be completely stateless — no in-process sessions, no local file storage, no sticky routing. All shared state lives in Redis (cache, rate limits, sessions) or PostgreSQL (persistent data). This means any server can handle any request, which enables true horizontal scaling: I can add or remove instances without draining connections or migrating state.
>
> The alternative — session affinity (sticky sessions) — would let each server maintain local state, eliminating Redis round-trips for session data. But sticky sessions create cascading problems: if a server fails, all its sticky clients lose their sessions simultaneously. The load balancer cannot freely redistribute traffic, creating hot spots. Rolling deployments become complex because draining a server means waiting for all its sticky sessions to expire. Canary deployments are unreliable because traffic routing is constrained by affinity rather than percentage-based splitting.
>
> The cost of statelessness is external state dependency: every request that touches session data incurs a Redis round-trip (~1ms). But this is predictable and cacheable. The L1 cache eliminates even this cost for frequently-accessed session data. For a platform where horizontal scaling and zero-downtime deployments are primary requirements, this latency cost is vastly preferable to the operational complexity of sticky sessions."

---

## 🚀 Scaling & Evolution

**Immediate bottlenecks and solutions**:

1. **PostgreSQL write pressure from request logs** — At 50M logs/day, sequential inserts become a bottleneck. Solution: buffer logs in RabbitMQ and batch-insert from a worker process. This decouples log writes from the hot request path.

2. **Redis memory for rate limiting** — Enterprise clients with 100K/min limits create large sorted sets. If memory pressure increases, switch from exact sliding window to a sliding window counter (two fixed windows with weighted interpolation), reducing memory from O(requests) to O(1) per client.

3. **Single-region availability** — 99.9% SLA is achievable in one region, but geographic latency affects global users. Evolution path: deploy read-only replicas in secondary regions with Redis Cluster for cache, routing writes to the primary region.

4. **Database sharding** — When a single PostgreSQL instance cannot handle the query load, shard api_keys by user_id hash and request_logs by time range (already partitioned). The partitioning strategy for logs makes this transition straightforward.

5. **Adaptive rate limiting** — Current static tier limits don't account for server load. Evolution: monitor aggregate RPS against capacity and dynamically reduce limits when the platform is under stress, protecting availability at the cost of temporary client impact.

6. **Request coalescing** — When multiple clients request the same resource simultaneously (cache miss thundering herd), only the first request should hit the database. Subsequent requests wait for the first to populate the cache. This prevents database overload on popular resources after cache expiry.
