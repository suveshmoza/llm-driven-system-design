# Rate Limiter - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Introduction (2 minutes)

"Thanks for this problem. I'll be designing a distributed rate limiting service that can protect APIs from abuse while maintaining low latency. As a backend engineer, I'll focus on the rate limiting algorithms, Redis-based distributed counting, Lua scripts for atomicity, circuit breakers, and ensuring sub-5ms latency. Let me clarify the requirements."

---

## 1. Requirements Clarification (4 minutes)

### Functional Requirements

1. **Request Counting** - Track number of requests per client/API key
2. **Multiple Algorithms** - Support different rate limiting strategies
3. **Distributed Limiting** - Work across multiple API servers consistently
4. **Custom Rules** - Configure different limits per endpoint, user tier
5. **Response Headers** - Return remaining quota and reset time to clients

### Non-Functional Requirements

- **Low Latency** - Rate check must add <5ms to request processing
- **High Availability** - Must not become a single point of failure
- **Accuracy** - Limits should be respected within 1-5% tolerance
- **Scalability** - Handle 100K+ requests per second

### Backend-Specific Considerations

- Atomic operations to prevent race conditions
- Distributed state consistency across API gateway nodes
- Graceful degradation when Redis is unavailable
- Efficient key expiration to prevent memory bloat

---

## 2. High-Level Architecture (5 minutes)

```
┌──────────────┐     ┌───────────────────────────────────────────────────┐
│   Client     │────▶│                  API Gateway                      │
│              │     │  ┌─────────────┐  ┌──────────┐  ┌─────────────┐  │
└──────────────┘     │  │ Auth        │──│  Rate    │──│  Route to   │  │
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
                                    │  (Configuration)  │
                                    └───────────────────┘
```

### Core Components

| Component | Purpose | Technology |
|-----------|---------|------------|
| Rate Limiter Middleware | Intercepts requests, enforces limits | Express middleware |
| Algorithm Factory | Creates appropriate limiter per config | TypeScript classes |
| Redis Client | Manages distributed state | ioredis with Lua scripts |
| Circuit Breaker | Handles Redis failures gracefully | opossum library |

---

## 3. Deep Dive: Rate Limiting Algorithms (10 minutes)

### Algorithm 1: Fixed Window Counter

```
Time:    |-------- Window 1 --------|-------- Window 2 --------|
         0                          60                         120
Requests: [x x x x x x x x x x]      [x x x x x x]
Count:           10                        6
```

The fixed window algorithm works as follows:

1. Compute the window start by rounding the current timestamp down to the nearest window boundary
2. Construct a Redis key as `ratelimit:fixed:{identifier}:{windowStart}`
3. Atomically increment the counter with INCR; if the result is 1, set an expiry of `windowSeconds + 1`
4. If the counter exceeds the limit, deny the request with remaining = 0; otherwise, allow with remaining = limit - current

**Pros**: Simple, memory efficient (one counter per window)
**Cons**: Burst at window boundaries (can allow 2x limit briefly)

---

### Algorithm 2: Sliding Window Counter (Default)

```
Previous Window    Current Window
[====count=====]   [==count===|----remaining----|]
     100                 40        ^
                                  now (30% into window)

Weighted count = 100 * 0.70 + 40 = 110
```

The sliding window algorithm works as follows:

1. Determine the current and previous window numbers by dividing the current timestamp by the window size
2. Calculate the position within the current window as a fraction from 0.0 to 1.0
3. Fetch both the current and previous window counters from Redis using MGET
4. Compute a weighted count: `previousCount * (1 - position) + currentCount`
5. If the weighted count exceeds the limit, deny the request
6. Otherwise, atomically increment the current window counter and set an expiry of `2 * windowSeconds`
7. Return remaining = limit - weightedCount - 1

**Pros**: Smooth limiting, memory efficient, ~98% accuracy
**Cons**: Approximate (1-2% error tolerance)

---

### Algorithm 3: Token Bucket (Lua Script)

```
Bucket refills at constant rate, requests consume tokens

Bucket: [* * * * * * * * * *]  capacity = 10
        [* * * * * * * *]      after 2 requests
        [* * * * * * * * *]    after refill
```

Token bucket is implemented as an atomic Lua script on Redis. The script performs the following steps:

1. Read the hash fields `tokens` and `last_refill` from the bucket key (defaulting to full capacity if the key does not exist)
2. Calculate how many tokens to add based on elapsed time since the last refill: `elapsed * refillRate`, capped at the bucket capacity
3. If at least 1 token is available, consume it by decrementing and update the hash with the new token count and refill timestamp; set an expiry of `capacity / refillRate + 10` seconds
4. Return `{1, remaining_tokens}` if allowed, or `{0, 0}` if denied

The calling function passes the key, capacity, refill rate, and current timestamp as arguments. The Lua script ensures atomicity — without it, the read-modify-write sequence across multiple API servers would lead to race conditions and inaccurate token counts.

**Why Lua Script?** Token bucket requires read-modify-write atomicity. Without Lua, race conditions between multiple API servers could cause inaccurate token counts.

---

### Algorithm 4: Leaky Bucket

Leaky bucket is also implemented as a Lua script on Redis, similar in structure to token bucket but with inverted semantics:

1. Read the hash fields `water` and `last_leak` from the bucket key (defaulting to 0 water if the key does not exist)
2. Calculate how much water has "leaked" based on elapsed time: `elapsed * leakRate`, and reduce the current water level accordingly (minimum 0)
3. If the current water level is below the bucket size, add 1 unit of water (representing the new request), update the hash, and set an expiry of `bucketSize / leakRate + 10` seconds
4. Return `{1, remaining_capacity}` if allowed, or `{0, 0}` if the bucket is full

