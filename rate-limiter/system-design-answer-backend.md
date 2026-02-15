# Rate Limiter - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## 🎯 Introduction (2 minutes)

"Thanks for this problem. I will be designing a distributed rate limiting service that protects APIs from abuse while maintaining sub-5ms latency. As a backend engineer, I will focus on the five core rate limiting algorithms, Redis-based distributed counting with Lua scripts for atomicity, the circuit breaker pattern for graceful degradation, key management and memory control, and how to scale from a single Redis node to a cluster. Let me clarify the requirements."

---

## 📋 Requirements Clarification (4 minutes)

### Functional Requirements

1. **Request Counting** - Track the number of requests per client identifier (API key, user ID, or IP address)
2. **Multiple Algorithms** - Support five rate limiting strategies: fixed window, sliding window, sliding log, token bucket, and leaky bucket
3. **Distributed Limiting** - Enforce limits consistently across multiple API gateway nodes sharing state in Redis
4. **Custom Rules** - Configure different limits per endpoint, user tier, and API key
5. **Response Headers** - Return X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, and Retry-After on every response

### Non-Functional Requirements

- **Low Latency** - Rate check must add less than 5ms to request processing (within a 100ms total budget)
- **High Availability** - Rate limiter must not become a single point of failure; fail-open when Redis is unavailable
- **Accuracy** - Limits should be respected within 1-5% tolerance for counter-based algorithms
- **Scalability** - Handle 100K+ requests per second per Redis instance, with sharding for higher throughput

### Backend-Specific Considerations

- Atomic operations to prevent race conditions under concurrent access from multiple gateway nodes
- Distributed state consistency without requiring distributed locks
- Graceful degradation when the Redis dependency is unavailable
- Efficient key expiration to prevent unbounded memory growth in Redis

---

## 🏗️ High-Level Architecture (5 minutes)

```
┌──────────────┐     ┌───────────────────────────────────────────────────┐
│   Client     │────▶│                  API Gateway                      │
│              │     │  ┌─────────────┐  ┌──────────┐  ┌─────────────┐  │
└──────────────┘     │  │ Auth        │──▶│  Rate    │──▶│  Route to   │  │
                     │  │ Middleware  │  │  Limiter │  │  Backend    │  │
                     │  └─────────────┘  └────┬─────┘  └─────────────┘  │
                     └────────────────────────┼──────────────────────────┘
                                              │
                     ┌────────────────────────┼────────────────────────┐
                     │                        │                        │
              ┌──────▼──────┐         ┌───────▼───────┐        ┌───────▼───────┐
              │ API Gateway │         │ API Gateway   │        │ API Gateway   │
              │   Node 1    │         │   Node 2      │        │   Node N      │
              └──────┬──────┘         └───────┬───────┘        └───────┬───────┘
                     │                        │                        │
                     └────────────────────────┼────────────────────────┘
                                              │
                                    ┌─────────▼─────────┐
                                    │   Redis Cluster   │
                                    │  (Rate Counters)  │
                                    └─────────┬─────────┘
                                              │
                                    ┌─────────▼─────────┐
                                    │    PostgreSQL     │
                                    │  (Rule Config)    │
                                    └───────────────────┘
```

> "The rate limiter sits as middleware in the API gateway, after authentication but before routing to backend services. All gateway nodes share rate limit state through a centralized Redis instance. Redis provides atomic operations, sub-millisecond latency within the same datacenter, and built-in key expiration. PostgreSQL stores rule configuration -- which endpoints have which limits -- but is not on the hot path for every request."

### Core Components

| Component | Purpose | Technology |
|-----------|---------|------------|
| Rate Limiter Middleware | Intercepts every request, enforces limits before routing | Express middleware |
| Algorithm Factory | Dispatches to the correct algorithm based on rule configuration | Strategy pattern |
| Redis Client | Manages distributed counters, hashes, and sorted sets | ioredis with Lua scripts |
| Circuit Breaker | Wraps Redis calls, fails open when Redis is unavailable | opossum library |
| Metrics Collector | Records allowed/denied counts and latency for observability | Prometheus counters and histograms |

