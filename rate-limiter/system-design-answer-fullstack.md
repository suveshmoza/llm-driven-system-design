# Rate Limiter - System Design Answer (Fullstack Focus)

*45-minute system design interview format - Fullstack Engineer Position*

## Introduction (2 minutes)

"Thanks for this problem. I'll be designing a distributed rate limiting service with both a robust backend and an interactive dashboard. As a fullstack engineer, I'll focus on the end-to-end rate limit check flow, the API contract between frontend and backend, session-based configuration, and how the dashboard integrates with the rate limiting service. Let me clarify the requirements."

---

## 1. Requirements Clarification (4 minutes)

### Functional Requirements

1. **Request Counting** - Track requests per client/API key across distributed servers
2. **Multiple Algorithms** - Support fixed window, sliding window, token bucket, leaky bucket
3. **Dashboard** - Configure rules, visualize metrics, test rate limits
4. **Response Headers** - Return X-RateLimit-* headers to clients
5. **Batch Testing** - Send multiple requests to observe rate limiting behavior

### Non-Functional Requirements

- **Low Latency** - Rate check must add <5ms to request processing
- **Real-time Dashboard** - Metrics update within 5 seconds
- **Consistency** - Limits respected within 1-5% tolerance
- **Usability** - Intuitive UI for algorithm selection and testing

### Fullstack Considerations

- API contract design between frontend and backend
- Error handling and loading states
- State synchronization between UI and server
- Response header propagation to dashboard

---

## 2. High-Level Architecture (5 minutes)

```
+------------------------------------------------------------------+
|                    Frontend Dashboard (React)                     |
|  +----------------+  +----------------+  +---------------------+  |
|  | Algorithm      |  |    Metrics     |  |  Request Tester     |  |
|  | Configuration  |  |    Charts      |  |  (Test + Headers)   |  |
|  +-------+--------+  +-------+--------+  +---------+-----------+  |
|          |                   |                     |              |
|          +-------------------+---------------------+              |
|                              |                                    |
|                   +----------v-----------+                        |
|                   |    Zustand Store     |                        |
|                   +----------+-----------+                        |
+---------------------------|-----------------------------------+---+
                            |
                            v REST API
+------------------------------------------------------------------+
|                    Backend API (Express)                          |
|  +----------------+  +----------------+  +---------------------+  |
|  | Rate Limit     |  |    Metrics     |  |   Check Endpoint    |  |
|  | Middleware     |  |    Endpoint    |  |   POST /check       |  |
|  +-------+--------+  +-------+--------+  +---------+-----------+  |
|          |                   |                     |              |
|          +-------------------+---------------------+              |
|                              |                                    |
|                   +----------v-----------+                        |
|                   |  Algorithm Factory   |                        |
|                   +----------+-----------+                        |
+---------------------------|-----------------------------------+---+
                            |
              +-------------+-------------+
              |                           |
    +---------v---------+     +-----------v-----------+
    |   Redis Cluster   |     |     PostgreSQL        |
    |  (Rate Counters)  |     |   (Rules, Metrics)    |
    +-------------------+     +-----------------------+
```

---

## 3. Deep Dive: API Contract Design (8 minutes)

### Endpoint Definitions

The API exposes the following endpoints:

| Method | Path | Description | Key Fields |
|--------|------|-------------|------------|
| POST | `/api/ratelimit/check` | Check and consume a rate limit token | Request: identifier, algorithm, limit, windowSeconds, burstCapacity, refillRate, leakRate. Response: allowed, remaining, limit, resetAt (Unix timestamp), algorithm, latencyMs |
| GET | `/api/ratelimit/state/:identifier` | Get current state without consuming | Response: identifier, algorithm, currentCount, limit, remaining, resetAt, tokens (token bucket), water (leaky bucket) |
| DELETE | `/api/ratelimit/reset/:identifier` | Reset rate limit for an identifier | Response: success, identifier |
| POST | `/api/ratelimit/batch-check` | Check multiple identifiers at once | Request: array of check objects. Response: array of results, totalLatencyMs |
| GET | `/api/metrics` | Get aggregated metrics | Response: metric data points with timestamps, plus summary (totalChecks, allowedPercent, deniedPercent, avgLatencyMs, p99LatencyMs) |

