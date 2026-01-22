# Facebook News Feed - System Design Answer (Full-Stack Focus)

## 45-minute system design interview format - Full-Stack Engineer Position

---

## Introduction

"Today I'll design a personalized news feed system similar to Facebook's, taking a full-stack perspective. The core challenges span both domains: on the backend, we need to solve the write amplification problem for celebrities while maintaining low read latency; on the frontend, we need to render a performant virtualized feed with real-time updates. I'll focus on the integration points where frontend and backend work together - the API contract, WebSocket protocol, optimistic updates, and data consistency patterns."

---

## Step 1: Requirements Clarification

### Functional Requirements

"Let me confirm the end-to-end requirements:

1. **Feed Generation**: Backend ranks and serves personalized posts, frontend renders infinite scroll
2. **Post Creation**: Frontend composer submits to API, backend fans out to followers
3. **Real-time Updates**: Backend pushes via WebSocket, frontend queues and displays
4. **Engagement**: Frontend shows optimistic likes/comments, backend validates and persists
5. **Follow System**: Frontend profile actions, backend updates social graph and backfills feed"

### Non-Functional Requirements

"End-to-end requirements:

- **Latency**: < 200ms from click to rendered feed (including network + render)
- **Consistency**: Eventual consistency for feed (< 10 seconds), optimistic UI makes it feel instant
- **Reliability**: Graceful degradation - offline viewing, retry with idempotency
- **Bundle + API**: Initial load < 3s on 3G connection"

---

## Step 2: System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Frontend (React + Zustand)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Feed UI    │  │   Composer   │  │  WebSocket   │  │   Optimistic │    │
│  │ (Virtualized)│  │    Modal     │  │    Hook      │  │    Updates   │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         │                 │                 │                 │             │
└─────────┼─────────────────┼─────────────────┼─────────────────┼─────────────┘
          │                 │                 │                 │
          ▼                 ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          API Gateway / Load Balancer                         │
│                     REST (HTTPS) + WebSocket (WSS)                          │
└─────────────────────────────────────────────────────────────────────────────┘
          │                 │                 │                 │
          ▼                 ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Backend Services                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Feed Service │  │ Post Service │  │ WS Gateway   │  │ Engagement   │    │
│  │  (Ranking)   │  │  (Fan-out)   │  │ (Real-time)  │  │   Service    │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    Shared: Redis + PostgreSQL + Kafka                   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 3: Shared Type Definitions

### TypeScript Types Package

"Creating a shared types package ensures API contract consistency."

**User Types**

The User interface includes: id, username, displayName, avatarUrl, optional bio, followerCount, followingCount, isCelebrity flag (true if >= 10K followers), and createdAt timestamp. UserProfile extends User with viewer-specific fields: isFollowing and mutualFriends count.

**Post Types**

PostPrivacy is either 'public' or 'friends'. PostType covers 'text', 'image', 'video', or 'link'.

The Post interface includes: id, authorId, denormalized author (UserSummary), content, optional imageUrl, postType, privacy, likeCount, commentCount, shareCount, viewer-specific isLiked flag, createdAt, and updatedAt.

UserSummary is a lightweight user reference: id, username, displayName, avatarUrl.

**Comment Types**

Comment includes: id, postId, userId, user (UserSummary), content, likeCount, and createdAt.

**API Request/Response Types**

| Type | Fields |
|------|--------|
| CreatePostRequest | content, optional imageUrl, privacy |
| CreatePostResponse | post, optional conflicts array |
| FeedResponse | posts array, pagination (nextCursor, hasMore) |
| CreateCommentRequest | content |
| EngagementUpdate | postId, likeCount, commentCount, shareCount |

**WebSocket Message Types**

| Direction | Message Types |
|-----------|---------------|
| Client -> Server | subscribe_feed, unsubscribe_feed, ping |
| Server -> Client | new_post, post_update, engagement_update, connection_ack, pong, error |

ClientMessage contains: type, optional payload, optional requestId. ServerMessage contains: type, payload, timestamp, optional correlationId (matches requestId).

NewPostPayload wraps a Post object. EngagementUpdatePayload contains: postId, field (likeCount/commentCount/shareCount), delta, and newValue.

**API Error Types**

