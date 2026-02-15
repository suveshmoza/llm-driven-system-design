# MCPlator - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Problem Statement

Design MCPlator, a retro calculator with an LLM-powered AI co-pilot that translates natural language into calculator operations. The backend challenge focuses on low-latency LLM integration, SSE streaming, edge computing, and rate limiting at the API layer.

## Requirements Clarification

### Functional Requirements
- **AI Chat Endpoint**: Process natural language and return structured key sequences
- **Streaming Responses**: Real-time token delivery via SSE
- **Rate Limiting**: Protect API costs with per-client quotas
- **URL Sharing**: Encode/decode LMCIFY compressed messages

### Non-Functional Requirements
- **Latency**: < 500ms first token latency
- **Availability**: 99.9% uptime for API
- **Cost Efficiency**: Rate limiting to control Claude API spend
- **Security**: API key protection, input sanitization

### Scale Estimates
- **Daily Requests**: 10K-50K API calls
- **Message Size**: Average 50 characters per request
- **Response Size**: Average 200 tokens per response

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                         │
└───────────────────────────────┬──────────────────────────────────┘
                                │ POST /api/chat (SSE Stream)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EDGE LAYER (Vercel Edge Functions)            │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Rate Limiter │→ │ Input Valid. │→ │ Anthropic Proxy      │   │
│  │ (per-IP)     │  │ Sanitization │  │ (Stream Transform)   │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL (Anthropic Claude API)               │
│                       Claude Haiku 4.5                           │
│                    ~200ms first token latency                    │
└─────────────────────────────────────────────────────────────────┘
```

## Deep Dives

### 1. Edge Function Architecture

**Why Edge Runtime?**

Vercel Edge Functions run on Cloudflare's global network, reducing latency:

```
User (Tokyo) → Edge Function (Tokyo) → Claude API (US)
Total: ~250ms first token

vs.

User (Tokyo) → Node.js Function (US) → Claude API (US)
Total: ~400ms first token
```

**Edge Function Implementation:**

The chat endpoint runs on the edge runtime and processes requests through five stages:

1. **Rate limiting**: Extract the client IP from headers, check against the rate limiter. If rejected, return HTTP 429 with a retryAfter value
2. **Input validation**: Parse the JSON body for message and requestId fields. Reject messages that are empty or exceed 500 characters with HTTP 400
3. **Idempotency check**: Look up the requestId in the KV store. If a cached response exists, return it directly with the SSE content type
4. **Claude API call**: Send the message to Claude Haiku with the calculator system prompt, requesting a streaming response with a 150-token max
5. **Stream return**: Convert the Claude stream to a ReadableStream and return it as an SSE response with no-cache headers

**Edge Runtime Constraints:**

| Capability | Available | Alternative |
|------------|-----------|-------------|
| Streaming | Yes | N/A |
| Node.js APIs | No | Web APIs only |
| Timeout | 30s (hobby) | Pro tier: 5min |
| Cold start | ~50ms | Node.js: ~300ms |
| File system | No | External storage |

### 2. Rate Limiting Strategy

**Token Bucket Implementation with Vercel KV:**

The rate limiter uses a token bucket algorithm stored in Vercel KV. Configuration defines tokens per minute (10 for anonymous users), tokens per day (100), and a refill rate (0.17 tokens/second, which replenishes 10 per minute).

The check proceeds as follows:

1. Hash the client IP for privacy and construct the KV key `ratelimit:{hashedIp}`
2. Retrieve the existing bucket state (tokens remaining, last refill timestamp, daily count, day start) or create a fresh bucket
3. **Daily limit check**: If more than 24 hours have passed since dayStart, reset the daily counter. If dailyCount exceeds the daily limit (100), reject with the time remaining until reset
4. **Token refill**: Calculate elapsed time since lastRefill, multiply by the refill rate, and add tokens (capped at the per-minute maximum)
5. **Token consumption**: If fewer than 1 token remains, reject with an estimate of when the next token will be available. Otherwise, decrement tokens by 1, increment dailyCount, and persist the bucket with a 24-hour TTL

The response includes remaining token count and resetIn duration, which are added to the HTTP response as `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers.

### 3. SSE Streaming Implementation

**Server-Side Stream Transformation:**

The SSE stream transformer wraps the Anthropic streaming response into a ReadableStream that formats each chunk as an SSE event:

1. Create a ReadableStream with an async start function
2. Iterate over the Anthropic stream events. For each `content_block_delta` event, extract the text and accumulate it into a full response buffer. Encode each delta as an SSE event: `data: {"type": "delta", "text": "..."}\n\n`
3. After the stream completes, parse the full accumulated response to extract calculator key sequences
4. Send a final SSE completion event containing the parsed keys array and explanation text
5. If any error occurs during processing, send an SSE error event and close the stream

