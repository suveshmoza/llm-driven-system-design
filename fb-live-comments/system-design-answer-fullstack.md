# Facebook Live Comments - System Design Answer (Full-Stack Focus)

## 45-minute system design interview format - Full-Stack Engineer Position

## Introduction

"Today I'll design a real-time commenting system for live video streams, similar to Facebook Live or YouTube Live. As a full-stack engineer, I'll focus on the integration points between frontend and backend - the WebSocket protocol design, shared type definitions, end-to-end latency optimization, and how frontend state management works with backend batching. This involves interesting problems around real-time synchronization and graceful degradation."

---

## Step 1: Requirements Clarification

### Functional Requirements

"Let me confirm the end-to-end experience:

1. **Real-Time Comments**: Users post comments that appear for all viewers within 2-3 seconds
2. **Batched Delivery**: Comments batched for efficiency, reactions aggregated
3. **Connection Resilience**: Comments queued offline, delivered on reconnect
4. **Rate Limiting**: Frontend prevents spam, backend enforces limits
5. **Graceful Degradation**: Experience adapts based on stream popularity

Should I focus on the comments feature or also cover video playback integration?"

### Non-Functional Requirements

"For a full-stack live comments system:

- **E2E Latency**: Comment posted to displayed: p95 < 500ms
- **Offline Support**: Queue up to 10 pending comments
- **Type Safety**: Shared TypeScript types between frontend and backend
- **Testability**: Integration tests for WebSocket message flows"

---

## Step 2: System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Full-Stack View                                 │
├─────────────────────────────────┬───────────────────────────────────────────┤
│           FRONTEND              │              BACKEND                       │
│  ┌───────────────────────────┐  │  ┌───────────────────────────────────┐    │
│  │       React App           │  │  │          API Gateway              │    │
│  │  ┌─────────────────────┐  │  │  │  ┌─────────────────────────────┐  │    │
│  │  │  useLiveStream Hook │◄─┼──┼──┼─►│     WebSocket Server        │  │    │
│  │  │  - WS connection    │  │  │  │  │     - Connection pool       │  │    │
│  │  │  - State sync       │  │  │  │  │     - Message routing       │  │    │
│  │  ├─────────────────────┤  │  │  │  ├─────────────────────────────┤  │    │
│  │  │   Zustand Store     │  │  │  │  │     CommentService          │  │    │
│  │  │   - comments[]      │  │  │  │  │     - Rate limiting         │  │    │
│  │  │   - pendingComments │  │  │  │  │     - Batching              │  │    │
│  │  │   - connection stat │  │  │  │  │     - Persistence           │  │    │
│  │  └─────────────────────┘  │  │  │  └─────────────────────────────┘  │    │
│  └───────────────────────────┘  │  └───────────────────────────────────┘    │
│                                 │                                            │
│    Shared: @acme/live-comments-types                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 3: Shared Type Definitions

### WebSocket Message Protocol

The shared types package defines all message contracts between client and server.

**Client to Server Messages:**

| Message Type | Purpose | Key Fields |
|-------------|---------|------------|
| `join_stream` | Subscribe to stream | streamId, userId, lastSeenCommentId |
| `leave_stream` | Unsubscribe | (empty payload) |
| `post_comment` | Submit new comment | streamId, content, idempotencyKey, parentId? |
| `react` | Send reaction | streamId, reactionType, commentId? |

**Server to Client Messages:**

| Message Type | Purpose | Key Fields |
|-------------|---------|------------|
| `comments_batch` | Deliver comments | streamId, comments[], isBackfill |
| `reactions_batch` | Aggregated reactions | streamId, counts, timestamp |
| `viewer_count` | Update viewer count | streamId, count |
| `ack` | Confirm comment receipt | idempotencyKey, commentId, status |
| `error` | Report errors | code, message, retryable |

**Comment Entity:**
- id, streamId, userId, username, avatarUrl
- content, parentId (optional)
- isHighlighted, isPinned, createdAt

**Reaction Types:** like, love, haha, wow, sad, angry

**Error Codes:** RATE_LIMITED, BANNED, CONTENT_VIOLATION, STREAM_ENDED, UNAUTHORIZED

---

## Step 4: Backend WebSocket Server

### WebSocket Gateway Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        WebSocket Gateway                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐          │
│  │   Connections   │    │     Batchers    │    │  Redis Pub/Sub  │          │
│  │   Map<WS, Ctx>  │    │  Map<Stream,B>  │    │   Subscriber    │          │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘          │
│           │                      │                      │                    │
│           ▼                      ▼                      ▼                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Message Handler                                   │    │
│  │  join_stream  │  leave_stream  │  post_comment  │  react            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Connection Context

Each WebSocket connection maintains:
- ws: WebSocket instance
- userId: authenticated user ID
- streamId: currently joined stream (or null)
- joinedAt: connection timestamp

### Message Handling Flow