ApiError includes: code, message, optional details object. ApiResponse<T> is a discriminated union: either success true with data, or success false with error.

---

## Step 4: REST API Design

### API Endpoints

**GET /api/v1/feed** - Fetch personalized feed for authenticated user

Query params: cursor (optional string for pagination), limit (optional, default 20, max 50). Returns FeedResponse.

The handler fetches feed from feedService with pagination, attaches viewer-specific isLiked status via engagementService, and returns the response with success true.

**POST /api/v1/posts** - Create a new post

Headers: X-Idempotency-Key (required for retry safety). Body: CreatePostRequest. Returns CreatePostResponse.

The handler validates that content or imageUrl exists, creates the post via postService, enqueues a fan-out event to Kafka with type, postId, authorId, and createdAt, then returns 201 with the post.

**POST /api/v1/posts/:postId/like** - Like a post (idempotent)

The handler calls engagementService.likePost, broadcasts engagement update via realtimeService if the like status changed, and returns the new like status and count.

### Frontend API Client

The feedApi object provides typed methods:
- getFeed(cursor?): fetches /feed with optional cursor
- createPost(data, idempotencyKey): POSTs to /posts with X-Idempotency-Key header
- likePost(postId): POSTs to /posts/{postId}/like
- unlikePost(postId): DELETEs /posts/{postId}/like

All methods use a shared request function that handles JSON content-type, credentials (include for session cookie), and ApiResponse parsing with ApiError throwing.

---

## Step 5: WebSocket Protocol Design

### Backend WebSocket Gateway

The WebSocketGateway class manages real-time connections.

**State Management**

- clients: Map of clientId to ConnectedClient (ws, userId, subscribedFeeds set)
- redis: Primary Redis connection for publishing
- subscriber: Duplicate Redis connection for subscriptions

**Redis Subscription Setup**

Subscribes to patterns: feed_updates:* and celebrity_updates:*. On pmessage events, routes to handleRedisMessage.

**Connection Handling**

On new connection:
1. Generate clientId from userId and timestamp
2. Create ConnectedClient record
3. Send connection_ack with clientId
4. Auto-subscribe to user's feed_updates:{userId} channel
5. Subscribe to all followed celebrities' channels
6. Set up message, close, and error handlers

**Message Handling**

| Message Type | Action |
|--------------|--------|
| ping | Reply with pong, include correlationId matching requestId |
| subscribe_feed | Add feed_updates:{userId} to client's subscribed feeds |

**Redis Message Routing**

When receiving Redis pub/sub messages, find all clients subscribed to the channel and send appropriate WebSocket message (new_post for both feed_updates and celebrity_updates channels).

**Broadcasting Engagement Updates**

The broadcastEngagementUpdate method creates an EngagementUpdatePayload and publishes to engagement:{postId} channel for all server instances to receive.

**Disconnect Handling**

Simply removes the client from the clients map.

### Frontend WebSocket Hook

The useWebSocket hook manages client-side WebSocket connection.

**Refs and State**

- wsRef: Current WebSocket connection
- reconnectTimeoutRef: Scheduled reconnection
- reconnectAttempts: Counter for backoff
- heartbeatIntervalRef: Ping interval timer

**Connection Lifecycle**

On open:
- Reset reconnect attempts to 0
- Start heartbeat (ping every 30 seconds)

On message:
- Parse ServerMessage
- Route by type: new_post calls handleNewPost, engagement_update calls handleEngagementUpdate, pong is acknowledged, error is logged

On close:
- Clear heartbeat interval
- Schedule reconnection

**Reconnection Strategy**

Exponential backoff: 1s, 2s, 4s, 8s... up to 30s max. Gives up after 10 attempts.

**Cleanup**

Effect cleanup closes WebSocket and clears all timers.

---

## Step 6: Optimistic Updates with Reconciliation

### Frontend Store with Optimistic Updates

The useFeedStore (Zustand with immer) manages feed state and optimistic updates.

**State Structure**

- posts: Ordered array of Post objects
- postsById: Lookup table for quick access
- pendingActions: Map tracking in-flight mutations with original state for rollback

**PendingAction Structure**

Each pending action stores: id, type (like/unlike/create_post), optional postId, optional originalState (for rollback), and timestamp.

**likePost Action**