**Response Parsing:**

The parser attempts to extract a JSON object from the LLM's response text using a regex match for `{...}`. If valid JSON with a `keys` array is found, it returns that directly. Otherwise, a fallback function extracts numbers and operators from the raw text to construct a best-effort key sequence.

### 4. Prompt Engineering for Structured Output

**System Prompt Design:**

The system prompt assigns a role ("You control a Casio calculator"), lists all available keys (0-9, operators, memory, clear), provides explicit formatting rules (individual digits, always end with "="), includes examples for edge cases (percentage, square root), and constrains output to JSON-only with a keys array and explanation string.

**Why This Prompt Works:**

| Element | Purpose |
|---------|---------|
| Role assignment | "You control a Casio calculator" - sets context |
| Available actions | Explicit key list prevents hallucination |
| Rules with examples | Shows expected format for edge cases |
| Output constraint | "Output ONLY valid JSON" enforces structure |

### 5. Idempotency and Request Deduplication

**Idempotency Key Handling:**

Each chat request includes a message, a client-generated requestId (UUID), and a timestamp. The handler follows this flow:

1. Construct a cache key: `request:{requestId}`
2. Check KV for a cached response. If found, return it immediately with an `X-Idempotent-Replay: true` header
3. If no cache hit, process the chat request through the Claude API
4. Cache the response in KV with a 5-minute TTL
5. Return the fresh response

**Client-Side Key Generation:**

The client generates an idempotency key by combining the session ID, current timestamp, and a hash of the message text. This ensures that the same message sent twice within a session produces the same key, while different messages produce different keys.

### 6. Circuit Breaker for Claude API

**Implementation:**

The circuit breaker maintains three states (Closed, Open, Half-Open), a failure counter, and a last failure timestamp. Configuration includes a failure threshold (5), reset timeout (30 seconds), and a half-open request allowance (3).

The execution flow works as follows:

1. **In CLOSED state**: Execute the wrapped function normally. On success, reset the failure counter. On failure, increment the counter. If failures reach the threshold, transition to OPEN
2. **In OPEN state**: Check if the reset timeout has elapsed since the last failure. If not, throw a CircuitOpenError immediately (no API call made). If the timeout has elapsed, transition to HALF_OPEN
3. **In HALF_OPEN state**: Allow the request through. On success, transition back to CLOSED and reset counters. On failure, transition back to OPEN

**Graceful Degradation:**

When the circuit breaker catches a CircuitOpenError, the AI response handler returns a friendly fallback message: "AI assistant temporarily unavailable. Calculator still works!" with an empty keys array. This ensures the calculator remains functional even when the Claude API is down -- users can still press buttons manually.

### 7. Observability

**Key Metrics:**

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| `ai_request_duration_ms` | Histogram | End-to-end latency | p95 > 1000ms |
| `ai_first_token_ms` | Histogram | Time to first token | p95 > 500ms |
| `ai_request_errors` | Counter | Failed requests | > 5 in 5 minutes |
| `rate_limit_hits` | Counter | Rate limited requests | > 100/hour |
| `circuit_breaker_state` | Gauge | 0=closed, 1=half, 2=open | state = 2 |

**Structured Logging:**

Each log entry contains: timestamp (ISO 8601), level (info/warn/error), service name ('edge-function'), requestId, event name, and a metadata object with arbitrary key-value pairs. Entries are serialized as single-line JSON and written to stdout.

Example metadata for an `ai_request_complete` event includes: duration_ms, tokens_used, and model name. This structured format enables querying logs by requestId for tracing and by event type for monitoring dashboards.

## Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Compute | Edge Functions | Node.js | 50ms cold start vs 300ms |
| AI Model | Claude Haiku | GPT-3.5 | Faster, cheaper, better structured output |
| Streaming | SSE | WebSocket | Simpler for one-way, works with serverless |
| Rate limiting | Token bucket (KV) | Sliding window | Smoother bursting |
| Caching | Vercel KV | Redis | Native integration, edge-accessible |
| Idempotency | Request ID + KV | None | Prevents duplicate API charges |

## Future Enhancements

1. **Response Caching**: Cache common calculations (e.g., "15% of 100") to reduce API calls
2. **Multi-Region KV**: Replicate rate limit state across regions for global consistency
3. **Request Batching**: Combine multiple quick requests into single API call
4. **Model Fallback**: Fall back to GPT-3.5 if Claude is unavailable
5. **Usage Analytics**: Track popular queries for optimization opportunities
