# Tinder - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## 1. Requirements Clarification (3 minutes)

### Functional Requirements
- **User Profiles**: Registration, photos, preferences management
- **Geospatial Discovery**: Find nearby users matching preferences
- **Swipe System**: Like/Pass with match detection
- **Real-time Matching**: Instant notification on mutual likes
- **Messaging**: Chat between matched users
- **Account Management**: Unmatch, report, block

### Non-Functional Requirements
- **End-to-End Latency**: Swipe to match notification < 100ms
- **Consistency**: No duplicate matches, no lost swipes
- **Privacy**: Location never exposed directly
- **Offline Support**: Queue swipes when disconnected

### Full-Stack Considerations
- Shared types between frontend and backend
- Optimistic UI with backend reconciliation
- Real-time state synchronization via WebSocket
- Coordinated error handling across stack

---

## 2. System Overview (5 minutes)

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   Swipe     │  │   Match     │  │   Message   │  │   Profile   │  │
│  │    Deck     │  │   Grid      │  │    List     │  │   Editor    │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │
│         └────────────────┼────────────────┼────────────────┘         │
│                          │                │                          │
│  ┌───────────────────────┴────────────────┴───────────────────────┐  │
│  │                    Zustand State Stores                         │  │
│  │  [discoveryStore] [matchStore] [messageStore] [profileStore]   │  │
│  └────────────────────────────┬───────────────────────────────────┘  │
│                               │                                       │
│  ┌────────────────────────────┴───────────────────────────────────┐  │
│  │              API Client + WebSocket Manager                     │  │
│  └─────────────────────────────┬──────────────────────────────────┘  │
└────────────────────────────────┼─────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
              REST API                   WebSocket
                    │                         │
┌───────────────────┴─────────────────────────┴─────────────────────────┐
│                         Backend (Express)                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │  Discovery  │  │   Swipe     │  │   Match     │  │  Messaging  │   │
│  │   Service   │  │  Service    │  │  Service    │  │   Gateway   │   │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘   │
│         │                │                │                │          │
│  ┌──────┴────────────────┴────────────────┴────────────────┴───────┐  │
│  │                     Shared Modules                               │  │
│  │  [db.ts] [cache.ts] [elasticsearch.ts] [pubsub.ts] [types.ts]   │  │
│  └─────────────────────────────┬───────────────────────────────────┘  │
└────────────────────────────────┼─────────────────────────────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   PostgreSQL    │    │      Redis      │    │  Elasticsearch  │
│   + PostGIS     │    │  (Cache/Pub)    │    │   (Geo Search)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

---

## 3. Shared Type Definitions (5 minutes)

### Shared Types Package

**User Interface:**
- `id`, `email`, `name`, `birthDate` (ISO date)
- `gender`: 'man' | 'woman' | 'non_binary'
- `bio`, `photos[]`, `preferences`, `isVerified`, `lastActive`, `createdAt`

**Photo Interface:**
- `id`, `url`, `position`, `isMain`

**DiscoveryPreferences Interface:**
- `showMe`: Gender[]
- `ageMin`, `ageMax`, `distanceKm`

**ProfileCard Interface (Discovery):**
- `id`, `name`, `age`, `bio`, `photos[]`
- `distanceText`: Fuzzy display ("5 miles away")
- `commonInterests[]`

**SwipeRequest/Response:**
- Request: `targetUserId`, `direction` ('like' | 'pass' | 'super_like'), `idempotencyKey`
- Response: `success`, `match: MatchResult | null`, `remainingSwipes`, `nextRefreshAt`

**MatchResult Interface:**
- `matchId`, `matchedUser: ProfileCard`, `matchedAt`

**Match Interface:**
- `id`, `user: ProfileCard`, `matchedAt`, `lastMessage`, `unread`

**Message Interface:**
- `id`, `matchId`, `senderId`, `content`, `readAt`, `createdAt`

**Conversation Interface:**
- `matchId`, `matchedUser`, `messages[]`, `isTyping`

**WebSocketEvent Types:**
- `match` - New match notification with MatchResult
- `new_message` - Incoming message
- `typing` - Typing indicator with matchId, isTyping
- `read_receipt` - Message read confirmation
- `unmatch` - Match removed

**API Response Wrappers:**
- `ApiResponse<T>`: data, meta (cursor, hasMore, total)
- `ApiError`: code, message, details

### Validation Schemas (Zod - Shared)

**swipeRequestSchema:**
- targetUserId: UUID required
- direction: enum ['like', 'pass', 'super_like']
- idempotencyKey: UUID required

**messageSchema:**
- matchId: UUID, content: 1-1000 chars

**profileUpdateSchema:**
- name: 1-100 chars optional
- bio: max 500 nullable optional
- birthDate: YYYY-MM-DD format optional
- gender: enum optional
- preferences: nested object with showMe array, age range 18-100, distance 1-500km

**locationSchema:**
- latitude: -90 to 90, longitude: -180 to 180

---

## 4. End-to-End Swipe Flow (10 minutes)

### Swipe Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           SWIPE FLOW                                          │
└──────────────────────────────────────────────────────────────────────────────┘