**Pros**: Smoothest output rate, prevents bursts entirely
**Cons**: Requests may queue, adding latency

---

## 4. Deep Dive: Circuit Breaker Pattern (6 minutes)

### Why Circuit Breakers?

Without a circuit breaker, Redis failures cause:
1. **Thread Pool Exhaustion** - Each blocked request holds a connection
2. **Cascading Latency** - Request latency spikes to timeout duration
3. **Thundering Herd** - All requests fail simultaneously

### Implementation

We use the `opossum` circuit breaker library wrapping all Redis operations. Configuration:

- **Timeout**: 3 seconds per operation
- **Error threshold**: Open after 50% of requests fail
- **Reset timeout**: 10 seconds before testing recovery (half-open state)
- **Volume threshold**: Minimum 5 requests before the breaker can open

When the circuit opens, a warning is logged and a metric is incremented. The **fallback** returns a fail-open result: the request is allowed, but the response includes a `fallback: true` flag and `remaining: -1` to indicate the rate limit check was skipped.

### State Machine

```
CLOSED -> (failures exceed threshold) -> OPEN
OPEN -> (recovery timeout) -> HALF_OPEN
HALF_OPEN -> (success) -> CLOSED
HALF_OPEN -> (failure) -> OPEN
```

### Fail-Open vs Fail-Closed

| Strategy | When to Use | Risk | Mitigation |
|----------|-------------|------|------------|
| Fail-Open | Most APIs | Temporary abuse | Aggressive alerting |
| Fail-Closed | Auth, payments | Service outage | Multi-region Redis |

---

## 5. Deep Dive: Redis Key Management (5 minutes)

### Key Structure

```
# Fixed Window
ratelimit:fixed:{identifier}:{window_start} -> count

# Sliding Window
ratelimit:sliding:{identifier}:{window_number} -> count

# Token Bucket
ratelimit:token:{identifier} -> hash {tokens, last_refill}

# Leaky Bucket
ratelimit:leaky:{identifier} -> hash {water, last_leak}
```

### TTL Strategy

| Key Pattern | TTL | Rationale |
|-------------|-----|-----------|
| `ratelimit:fixed:*` | 2x window | Covers window + buffer |
| `ratelimit:sliding:*` | 2x window | Covers current + previous |
| `ratelimit:token:*` | 24 hours | Reset daily inactive |
| `ratelimit:leaky:*` | 24 hours | Reset daily inactive |

TTL is calculated as 2x the window size. This is necessary because sliding window needs data from the previous window — for example, at 12:01:30 we are 50% into Window 2 but still need the Window 1 counter for the weighted calculation.

### Memory Estimation

```
100,000 API keys x ~200 bytes/key = ~20 MB
With sliding window: 2 keys per user = ~40 MB
Safely fits in Redis with room for growth
```

---

## 6. Deep Dive: Rate Limit Middleware (5 minutes)

### Express Middleware Implementation

The rate limit middleware follows this flow:

1. **Extract identifier** — priority order: API key header, authenticated user ID, then IP address
2. **Look up the applicable rule** — each rule specifies the algorithm (fixed/sliding/token/leaky), limit, window size, and optional burst parameters
3. **Execute the rate check** through the circuit breaker; if the circuit is open or the check fails, fall open with a warning log
4. **Set response headers** — `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `X-RateLimit-Algorithm` on every response
5. **If denied** — add a `Retry-After` header and return 429 with the reset timestamp
6. **If allowed** — call `next()` to continue to the route handler

---

## 7. Trade-offs Summary

| Decision | Choice | Trade-off | Alternative |
|----------|--------|-----------|-------------|
| State storage | Centralized Redis | Adds 1-2ms latency | Local counters (faster, less accurate) |
| Default algorithm | Sliding window | ~2% error | Sliding log (exact, 10x memory) |
| Atomicity | Lua scripts | More complex | Pipeline (race conditions) |
| Failure mode | Fail-open | Risk during outage | Fail-closed (blocks users) |
| Clock source | Redis server time | Single source | Local time (clock skew issues) |

---

## 8. Metrics and Observability

We track three Prometheus metrics:

- **ratelimiter_checks_total** (Counter) — total rate limit checks, labeled by result (allowed/denied) and algorithm
- **ratelimiter_check_duration_seconds** (Histogram) — latency of each rate check, with buckets at 1ms, 5ms, 10ms, 25ms, 50ms, and 100ms
- **ratelimiter_circuit_breaker_state** (Gauge) — current circuit breaker state (0 = closed, 1 = open, 2 = half-open)

An alerting rule fires when the denial rate exceeds 10% over a 5-minute window, calculated as the ratio of denied checks to total checks.

---

## 9. Future Enhancements

1. **Local Caching** - Hybrid approach with periodic Redis sync
2. **Rule Engine** - Dynamic rules from PostgreSQL with caching
3. **Distributed Tracing** - OpenTelemetry integration
4. **Adaptive Limits** - ML-based anomaly detection
5. **Geo-based Limiting** - Different limits per region

---

## Summary

"To summarize, I've designed a distributed rate limiter with:

1. **Multiple algorithms** (fixed window, sliding window, token bucket, leaky bucket) implemented with Redis, using Lua scripts for atomicity
2. **Sliding window as default** providing 98% accuracy with low memory footprint
3. **Circuit breaker pattern** for graceful degradation when Redis is unavailable
4. **Fail-open strategy** to prioritize availability during infrastructure issues
5. **TTL-based key expiration** to prevent unbounded memory growth
6. **Sub-5ms latency** through optimized Redis operations and connection pooling

The key insight is that rate limiting is a trade-off between accuracy, latency, and complexity. For most production systems, the sliding window counter provides the best balance, and fail-open is the right default since we're protecting against sustained abuse rather than individual requests."