---

## 🔍 Deep Dive: Rate Limiting Algorithms (12 minutes)

### Algorithm Comparison

| Algorithm | Accuracy | Memory per Key | Burst Handling | Best Use Case |
|-----------|----------|----------------|----------------|---------------|
| Fixed Window | Low (2x burst at boundary) | Very low (1 counter) | Allows double-rate at window edges | Simple quotas, non-critical limits |
| Sliding Window | ~98% | Low (2 counters) | Smooth, no boundary spike | General purpose (recommended default) |
| Sliding Log | 100% exact | High (1 entry per request) | Perfect enforcement | Compliance, billing-critical limits |
| Token Bucket | N/A (different model) | Low (1 hash) | Controlled bursts up to capacity | Traffic shaping, allowing occasional spikes |
| Leaky Bucket | N/A (different model) | Low (1 hash) | No bursts at all | Smooth output rate, protecting downstream |

---

### 📌 Algorithm 1: Fixed Window Counter

```
Time:    │──── Window 1 (60s) ────│──── Window 2 (60s) ────│
         0                        60                        120
Requests: x x x x x x x x x x     x x x x x x
Count:           10                       6
```

The fixed window algorithm rounds the current timestamp down to the nearest window boundary, constructs a Redis key combining the identifier and window start time, and atomically increments the counter with INCR. If the counter returns 1 (first request in this window), it sets an expiry equal to the window size plus a buffer. If the counter exceeds the configured limit, the request is denied.

**Pros**: Simplest to implement, single Redis operation per check, minimal memory.

**Cons**: The boundary burst problem -- a client can send the full limit at the end of Window 1 and the full limit at the start of Window 2, effectively doubling their rate across a 2-second span.

---

### 📌 Algorithm 2: Sliding Window Counter (Default)

```
Previous Window         Current Window
│====100 reqs====│  │==40 reqs==│─── remaining ───│
                              ▲
                             now (30% into current window)

Weighted count = 100 * 0.70 + 40 = 110
If limit is 100, this request is DENIED
```

The sliding window eliminates the boundary burst problem by weighting the previous window's count based on how far we are into the current window. It fetches both the current and previous window counters from Redis with MGET, calculates the fractional position within the current window, and computes a weighted sum. If the weighted sum exceeds the limit, the request is denied. Otherwise, the current window counter is atomically incremented.

> "I chose sliding window as the default because it provides approximately 98% accuracy with only 2 counters per identifier -- the same memory as fixed window. The 1-2% error tolerance is acceptable for virtually all API rate limiting use cases. The only scenarios requiring exact counting are compliance-regulated APIs or billing systems, where I would use sliding log instead."

**Pros**: Smooth limiting without boundary spikes, low memory, high accuracy.

**Cons**: Approximate -- can be off by 1-2% in edge cases where request distribution is uneven across the previous window.

---

### 📌 Algorithm 3: Sliding Log

The sliding log maintains a sorted set in Redis where each entry is a request timestamp. To check a request, it removes all entries older than the window size using ZREMRANGEBYSCORE, counts the remaining entries with ZCARD, and adds the new timestamp with ZADD if under the limit. TTL is set on the sorted set key to prevent memory leaks.

**Pros**: 100% accurate -- no approximation.

**Cons**: Memory grows linearly with request volume. A client allowed 10,000 requests per hour stores 10,000 timestamps. At 100,000 API keys, this consumes roughly 10x more memory than sliding window.

---

### 📌 Algorithm 4: Token Bucket (Lua Script Required)

```
Bucket: │ * * * * * * * * * * │  capacity = 10, full
        │ * * * * * * * *     │  after 2 requests consumed
        │ * * * * * * * * *   │  after refill (1 token/sec)
```

Token bucket requires a Lua script because the check involves a read-modify-write cycle: read current tokens and last refill time, calculate how many tokens to add based on elapsed time, check if at least 1 token is available, and update the hash atomically. Without a Lua script, two concurrent requests from different gateway nodes could both read 1 remaining token, both decide to allow, and both decrement -- resulting in -1 tokens.