User A swipes right on User B:

┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│ Frontend A  │         │   Backend   │         │ Frontend B  │
└──────┬──────┘         └──────┬──────┘         └──────┬──────┘
       │                       │                       │
       │ 1. Optimistic update  │                       │
       │    - Advance deck     │                       │
       │    - Add to pending   │                       │
       │    - Show next card   │                       │
       │                       │                       │
       │ 2. POST /swipes ─────▶│                       │
       │    + idempotencyKey   │                       │
       │                       │                       │
       │                       │ 3. Check idempotency  │
       │                       │    cache (Redis GET)  │
       │                       │                       │
       │                       │ 4. Check rate limit   │
       │                       │    (Redis INCR+TTL)   │
       │                       │                       │
       │                       │ 5. Redis pipeline:    │
       │                       │    - SADD seen set    │
       │                       │    - SADD liked set   │
       │                       │    - SISMEMBER mutual │
       │                       │                       │
       │                       │ 6. If mutual like:    │
       │                       │    - INSERT matches   │
       │                       │    - PUBLISH to both  │
       │                       │                       │
       │ 7. Response ◀─────────│                       │
       │    {success, match}   │                       │
       │                       │                       │
       │ 8. If match:          │ 9. Redis Pub/Sub ────▶│
       │    - Show MatchModal  │    {type: 'match'}    │
       │    - Add to matches   │                       │
       │                       │                       │
       │                       │                       │ 10. WebSocket receives
       │                       │                       │     - Show MatchModal
       ▼                       ▼                       ▼