**Join Stream:**
1. Leave previous stream if any
2. Check if user is banned from stream
3. Add to stream connections map
4. Initialize batcher for stream if needed
5. Update viewer count in Redis
6. Send backfill of recent comments

**Post Comment:**
1. Verify user has joined the stream
2. Check idempotency key (return cached response if exists)
3. Apply rate limiting (reject if exceeded)
4. Validate content (check for violations)
5. Generate Snowflake ID for comment
6. Store idempotency key with 5-minute TTL
7. Add comment to stream batcher
8. Persist asynchronously
9. Send acknowledgment

**Backfill Logic:**
- If `lastSeenCommentId` provided: fetch comments since that ID (resume)
- Otherwise: fetch last 50 comments (fresh join)
- Mark batch as `isBackfill: true`

### Redis Pub/Sub Integration

- Subscribe to channels: `stream:{streamId}:comments`, `stream:{streamId}:reactions`
- On message: broadcast to all connected clients for that stream
- Enables horizontal scaling across multiple gateway instances

---

## Step 5: Frontend WebSocket Integration

### useLiveStream Hook Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          useLiveStream Hook                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  WebSocket   │  │   Pending    │  │  Reconnect   │  │   Store      │    │
│  │    Ref       │  │   Comments   │  │   Timer      │  │   Actions    │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                              │
│  Connect ──► Open ──► Join Stream ──► Retry Pending Comments                │
│                                                                              │
│  On Message:                                                                 │
│    comments_batch → addCommentBatch()                                       │
│    reactions_batch → addReactionBurst()                                     │
│    viewer_count → setViewerCount()                                          │
│    ack → handleAck()                                                        │
│    error → handleError()                                                    │
│                                                                              │
│  On Close (abnormal) → scheduleReconnect() with exponential backoff         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Pending Comments Management

Each pending comment tracks:
- idempotencyKey: unique identifier for deduplication
- content: comment text
- addedAt: timestamp for expiry check
- retryCount: number of retry attempts

**Retry Logic:**
- On reconnect, iterate pending comments
- Skip if older than 5 minutes (mark as failed)
- Skip if retryCount >= 3 (mark as failed)
- Otherwise increment retryCount and resend

### Acknowledgment Handling

| Status | Action |
|--------|--------|
| accepted | Remove from pending, update UI with real ID |
| rate_limited | Keep pending, retry after 6 second cooldown |
| rejected | Remove from pending, mark as rejected in UI |

### Reconnection Strategy

- Exponential backoff: 1s, 2s, 4s, 8s... up to 30s max
- On successful reconnect: join stream with `lastSeenCommentId`
- Retry all pending comments automatically

---

## Step 6: Optimistic Updates and Reconciliation

### Store State Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LiveStream Store                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  comments: Comment[]              Real comments from server                  │
│  optimisticComments: [            Locally-added, awaiting confirmation      │
│    { id, idempotencyKey,                                                    │
│      content, status, createdAt }                                           │
│  ]                                                                           │
│  lastSeenCommentId: string        For resume on reconnect                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  Actions:                                                                    │
│  - addCommentBatch(comments[])    Merge real comments, remove matched opts  │
│  - addOptimisticComment(comment)  Add to optimistic list                    │
│  - updateCommentStatus(key, st)   Update or remove optimistic comment       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Optimistic Comment Status Flow

```
┌──────────┐     ┌─────────┐     ┌──────────┐
│ pending  │────►│  sent   │────►│ removed  │ (appears in real comments)
└──────────┘     └─────────┘     └──────────┘
     │                │
     ▼                ▼
┌────────────┐   ┌──────────┐
│rate_limited│   │ rejected │
└────────────┘   └──────────┘
     │
     ▼ (after cooldown)
┌──────────┐
│  retry   │
└──────────┘
```

### Comment List Display

The UI merges real and optimistic comments:
1. Map real comments with `isOptimistic: false`
2. Filter optimistic comments where status !== 'sent'
3. Map pending optimistic as display items with visual indicator
4. Concatenate both lists for rendering

Optimistic comments show:
- "Sending..." indicator for pending status
- "Retry in Xs..." for rate_limited status
- Error indicator for rejected status

---

## Step 7: Comment Batching Service

### Backend Batcher Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Comment Batcher (per stream)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  buffer: Comment[]                 Accumulated comments awaiting flush       │
│  timer: Interval                   Periodic flush trigger                    │
│  batchInterval: number             Adjusted based on viewer count           │
├─────────────────────────────────────────────────────────────────────────────┤
│  addComment(comment) → buffer.push(comment)                                 │
│  start() → setInterval(flush, batchInterval)                                │
│  stop() → clearInterval, flush remaining                                    │
│  flush() → publish batch to Redis, cache for new joiners                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Degradation Policy

Batch interval and sampling rate adjust based on viewer count:

| Viewer Count | Batch Interval | Show All | Sampling Rate |
|-------------|----------------|----------|---------------|
| < 1,000     | 100ms          | Yes      | 100%          |
| 1K - 10K    | 200ms          | Yes      | 100%          |
| 10K - 100K  | 500ms          | No       | 50%           |
| > 100K      | 1000ms         | No       | 20%           |

### Comment Sampling (High-Volume Streams)

When sampling is enabled:
1. Score each comment (random base + priority bonuses)
2. Highlighted comments: +10 score
3. Questions (contains "?"): +2 score
4. Sort by score descending
5. Take top N based on sampling rate

### Recent Comments Cache

After each flush:
1. LPUSH comments to `recent:stream:{streamId}`
2. LTRIM to keep last 1000
3. Set 1-hour expiry

This cache serves backfill requests for new viewers.

---

## Step 8: Rate Limiting Integration

### Backend Rate Limiter

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Rate Limiter                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  Global Limit: 30 comments per 60 seconds per user                          │
│  Stream Limit: 5 comments per 30 seconds per user per stream                │
├─────────────────────────────────────────────────────────────────────────────┤
│  allow(userId, streamId) returns:                                           │
│    { allowed: true } or                                                     │
│    { allowed: false, reason: 'global_limit'|'stream_limit', retryAfter: N } │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Implementation (Redis Counter):**
1. INCR rate limit key
2. If count === 1, set EXPIRE
3. If count > limit, get TTL for retryAfter

### Frontend Rate Limit UI

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Comment Input Component                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐  ┌──────┐                      │
│  │  Wait 5s...                      [dim]  │  │ Send │ [disabled]           │
│  └─────────────────────────────────────────┘  └──────┘                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  - Subscribe to optimistic comments for rate_limited status                 │
│  - Show countdown timer while rate limited                                  │
│  - Disable input and button during cooldown                                │
│  - Re-enable when countdown reaches 0                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 9: Integration Testing

### WebSocket Message Flow Tests

**Test: Receive comments after joining stream**
1. Connect WebSocket
2. Send join_stream message
3. Assert: receive comments_batch with isBackfill: true

**Test: Receive comment acknowledgment**
1. Connect and join stream
2. Send post_comment with idempotencyKey
3. Assert: receive ack with same idempotencyKey and status: 'accepted'

**Test: Idempotent resubmission**
1. Connect and join stream
2. Send post_comment with idempotencyKey
3. Receive ack with commentId
4. Send same post_comment again
5. Assert: receive ack with same commentId (not duplicated)

### Test Helper: waitFor

Polls a condition with timeout:
- Check condition every 50ms
- Reject after 5 seconds if never satisfied
- Essential for async WebSocket message assertions

---

## Step 10: End-to-End Latency Monitoring

### Latency Tracking Flow

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Client  │───►│ Backend  │───►│  Redis   │───►│  Client  │
│  Sends   │    │ Receives │    │ Pub/Sub  │    │ Displays │
│   t=0    │    │  t=50ms  │    │  t=80ms  │    │  t=150ms │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
```

**Backend:** Add `receivedAt` timestamp in comment metadata

**Frontend:** On rendering comment, calculate:
- displayLatency = Date.now() - comment.metadata.receivedAt
- Report to analytics
- Log warning if > 1000ms

---

## Step 11: Trade-offs and Alternatives

| Decision | Chosen | Alternative | Reasoning |
|----------|--------|-------------|-----------|
| Type Sharing | Shared npm package | Copy-paste types | Single source of truth, compile-time safety |
| Optimistic Updates | Client-side with reconciliation | Wait for server | Better UX, comments appear instantly |
| Idempotency | Client-generated UUID | Server sequence | Works offline, no server round-trip for key |
| Rate Limiting | Both client and server | Server only | Instant feedback on client, enforcement on server |
| Reconnection | Exponential backoff + resume | Simple reconnect | Avoids thundering herd, continues from last seen |
| Message Protocol | JSON over WebSocket | Protocol Buffers | Simpler debugging, acceptable overhead |

---

## Summary

"To summarize the full-stack architecture for Facebook Live Comments:

1. **Shared Types**: Single npm package with all WebSocket message types, ensuring type safety across the stack

2. **Optimistic Updates**: Comments appear instantly on client, reconciled when server confirms

3. **Idempotency**: Client-generated UUIDs prevent duplicates on retry

4. **Batching**: Backend batches comments every 100-500ms based on stream popularity

5. **Reconnection**: Resume from `lastSeenCommentId` to avoid missing comments

6. **Rate Limiting**: Client shows cooldown timer, server enforces limits

7. **Integration Tests**: Full message flow testing with real WebSocket connections

The key full-stack insights are:
- Shared types catch protocol mismatches at compile time
- Idempotency keys must be generated on client for offline support
- Optimistic UI requires careful reconciliation when real data arrives
- Rate limit feedback should be instant (client-side) with server enforcement
- Resume support prevents lost comments during brief disconnects

What aspects would you like me to elaborate on?"