The Lua script reads the hash fields (tokens, last_refill) from Redis, computes elapsed time since the last refill, adds tokens at the configured refill rate capped at bucket capacity, then either consumes 1 token and returns allowed, or returns denied if the bucket is empty. The entire operation executes atomically on the Redis server.

**Pros**: Allows controlled bursts (up to bucket capacity), smooth long-term rate.

**Cons**: More complex implementation, Lua script debugging is harder than simple INCR operations.

---

### 📌 Algorithm 5: Leaky Bucket (Lua Script Required)

The leaky bucket is the inverse of the token bucket. Instead of tokens refilling, water (representing queued requests) leaks out at a fixed rate. The Lua script reads the hash fields (water, last_leak), calculates how much water has leaked since the last check, reduces the water level, and attempts to add 1 unit. If the water level would exceed the bucket size, the request is denied -- the bucket is full.

**Pros**: Smoothest output rate of all algorithms. Guarantees that requests are processed at a consistent rate, protecting downstream services from bursts.

**Cons**: Does not allow any bursting. Even legitimate traffic spikes are throttled. This can frustrate users who naturally have bursty usage patterns.

---

## 🔒 Deep Dive: Redis Atomicity and Lua Scripts (6 minutes)

### Why Atomicity Matters

> "In a distributed system with N gateway nodes, every rate limit check is a potential race condition. Without atomicity, two nodes can simultaneously read the counter as 99 out of 100, both allow the request, and now the counter is at 101 -- exceeding the limit. For simple algorithms like fixed window, Redis INCR is inherently atomic. But for token bucket and leaky bucket, which require reading state, computing new values, and writing back, we need Lua scripts."

### Redis Key Structure

| Algorithm | Key Pattern | Value Type | Fields |
|-----------|------------|------------|--------|
| Fixed Window | ratelimit:fixed:{id}:{window_start} | String (counter) | count |
| Sliding Window | ratelimit:sliding:{id}:{window_num} | String (counter) | count (2 keys: current + previous) |
| Sliding Log | ratelimit:log:{id} | Sorted Set | score = timestamp, member = request_id |
| Token Bucket | ratelimit:token:{id} | Hash | tokens (float), last_refill (timestamp) |
| Leaky Bucket | ratelimit:leaky:{id} | Hash | water (float), last_leak (timestamp) |

### TTL Strategy

| Key Pattern | TTL | Rationale |
|-------------|-----|-----------|
| ratelimit:fixed:* | 2x window size | Buffer beyond window expiry |
| ratelimit:sliding:* | 2x window size | Must retain previous window for weighted calculation |
| ratelimit:log:* | window size + 60s | Sorted set entries cleaned by ZREMRANGEBYSCORE; key TTL is safety net |
| ratelimit:token:* | capacity / refillRate + padding | Reset inactive buckets after they would naturally refill |
| ratelimit:leaky:* | bucketSize / leakRate + padding | Reset inactive buckets after they would naturally drain |

> "TTL is critical for preventing unbounded memory growth. Without it, a Redis instance serving 1 million unique API keys would accumulate stale keys indefinitely. With TTL, inactive keys are automatically reclaimed. The 2x multiplier for sliding window is essential -- at time 12:01:30, I am 50% into Window 2 but still need Window 1's counter for the weighted calculation. A 1x TTL would have already expired it."

### Memory Estimation

100,000 active API keys with sliding window (2 counters per key, approximately 200 bytes per key) requires roughly 20 MB of Redis memory. With token bucket hashes (approximately 300 bytes per key), the total is about 30 MB. This fits comfortably in a single Redis instance with ample room for growth to 1 million keys.

---

## 🛡️ Deep Dive: Circuit Breaker and Graceful Degradation (6 minutes)

### Circuit Breaker State Machine

```
┌──────────┐   failures exceed    ┌──────────┐   recovery timeout   ┌──────────────┐
│  CLOSED  │──── threshold ──────▶│   OPEN   │──────────────────────▶│  HALF-OPEN   │
│ (normal) │                      │ (bypass) │                      │  (testing)   │
└──────────┘                      └──────────┘                      └──────┬───────┘
     ▲                                 ▲                                   │
     │                                 │ failure                           │
     │         success                 └───────────────────────────────────┤
     └─────────────────────────────────────────────────────────────────────┘
```