```

### Frontend: Optimistic Swipe with Rollback

**DiscoveryStore State:**
- `deck: ProfileCard[]` - Cards to display
- `deckIndex: number` - Current position
- `pendingSwipes: Map<string, SwipeRequest>` - In-flight requests
- `failedSwipes: SwipeRequest[]` - Failed for retry

**swipe() Action:**
1. Validate current card matches targetUserId
2. Generate idempotency key (UUID)
3. Optimistic: increment deckIndex, add to pendingSwipes
4. POST /swipes with request data
5. On success: remove from pending, trigger matchStore if match
6. On failure: remove from pending, add to failedSwipes (don't rollback for UX)

**retryFailedSwipes() Action:**
- Triggered on `window.addEventListener('online')`
- Iterates failedSwipes, retries each via API
- Re-adds to failed queue if still failing

### Backend: Swipe Processing with Match Detection

**POST /swipes Route Handler:**
1. Validate with swipeRequestSchema (Zod)
2. Check rate limit via RateLimiter
3. Return 429 if limit reached with remainingSwipes: 0
4. Call SwipeService.processSwipe()
5. Handle IdempotencyConflictError by returning cached result

**SwipeService.processSwipe():**
1. Check idempotency cache - return cached if exists
2. Validate target user exists and is swipeable
3. Execute Redis pipeline:
   - SADD to seen set (24h TTL)
   - SADD to liked set if like/super_like (24h TTL)
   - SISMEMBER check for mutual like
   - ZADD to likes:received for premium feature (7 day TTL)
4. Persist to PostgreSQL asynchronously
5. If mutual like detected: createMatch()
6. Cache idempotency response
7. Return SwipeResponse

**createMatch():**
- Order user IDs for consistent unique constraint
- INSERT with ON CONFLICT DO UPDATE (idempotent)
- Notify both users via Redis PUBLISH to `user:{id}:events`
- Return MatchResult with matchedUser profile

---

## 5. Real-Time Messaging Integration (8 minutes)

### WebSocket Manager (Frontend)

**WebSocketManager Class:**
- `ws: WebSocket | null` - Active connection
- `handlers: Map<string, Set<EventHandler>>` - Event listeners
- `reconnectAttempts` - Counter with max 10
- `messageQueue: string[]` - Queue for offline messages

**connect(token):**
- Create WebSocket with token in query params
- onopen: reset reconnect counter, flush message queue
- onmessage: parse JSON, dispatch to handlers
- onclose: exponential backoff reconnect (max 30s delay)
- onerror: log and handle

**on(type, handler):**
- Register handler for event type
- Return unsubscribe function

**send(message):**
- If connected: send immediately
- If offline: queue for later

**dispatch(event):**
- Call handlers for specific event type
- Also dispatch to 'all' listeners

### Message Store with WebSocket Integration

**MessageState:**
- `conversations: Map<string, Conversation>`
- `activeMatchId: string | null`

**WebSocket Event Subscriptions (on store creation):**
- `new_message`: Add message to conversation, auto-mark read if active
- `typing`: Update conversation.isTyping flag

**loadConversation(matchId):**
- Set activeMatchId
- GET /matches/{matchId}/messages
- Store conversation with matchedUser, messages, isTyping: false

**sendMessage(matchId, content):**
1. Create optimistic message with tempId
2. Add to conversation immediately
3. POST /matches/{matchId}/messages
4. On success: replace temp with real message
5. On failure: mark message with failed: true

**setTyping(matchId, isTyping):**
- Send via WebSocket: { type: 'typing', matchId, isTyping }

### Backend: WebSocket Gateway

**WebSocketGateway Class:**
- `connections: Map<string, WebSocket>` - User connections
- `subscriber: Redis` - Pub/Sub subscriber

**setupPubSub():**
- Subscribe to pattern `user:*:events`
- On message: extract userId from channel, deliver to user

**setupConnectionHandler():**
- Extract token from query params
- Verify session, close with 4001 if invalid
- Store connection, update presence to 'online'
- Handle incoming messages (typing, ping/pong)
- On close: remove connection, set presence 'offline'

**handleTyping(userId, message):**
- Get match, find other user ID
- PUBLISH typing indicator to other user's events channel

**deliverToUser(userId, message):**
- Get WebSocket from connections map
- Send if readyState is OPEN

---

## 6. Discovery Deck Generation (7 minutes)

### Frontend: Discovery with Location

**DiscoveryPage Component:**
1. Request geolocation permission on mount
2. Show LocationPermissionPrompt if denied
3. Load deck with location
4. Prefetch when deck.length - deckIndex < 5

**requestLocation() Helper:**
- navigator.geolocation.getCurrentPosition
- Options: enableHighAccuracy: false, maximumAge: 5 min, timeout: 10s
- Return { latitude, longitude }

**SwipeDeck Component:**
- Render current and next card (slice 2 from index)
- Handle swipe gestures
- Show MatchModal on match response or WebSocket event

### Backend: Multi-Source Candidate Generation

**DiscoveryService.getDeck():**
1. Get user preferences from database
2. Get seen users from Redis set
3. Try Elasticsearch first, fallback to PostGIS

**Elasticsearch Query:**
- **must**: gender in showMe, age in range, is_active, last_active >= now-7d
- **must_not**: self, already-seen users
- **filter**: geo_distance within distanceKm
- **sort**: geo_distance ASC, profile_score DESC, last_active DESC
- Fetch 3x limit for shuffling, return shuffled slice

**PostGIS Fallback Query:**
- CTE for user location point
- JOIN photos for photo array
- WHERE: not self, is_active, gender matches, age range, ST_DWithin distance
- GROUP BY for photo aggregation
- ORDER BY ST_Distance
- Shuffle and slice results

**formatDistance() - Privacy:**
- < 1 km: "Less than 1 mile away"
- < 5 km: "About 2 miles away"
- < 10 km: "About 5 miles away"
- < 25 km: "About 15 miles away"
- < 50 km: "About 30 miles away"
- >= 50 km: "More than 50 miles away"

---

## 7. Error Handling Across the Stack (4 minutes)

### API Error Types

**Base ApiError Class:**
- `code: string` - Machine-readable code
- `message: string` - Human-readable message
- `statusCode: number` - HTTP status (default 400)
- `details?: Record<string, string[]>` - Field-level errors

**Specialized Error Classes:**
- `ValidationError` (400): Zod validation failures with field details
- `NotFoundError` (404): Resource not found with resource name
- `RateLimitError` (429): Rate limit exceeded with resetAt timestamp
- `UnauthorizedError` (401): Authentication required

### Backend Error Handler Middleware

**Error handling logic:**
1. Log error with context (message, stack, path, method)
2. If ApiError: return structured JSON with code/message/details
3. Default: return 500 INTERNAL_ERROR

### Frontend Error Handling

**API Interceptor:**
- On response error:
  - UNAUTHORIZED: redirect to /login
  - RATE_LIMITED: show toast "Too many requests"
  - VALIDATION_ERROR: return for form handling
  - Default: show toast with message
- On network error:
  - Check navigator.onLine
  - Show appropriate offline/connection message
- Always reject promise for caller handling

---

## 8. Summary

This full-stack architecture delivers Tinder's core experience with tight integration:

### Key Integration Points

1. **Shared Types**: TypeScript types used across frontend and backend ensure type safety
2. **Optimistic Updates**: Frontend updates UI immediately, syncs with backend asynchronously
3. **WebSocket Events**: Real-time match and message notifications via Redis Pub/Sub
4. **Idempotency**: Duplicate swipe requests handled gracefully with cached responses
5. **Error Handling**: Consistent error codes and handling across the stack

### Data Flow Patterns

| Action | Frontend | Backend | Real-time |
|--------|----------|---------|-----------|
| Swipe | Optimistic advance | Redis sets + PostgreSQL | Match event via WebSocket |
| Match | Show modal on response/event | Create match, notify both | Pub/Sub to both users |
| Message | Optimistic add | Store in PostgreSQL | Pub/Sub to recipient |
| Typing | Debounced send | Forward via Pub/Sub | Direct to other user |

### Consistency Strategy

- **Redis**: Hot data (swipes, sessions, typing) with 24h TTL
- **PostgreSQL**: Source of truth for users, matches, messages
- **Elasticsearch**: Read-optimized geo index, eventually consistent
- **Frontend**: Optimistic updates with rollback on failure

The architecture prioritizes instant feedback through optimistic updates while maintaining data consistency through idempotency and proper error handling.