### Response Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1704067260
X-RateLimit-Algorithm: sliding_window
Retry-After: 45  (only when status 429)
```

---

## 4. Deep Dive: End-to-End Rate Check Flow (10 minutes)

### Complete Request Flow

```
Frontend                   Backend                    Redis
   |                          |                         |
   | 1. POST /check           |                         |
   | { identifier, algorithm, |                         |
   |   limit, windowSeconds } |                         |
   |------------------------->|                         |
   |                          |                         |
   |                          | 2. Check algorithm      |
   |                          | 3. Execute Lua script   |
   |                          |------------------------>|
   |                          |                         |
   |                          | 4. Atomic check+update  |
   |                          |<------------------------|
   |                          | { allowed, remaining }  |
   |                          |                         |
   |                          | 5. Record metrics       |
   |                          |------------------------>|
   |                          |                         |
   | 6. Response + headers    |                         |
   |<-------------------------|                         |
   | { allowed, remaining,    |                         |
   |   resetAt, latencyMs }   |                         |
   |                          |                         |
   | 7. Update UI state       |                         |
   v                          v                         v
```

### Backend: Check Endpoint Implementation

The POST `/check` endpoint follows this flow:

1. **Start a performance timer** to measure server-side latency
2. **Parse the request body** — extract identifier, algorithm, and optional configuration (limit defaults to 10, windowSeconds to 60, burstCapacity to 10, refillRate and leakRate to 1)
3. **Validate input** — return 400 if identifier or algorithm is missing
4. **Select and execute the algorithm** — dispatch to the appropriate algorithm handler (fixed, sliding, token, or leaky); return 400 for unknown algorithms
5. **Handle failures gracefully** — if the rate check throws (e.g., Redis down), log a warning and allow the request with remaining = -1 (fail-open)
6. **Record metrics asynchronously** — fire-and-forget the algorithm name, allowed/denied result, and latency
7. **Set response headers** — `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Algorithm`; add `Retry-After` if denied
8. **Return the response** — status 200 if allowed, 429 if denied, with a JSON body containing allowed, remaining, limit, resetAt, algorithm, and latencyMs

### Frontend: API Service Layer

The frontend API service layer provides five functions that wrap fetch calls to the backend:

- **checkRateLimit(params)** — POSTs to `/api/ratelimit/check` with the algorithm configuration. Measures round-trip client latency and extracts rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Algorithm`, `Retry-After`) from the response.
- **getState(identifier)** — GETs `/api/ratelimit/state/{identifier}` to read current state without consuming a token.
- **resetLimit(identifier)** — DELETEs `/api/ratelimit/reset/{identifier}` to clear the rate limit for testing.
- **batchCheck(checks)** — POSTs an array of check requests to `/api/ratelimit/batch-check` for multi-identifier testing.
- **fetchMetrics()** — GETs `/api/metrics` for dashboard visualization.

### Frontend: Store Integration

The Zustand store provides a `runTest` action that:

1. Reads the selected algorithm and config from the store
2. Calls `checkRateLimit` with the current configuration
3. On success, prepends the result (with a UUID, timestamp, allowed/denied status, remaining count, latency, and response headers) to the test results array, capping at 100 entries
4. On failure, prepends an error entry with the error message

A separate `fetchMetrics` action sets a loading flag, calls the metrics endpoint, and stores both the time-series data points and summary statistics (total checks, allowed/denied percentages, average and p99 latency).

---

## 5. Deep Dive: Error Handling (6 minutes)

### Backend: Centralized Error Handling

The Express error handler middleware logs every error with its stack trace, request path, and method. It then classifies the error by type:

- **ValidationError** returns 400 with code `VALIDATION_ERROR`
- **NotFoundError** returns 404 with code `NOT_FOUND`
- **RateLimitError** returns 429 with code `RATE_LIMITED`
- All other errors return 500 with code `INTERNAL_ERROR`

In development mode, the stack trace is included in the response body for debugging.

### Frontend: Error Boundary and Toast

The frontend uses a React error boundary that catches render errors and displays a fallback UI with the error message and a "Try Again" button that resets the error state.

For transient errors (API failures, network issues), a toast notification system displays messages for 5 seconds before auto-dismissing. The `useToast` hook provides `showToast(message, type)` and `showError(error)` functions, where type can be 'success', 'error', or 'info'.

---

## 6. Deep Dive: Metrics Synchronization (5 minutes)

### Backend: Metrics Collection

The metrics service aggregates rate limit check results into 1-minute time buckets. Each bucket tracks allowed count, denied count, and a list of latency values.

When the `/api/metrics` endpoint is called, the service:

1. Iterates over all buckets, computing p50 and p99 latencies from the sorted latency arrays
2. Sorts data points chronologically
3. Computes summary statistics: total checks, allowed/denied percentages, average latency, and maximum p99 latency across all buckets
4. Cleans up buckets older than 1 hour to bound memory usage

### Frontend: Polling with Auto-Refresh

The dashboard uses a `useMetricsPolling` hook that calls `fetchMetrics` immediately on mount and then at a configurable interval (default 5 seconds). The hook exposes an `isPolling` toggle so users can pause the auto-refresh. The interval is cleaned up on unmount or when polling is disabled.

---

## 7. Trade-offs Summary

| Decision | Choice | Trade-off | Alternative |
|----------|--------|-----------|-------------|
| API style | REST | Stateless, cacheable | GraphQL (flexible queries) |
| Metrics delivery | Polling (5s) | Simple, reliable | WebSocket (real-time) |
| Error handling | Centralized | Consistent format | Per-route (flexible) |
| State sync | Optimistic UI | Fast feedback | Wait for confirmation |
| Header passing | Response headers | Standard approach | Body only (simpler) |

---

## 8. Testing Strategy

### Backend Integration Tests

The test suite verifies end-to-end behavior:

- **Under limit**: POST a check request with identifier "test-user", sliding algorithm, limit 10, window 60s. Assert status 200, `allowed = true`, `remaining = 9`, and `X-RateLimit-Limit` header equals "10".
- **Over limit**: Exhaust the limit by sending 10 requests for "test-user-2" with fixed algorithm and limit 10. The 11th request should return status 429, `allowed = false`, and include a `Retry-After` header.

### Frontend Component Tests

The RequestTester component test mocks the `checkRateLimit` API call to return an allowed response with 9 remaining. After clicking "Send Request", it waits for the UI to show "Allowed" and display the `X-RateLimit-Remaining: 9` header value.

---

## 9. Future Enhancements

1. **WebSocket Metrics** - Real-time streaming instead of polling
2. **Rule Configuration UI** - Visual editor for rate limit rules
3. **Comparison Mode** - Test same request with multiple algorithms
4. **Export/Import** - Save and share configurations
5. **API Documentation** - Swagger/OpenAPI integration

---

## Summary

"To summarize, I've designed a fullstack rate limiting service with:

1. **Clean API contract** with typed request/response interfaces and standard rate limit headers
2. **End-to-end flow** from dashboard configuration through Redis-based limiting to UI feedback
3. **Comprehensive error handling** with centralized backend handler and frontend error boundaries
4. **Metrics synchronization** using polling with automatic refresh for near-real-time dashboard updates
5. **Algorithm selection UI** with visual animations and immediate test feedback
6. **Testing strategy** covering both backend integration and frontend components

The key insight is that a rate limiter is only useful if developers can understand and configure it correctly. The interactive dashboard with visual algorithm demos and live testing makes the abstract concepts of token buckets and sliding windows concrete and intuitive, while the clean API contract ensures reliable integration with client applications."