**Configuration**: timeout 3 seconds per Redis operation, circuit opens after 50% failure rate across a minimum of 5 requests, recovery timeout of 10 seconds before testing in half-open state.

**When the circuit opens**: All rate limit checks immediately return an allowed result with remaining set to -1 and a fallback flag set to true. A warning is logged and a circuit_breaker_open metric is incremented. No requests wait for Redis timeouts.

### Why Circuit Breakers Prevent Cascading Failure

Without a circuit breaker, a Redis failure causes every rate limit check to block for the connection timeout (typically 3-30 seconds). In a system handling 10,000 requests per second, this means 10,000 threads or connections are blocked simultaneously, exhausting the connection pool within seconds. Upstream services start timing out. Users see 500 errors across the entire platform -- not just rate-limited endpoints.

The circuit breaker solves this by failing fast. After detecting that Redis is unhealthy (50% of recent requests failing), it stops attempting Redis connections entirely. Every subsequent rate check returns immediately with a fail-open result. The system continues operating at full speed, just without rate enforcement. After 10 seconds, the circuit enters half-open state and tests a few requests. If Redis has recovered, normal operation resumes.

---

## 🔀 Deep Trade-off: Centralized Redis vs Local Counters (Deep Dive 1)

**Decision**: I chose centralized Redis for all rate limit state over local in-memory counters on each gateway node.

**Why centralized Redis works**: When a client sends 100 requests per second and those requests are load-balanced across 10 gateway nodes, each node sees only 10 requests per second. With local counters, each node independently allows 100 requests (the full limit), resulting in the client actually sending 1,000 requests per second -- 10x the intended limit. Centralized Redis provides a single source of truth that all nodes share, ensuring the global limit is enforced regardless of load balancing distribution.

**Why local counters fail**: Local counters only work if you can guarantee that all requests from a given client always reach the same gateway node (sticky sessions). But sticky sessions create hot spots, prevent graceful node replacement, and break during deployments. Even with sticky sessions, a node restart resets all counters, temporarily allowing double the rate. The fundamental problem is that rate limiting is inherently a global operation -- you need to count requests across all nodes, not per node.

**What I am giving up**: 1-2ms of additional latency per request for the Redis round-trip within the same datacenter. For the rate limiter's 5ms budget, this is significant but manageable. At extreme scale (1M+ RPS), I could introduce a hybrid approach: local counters that periodically sync with Redis, trading some accuracy (perhaps 5-10% overshoot) for reduced Redis load. But for most systems, the accuracy of centralized counting justifies the latency cost.

---

## 🔀 Deep Trade-off: Sliding Window vs Sliding Log (Deep Dive 2)

**Decision**: I chose sliding window counter (approximate) as the default algorithm over sliding log (exact).

**Why sliding window works**: The sliding window counter uses only 2 Redis keys per identifier (current window count and previous window count), consuming approximately 200 bytes total. Its accuracy is approximately 98% -- the 1-2% error comes from assuming requests in the previous window were uniformly distributed, which may not be true. For API rate limiting, this error is negligible. A client allowed 100 requests per minute might occasionally get 101 or 102 -- this does not meaningfully impact system protection or user experience.

**Why sliding log fails at scale**: The sliding log stores one entry per request in a Redis sorted set. A client allowed 10,000 requests per hour stores 10,000 timestamps in Redis. Multiply by 100,000 API keys, and you need memory for 1 billion sorted set entries. The ZRANGEBYSCORE and ZCARD operations that the sliding log requires are O(log N + M) where M is the number of entries, compared to O(1) for the INCR operations that sliding window uses. At high request volumes, this difference is the difference between sub-millisecond and multi-millisecond latency per check.

**What I am giving up**: Perfect accuracy. In rare edge cases where a client sends all their requests in a burst at the end of the previous window, the sliding window's weighted calculation slightly underestimates the true count. For compliance-regulated APIs (financial transaction limits, regulatory rate caps), I would switch to sliding log and accept the memory cost. For 95% of API rate limiting use cases, sliding window's 98% accuracy is the right trade-off.