1. Generate actionId (UUID)
2. Early return if post not found or already liked
3. Record pending action with original isLiked and likeCount
4. Apply optimistic update: set isLiked true, increment likeCount
5. Call API
6. On success: remove pending action
7. On failure: rollback to original state, remove pending action, rethrow

**createPost Action**

1. Generate idempotencyKey (UUID)
2. Create tempId from key
3. Build optimistic Post with temp ID, current user as author, zero counts
4. Add to posts at index 0, add to postsById, record pending action
5. Call API with idempotency key
6. On success: replace temp post with real post in both structures, clear pending action
7. On failure: remove temp post from both structures, clear pending action, rethrow

**handleEngagementUpdate Action**

1. Find post in postsById
2. Check if any pending action targets this post
3. If pending action exists: skip update (optimistic value takes precedence)
4. If no pending action: apply server value

**handleNewPost Action**

1. Skip if post already exists (from our own optimistic update)
2. If user scrolled down (scrollY > 200): queue to pendingUpdates, increment newPostsCount for banner
3. If at top: prepend to posts array and add to postsById

---

## Step 7: Idempotency Implementation

### Backend Idempotency Middleware

**Constants**

- IDEMPOTENCY_TTL: 86400 seconds (24 hours)

**CachedResponse Structure**

Stores: status code, body, and headers (Content-Type).

**Middleware Flow**

1. Only apply to mutating methods (POST, PUT, PATCH, DELETE)
2. Extract X-Idempotency-Key header; return 400 if missing
3. Build composite key: idempotency:{userId}:{path}:{idempotencyKey}
4. Check Redis for existing cached response
5. If cached: set headers, add X-Idempotency-Replayed: true, return cached response
6. If not cached: wrap res.json to cache successful responses (2xx) before sending
7. On Redis error: fail open (allow request to proceed)

### Frontend Retry with Idempotency

**RetryConfig**

- maxRetries: 3 (default)
- baseDelay: 1000ms
- maxDelay: 10000ms

**mutationRequest Function**

1. Generate idempotency key once (UUID)
2. Loop for maxRetries + 1 attempts
3. On each attempt: fetch with X-Idempotency-Key header
4. Log if X-Idempotency-Replayed header is true
5. On client error (4xx): throw immediately, don't retry
6. On server error (5xx): wait with exponential backoff, retry
7. After all retries exhausted: throw last error

---

## Step 8: Feed Caching Integration

### Backend Cache-Aside with Write-Through

The FeedService class manages feed retrieval with caching.

**getFeed Method**

1. Try cache: get postIds from Redis sorted set (limit * 2 for ranking headroom)
2. Cache miss: build from DB, cache the results
3. Get celebrity posts (pull model for high-follower accounts)
4. Merge and dedupe all post IDs
5. Batch fetch post data
6. Filter by privacy rules
7. Apply ranking algorithm
8. Paginate and return

**Cache Operations**

- getCachedFeed: ZREVRANGE on feed:{userId} key
- cacheFeed: Pipeline ZADD with timestamp scores, EXPIRE for 24 hours
- invalidateFeedCache: DEL feed:{userId}
- warmFeedOnLogin: Check TTL, rebuild in background if < 1 hour remaining

### Frontend Cache with Persistence

The store uses Zustand's persist middleware with localStorage.

**Storage Configuration**

Custom storage handlers:
- getItem: Parse JSON, check timestamp, return null if > 1 hour old
- setItem: Wrap state with current timestamp
- removeItem: Clear from localStorage

**Partialize**

Only persist essential data: first 20 posts and corresponding postsById entries. This keeps the cache small while enabling instant initial render.

---

## Step 9: End-to-End Flow Example