---

## 🔀 Deep Trade-off: Fail-Open vs Fail-Closed (Deep Dive 3)

**Decision**: I chose fail-open (allow all requests) as the default behavior when Redis is unavailable.

**Why fail-open works for rate limiting**: Rate limiting protects against sustained abuse -- bots scraping content, attackers trying to overwhelm an API, free-tier users exceeding their quota. These are patterns that persist for hours or days. A 30-second Redis outage during which rate limiting is disabled does not meaningfully help any of these attackers. Legitimate users continue to experience normal service. The moment Redis recovers, enforcement resumes. Combined with aggressive alerting on Redis health, the window of exposure is small.

**Why fail-closed fails for most APIs**: Fail-closed means that when Redis goes down, every single API request is rejected with a 503 Service Unavailable. For an e-commerce platform doing 50,000 orders per hour, a 5-minute Redis outage under fail-closed means 4,166 lost orders. The business impact of blocking all legitimate traffic far exceeds the risk of temporarily allowing a few extra requests from rate-limited clients. The rate limiter -- a protective mechanism -- becomes the cause of the outage it was supposed to prevent.

**What I am giving up**: Protection during Redis outages. A sophisticated attacker could theoretically monitor Redis health and launch attacks during outages. Mitigation strategies include multi-region Redis with automatic failover, a local fallback cache that provides approximate enforcement during the outage window, and IP-based emergency blocking at the load balancer level that does not depend on Redis. For security-critical endpoints (authentication, payments), I would configure fail-closed with multi-region Redis to minimize the outage window.

---

## 🔧 Rate Limit Middleware Flow

The rate limit middleware executes on every API request in this order:

1. **Extract identifier** - Check for an X-API-Key header first, then authenticated user ID from the session, then fall back to the client IP address
2. **Look up the rule** - Find the applicable rate limit rule based on the endpoint pattern, user tier, and identifier type. Rules specify the algorithm, limit, window size, and optional burst parameters
3. **Execute the rate check** through the circuit breaker wrapper. If the circuit is open, return a fail-open result immediately without attempting Redis
4. **Set response headers** on every response (both allowed and denied): X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Algorithm
5. **If denied** - Add Retry-After header with seconds until reset, return HTTP 429 Too Many Requests
6. **If allowed** - Call next() to continue to the route handler

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/ratelimit/check | Check and consume a rate limit token for an identifier |
| GET | /api/ratelimit/state/:id | Read current state without consuming (introspection) |
| DELETE | /api/ratelimit/reset/:id | Reset rate limit for an identifier (admin/testing) |
| POST | /api/ratelimit/batch-check | Check multiple identifiers in a single request |
| GET | /api/metrics | Aggregated metrics (allowed/denied counts, latency percentiles) |
| GET | /api/metrics/health | Health check for load balancer probing |
| GET | /api/algorithms | List available algorithms with configuration schema |

### Response Headers

Every response from a rate-limited endpoint includes these headers:

| Header | Example | Description |
|--------|---------|-------------|
| X-RateLimit-Limit | 100 | Maximum requests allowed in the window |
| X-RateLimit-Remaining | 87 | Requests remaining in the current window |
| X-RateLimit-Reset | 1704067260 | Unix timestamp when the window resets |
| X-RateLimit-Algorithm | sliding_window | Algorithm used for this check |
| Retry-After | 45 | Seconds until retry (only on 429 responses) |

---

## 📊 Observability

### Prometheus Metrics

| Metric Name | Type | Labels | Purpose |
|-------------|------|--------|---------|
| ratelimiter_checks_total | Counter | result (allowed/denied), algorithm | Track allow/deny ratio per algorithm |
| ratelimiter_check_duration_seconds | Histogram | algorithm | Latency distribution with buckets at 1ms, 5ms, 10ms, 25ms, 50ms, 100ms |
| ratelimiter_circuit_breaker_state | Gauge | state (closed/open/half_open) | Current circuit breaker state for alerting |
| ratelimiter_fallback_activations_total | Counter | - | How often fail-open fallback activates |
| ratelimiter_active_identifiers | Gauge | algorithm | Number of active rate limit keys (memory pressure indicator) |

### Alerting Rules

- **High denial rate**: Fire when denied checks exceed 10% of total checks over a 5-minute window. Indicates either an attack or limits that are too restrictive.
- **Latency spike**: Fire when p99 check latency exceeds 10ms. Indicates Redis performance degradation.
- **Circuit breaker open**: Fire immediately when the circuit breaker enters open state. Indicates Redis is unhealthy and rate limiting is disabled.

---

## 📈 Scalability Considerations

### Horizontal Scaling Path

1. **API Gateway Nodes** - Fully stateless. Add nodes behind the load balancer as traffic grows. No coordination required between nodes.
2. **Redis Sharding** - Shard by identifier hash across a Redis Cluster. Each shard handles a subset of API keys. At 100K RPS per shard, 10 shards handle 1M RPS.
3. **Local Caching Hybrid** - For extreme scale, maintain a local in-memory counter that periodically syncs with Redis. Allows most checks to skip the network round-trip at the cost of 5-10% accuracy reduction.

### What Breaks First

Redis becomes the bottleneck before anything else. A single Redis instance handles approximately 100K operations per second. With sliding window (2 operations per check: MGET + INCR), that supports roughly 50K rate checks per second. Beyond that, either shard across Redis Cluster or introduce the local caching hybrid.

---

## ⚖️ Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| ✅ State storage | Centralized Redis | ❌ Local in-memory counters | Global accuracy across all gateway nodes |
| ✅ Default algorithm | Sliding window (~98%) | ❌ Sliding log (100% exact) | 500x less memory per key, O(1) operations |
| ✅ Atomicity | Lua scripts for bucket algos | ❌ Redis transactions (MULTI/EXEC) | True atomicity without watch/retry loops |
| ✅ Failure mode | Fail-open (allow all) | ❌ Fail-closed (deny all) | Rate limiting protects against sustained abuse, not individual requests |
| ✅ Clock source | Redis server time in Lua | ❌ Gateway local time | Eliminates clock skew across distributed nodes |
| ✅ Key expiration | Explicit TTL per algorithm | ❌ Manual cleanup cron | Automatic, no operational burden |

---

## 🔮 Future Enhancements

1. **Local Caching Hybrid** - In-memory counters with periodic Redis sync for sub-millisecond checks at extreme scale
2. **Rule Engine** - Dynamic rules loaded from PostgreSQL with an in-memory cache and change-notification via pub/sub
3. **Distributed Tracing** - OpenTelemetry spans for each rate check, correlating with upstream request traces
4. **Adaptive Limits** - Automatically adjust limits based on traffic patterns using anomaly detection
5. **Geo-based Limiting** - Different rate limits per geographic region, enforced at edge locations

---

## 📝 Summary

> "To summarize, I have designed a distributed rate limiter with six core aspects. First, five rate limiting algorithms covering the full spectrum from simple counters (fixed window) through approximate counters (sliding window) to exact counting (sliding log) and traffic shaping (token and leaky bucket), each with clear trade-offs in accuracy, memory, and burst handling. Second, Redis-based distributed state with Lua scripts providing true atomicity for the token and leaky bucket algorithms, eliminating race conditions across multiple gateway nodes. Third, a circuit breaker pattern that prevents Redis failures from cascading into full API outages by failing open immediately rather than blocking on dead connections. Fourth, a deliberate fail-open strategy that prioritizes availability over enforcement during infrastructure issues, recognizing that rate limiting protects against sustained abuse rather than individual requests. Fifth, TTL-based key expiration that prevents unbounded Redis memory growth with algorithm-specific TTL calculations. Sixth, Prometheus metrics and alerting that make the rate limiter's behavior observable and tunable. The key insight is that rate limiting is fundamentally a trade-off between accuracy, latency, and complexity. For most production systems, the sliding window counter at 98% accuracy with sub-5ms latency provides the best balance, and the remaining 2% of edge cases are not worth the 10x memory cost of exact counting."