### Post Creation Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. User clicks "Post" in Composer                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│   Frontend:                                                                  │
│   - Generate idempotencyKey = uuid()                                        │
│   - Create optimistic post with temp ID                                     │
│   - Add to posts array at index 0                                           │
│   - Show post in feed immediately                                           │
│   - Set pending action for rollback                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. POST /api/v1/posts (with X-Idempotency-Key)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│   Backend:                                                                   │
│   - Check idempotency cache -> miss                                          │
│   - Validate content                                                         │
│   - Insert into PostgreSQL (posts table)                                    │
│   - Enqueue fan-out event to Kafka                                          │
│   - Cache response with idempotencyKey                                      │
│   - Return 201 with post data                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. Response received                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│   Frontend:                                                                  │
│   - Replace temp post with real post                                        │
│   - Update postsById with real ID                                           │
│   - Clear pending action                                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. Fan-out (async background)                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│   Backend Fan-out Worker:                                                   │
│   - Consume Kafka event                                                     │
│   - Check author follower count                                             │
│   - If < 10K: Push to all followers' Redis feeds                           │
│   - If >= 10K: Add to celebrity_posts sorted set                           │
│   - Publish to Redis pub/sub for online users                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 5. WebSocket notification                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│   Backend WebSocket Gateway:                                                │
│   - Receive Redis pub/sub message                                           │
│   - Find subscribed clients                                                 │
│   - Send "new_post" message to each                                         │
│                                                                              │
│   Frontend (other users):                                                   │
│   - Receive WebSocket message                                               │
│   - If scrolled: Add to pendingUpdates, show "1 new post" banner           │
│   - If at top: Insert post into feed                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 10: Integration Testing Strategy

### E2E Test Example

**Test Setup**

Before all tests: create test user with token and userId. After all tests: clean up test data.

**Test: creates post and sees it in feed**

1. Login via form submission
2. Wait for feed to load
3. Create post with unique content (include timestamp)
4. Verify optimistic update: post content visible immediately
5. Reload page, verify post persists after refresh

**Test: handles like with optimistic update and rollback**

1. Navigate to feed, wait for post cards
2. Get initial like count
3. Click like button
4. Verify optimistic update: aria-pressed true, count incremented
5. Mock network failure for next like request
6. Click unlike (will fail)
7. Verify rollback: still shows liked state

**Test: receives real-time updates via WebSocket**

1. Open two browser contexts (page and page2)
2. Login both as different users
3. User1 follows User2
4. User2 creates a post with unique content
5. Wait for User1 to see the post via WebSocket (10s timeout)

---

## Trade-offs and Alternatives

| Decision | Chosen | Alternative | Reasoning |
|----------|--------|-------------|-----------|
| **API Style** | REST with JSON | GraphQL | Simpler caching, familiar patterns, cursor pagination |
| **Shared Types** | TypeScript package | OpenAPI/Swagger | Direct type sharing, compile-time safety |
| **Real-time** | WebSocket | Server-Sent Events | Bidirectional for future features (typing indicators) |
| **Optimistic Updates** | Zustand with rollback | React Query mutations | More control over complex multi-step updates |
| **Idempotency** | Client-generated key | Server-generated | Enables retry without round-trip |
| **State Persistence** | localStorage | IndexedDB | Simpler API, sufficient for feed cache |

---

## Future Enhancements

1. **Service Worker**: Background sync for offline post creation
2. **GraphQL Subscriptions**: Replace WebSocket for more structured real-time
3. **Conflict Resolution**: CRDT-based merge for collaborative features
4. **Request Batching**: Combine multiple API calls into single request
5. **Prefetching**: Anticipate next page of feed during scroll
6. **A/B Testing**: Feature flags shared between frontend and backend

---

## Summary

"For the Facebook News Feed full-stack architecture:

1. **Shared Types Package**: Single source of truth for API contracts, WebSocket messages, and domain models ensures type safety across the stack

2. **Optimistic Updates with Rollback**: Frontend immediately reflects user actions; pending action map tracks original state for rollback on failure

3. **Idempotency Pattern**: Client generates idempotency key, backend caches responses - enables safe retries without duplicate posts

4. **WebSocket Protocol**: Structured message types with correlation IDs enable reliable real-time updates without disrupting scroll position

5. **Cache Strategy**: Backend write-through to Redis on fan-out, frontend persists recent posts to localStorage for instant initial render

6. **Graceful Degradation**: Each layer has fallbacks - cache miss hits DB, WebSocket disconnect falls back to polling, network failure triggers rollback

The key full-stack insight is that optimistic UI and idempotency work together - the frontend can show instant feedback and retry on failure, while the backend ensures exactly-once semantics through the idempotency key. The shared types package eliminates an entire class of integration bugs by ensuring both sides speak the same language."
