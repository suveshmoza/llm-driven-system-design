# Twitter - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## Opening Statement (1 minute)

"I'll design Twitter, a real-time microblogging platform where users post 280-character tweets that appear in their followers' timelines. The core challenge is the 'fanout problem' - when a user tweets, how do we efficiently notify millions of followers? A celebrity with 50 million followers can't wait 83 minutes for their tweet to propagate.

As a full-stack engineer, I'll focus on how the frontend and backend work together: shared type contracts for type-safe communication, end-to-end tweet creation flow with optimistic updates, hybrid fanout that the client seamlessly merges, and real-time updates that keep timelines fresh."

## Requirements Clarification (3 minutes)

### Functional Requirements
- **Tweet**: Post 280-character messages with optional media
- **Follow**: Subscribe to other users' content
- **Timeline**: View chronological feed of followed users
- **Trending**: See popular topics in real-time
- **Engage**: Like, retweet, reply to tweets

### Non-Functional Requirements
- **Latency**: < 200ms for timeline load, instant UI feedback
- **Availability**: 99.99% uptime
- **Scale**: 500M users, 500M tweets/day
- **Consistency**: Eventual consistency with optimistic UI

### Full-Stack Considerations
1. How does the client handle the celebrity/normal user merge transparently?
2. What's the optimistic update strategy for engagement actions?
3. How do we maintain type safety across the API boundary?

## High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Layer                             │
│              React + Tanstack Router + Zustand                  │
│         Virtualized Timeline + Optimistic Updates               │
└─────────────────────────────────────────────────────────────────┘
                              │
                    REST API + SSE Events
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway / Express                        │
│              Shared Types + Validation (Zod)                    │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ Tweet Service │    │ Timeline Svc  │    │ Social Graph  │
│               │    │               │    │               │
│ - Create tweet│    │ - Build feed  │    │ - Follow/unf  │
│ - Idempotency │    │ - Hybrid merge│    │ - Followers   │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Data Layer                                 │
├─────────────────┬───────────────────────────────────────────────┤
│   PostgreSQL    │    Redis/Valkey                               │
│   - Users       │    - Timeline cache (lists)                   │
│   - Tweets      │    - Social graph cache                       │
│   - Follows     │    - Trend counters                           │
└─────────────────┴───────────────────────────────────────────────┘
```

## Deep Dive: Shared Type System (6 minutes)

Type safety across the API boundary prevents integration bugs and enables confident refactoring.

### Shared Types Package

**Tweet Interface:**
- `id`, `authorId`, `content` (max 280 chars)
- `mediaUrls`, `hashtags`, `mentions`
- `replyTo`, `retweetOf` (nullable references)
- `likeCount`, `retweetCount`, `replyCount`
- `createdAt` (ISO timestamp)
- `author: UserSummary` (denormalized for convenience)
- `viewerHasLiked`, `viewerHasRetweeted` (viewer-specific state)

**UserSummary Interface:**
- `id`, `username`, `displayName`
- `avatarUrl`, `isCelebrity`, `isVerified`

**TimelineResponse Interface:**
- `tweets: Tweet[]`, `cursor: string | null`, `hasMore: boolean`

**CreateTweetRequest/Response:**
- Request: `content`, `mediaUrls?`, `replyTo?`
- Response: `tweet: Tweet`

### Zod Validation (Both Sides)

Shared validation schemas used by both frontend (pre-submit) and backend (request validation):
- `content`: min 1, max 280 characters
- `mediaUrls`: array of URLs, max 4 items
- `replyTo`: optional string

### API Client with Type Safety

Frontend API client provides typed methods:
- `getHomeTimeline(cursor?)` → `TimelineResponse`
- `createTweet(data)` → `CreateTweetResponse` (includes idempotency key)
- `likeTweet(tweetId)` / `unlikeTweet(tweetId)` → `{ success: boolean }`

## Deep Dive: End-to-End Tweet Creation Flow (8 minutes)

This flow demonstrates how frontend and backend collaborate with optimistic updates and idempotency.

### Tweet Creation Flow Diagram

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │     │   Backend   │     │ PostgreSQL  │     │   Redis     │
│   (Zustand) │     │  (Express)  │     │             │     │             │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │                   │
       │ 1. Generate       │                   │                   │
       │    tempId         │                   │                   │
       │    ────────────   │                   │                   │
       │                   │                   │                   │
       │ 2. Optimistic     │                   │                   │
       │    update UI      │                   │                   │
       │    (pending map)  │                   │                   │
       │                   │                   │                   │
       │ 3. POST /tweets ─────────────────────▶│                   │
       │    + Idempotency  │                   │                   │
       │      Key          │                   │                   │
       │                   │ 4. Check cache ───────────────────────▶
       │                   │    for key        │                   │
       │                   │                   │                   │
       │                   │ 5. Validate ──────▶                   │
       │                   │    with Zod       │                   │
       │                   │                   │                   │
       │                   │ 6. INSERT ────────▶                   │
       │                   │    tweet          │                   │
       │                   │                   │                   │
       │                   │ 7. Cache response ────────────────────▶
       │                   │    (24h TTL)      │                   │
       │                   │                   │                   │
       │                   │ 8. Trigger fanout │                   │
       │                   │    (async)        │                   │
       │                   │                   │                   │
       │ 9. Response ◀─────│                   │                   │
       │    { tweet }      │                   │                   │
       │                   │                   │                   │
       │ 10. Replace       │                   │                   │
       │     pending with  │                   │                   │
       │     real tweet    │                   │                   │
       ▼                   ▼                   ▼                   ▼
```

### Frontend: Optimistic Tweet Creation

**TimelineStore Actions:**
1. Generate `tempId` and create pending tweet entry
2. Add to `pendingTweets` Map immediately (optimistic)
3. Call API with idempotency key (UUID)
4. On success: Remove from pending, prepend to tweets array
5. On failure: Mark pending tweet as "failed" (allow retry)

### Backend: Tweet Creation with Idempotency

**Tweet Route Handler Steps:**
1. Check idempotency cache in Redis
2. Validate request with shared Zod schema
3. Extract hashtags (`#\w+`) and mentions (`@\w+`)
4. Insert tweet to PostgreSQL
5. Get author info for response
6. Cache idempotency response (24h TTL)
7. Trigger async fanout (don't block response)
8. Record hashtags for trends
9. Return 201 with tweet data

### ComposeTweet Component

**Features:**
- Character counter with circular progress indicator
- Real-time validation using shared Zod schema
- Keyboard shortcut: Cmd/Ctrl+Enter to submit
- Disabled state when empty, over limit, or submitting
- Error display with retry capability

## Deep Dive: Timeline Merge Strategy (7 minutes)

The hybrid fanout requires the backend to merge cached and celebrity tweets seamlessly.

### Timeline Building Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    GET /timeline/home                           │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┴─────────────────────┐
        ▼                                           ▼
┌───────────────────┐                     ┌───────────────────┐
│ 1. Get Cached IDs │                     │ 2. Get Followed   │
│ from Redis List   │                     │    Celebrities    │
│ timeline:{userId} │                     │    from DB        │
└───────────────────┘                     └───────────────────┘
        │                                           │
        ▼                                           ▼
┌───────────────────┐                     ┌───────────────────┐
│ 3. Fetch tweet    │                     │ 4. Pull recent    │
│    details from   │                     │    celebrity      │
│    PostgreSQL     │                     │    tweets (24h)   │
└───────────────────┘                     └───────────────────┘
        │                                           │
        └─────────────────────┬─────────────────────┘
                              ▼
                ┌───────────────────────┐
                │ 5. Merge, deduplicate │
                │    sort by timestamp  │
                │    slice to limit     │
                └───────────────────────┘
                              │
                              ▼
                ┌───────────────────────┐
                │ 6. Return with cursor │
                │    for pagination     │
                └───────────────────────┘
```

### Backend: Timeline Query Details

**Cached tweets query includes:**
- Tweet content and metadata
- Author info (username, display_name, avatar_url, is_celebrity)
- Viewer-specific state via EXISTS subqueries:
  - `viewer_has_liked`
  - `viewer_has_retweeted`

**Celebrity tweets query:**
- Filters: author_id IN celebrity list, not deleted, last 24 hours
- Ordered by created_at DESC
- Limited to 50 per request

### Frontend: Virtualized Timeline with Infinite Scroll

**Virtualization with @tanstack/react-virtual:**
- Only renders visible items plus overscan (5 items)
- Dynamic height measurement via `measureElement`
- Estimated row height: 150px
- Infinite scroll: triggers `onLoadMore` when reaching end

**Combined display:**
- Pending tweets (from optimistic updates) shown first
- Confirmed tweets from API follow
- Failed tweets show retry option

## Deep Dive: Engagement Actions (5 minutes)

Like and retweet actions demonstrate optimistic updates with rollback on failure.

### Optimistic Like Flow

```
┌─────────────┐         ┌─────────────┐
│   Frontend  │         │   Backend   │
│   (Store)   │         │  (Express)  │
└──────┬──────┘         └──────┬──────┘
       │                       │
       │ 1. Toggle local       │
       │    state immediately  │
       │    ────────────       │
       │                       │
       │ 2. POST/DELETE ──────▶│
       │    /tweets/:id/like   │
       │                       │
       │                       │ 3. UPSERT/DELETE
       │                       │    likes table
       │                       │
       │ 4. Success ◀──────────│
       │    (no rollback)      │
       │                       │
       │    OR                 │
       │                       │
       │ 4. Failure ◀──────────│
       │    → Rollback state   │
       ▼                       ▼
```

### Backend: Like with Idempotency

**POST /tweets/:id/like:**
- Uses INSERT...ON CONFLICT DO NOTHING
- Idempotent by design (primary key constraint)
- Returns `{ success: true }`

**DELETE /tweets/:id/like:**
- Simple DELETE by user_id and tweet_id
- Safe to call multiple times

### TweetCard with Actions

**ActionButton component:**
- Reply, Retweet, Like, Share icons
- Count display with formatCount (1K, 1M abbreviations)
- Color states: inactive (gray), active (green for RT, pink for like)
- Hover effects with transition colors

## Error Handling Strategy (4 minutes)

### Shared Error Types

**ApiErrorResponse interface:**
- `error: string` - Human readable message
- `code: string` - Machine readable code
- `details?: Record<string, string[]>` - Field-level errors

**Common error codes:**
- `VALIDATION_ERROR` - Zod validation failed
- `DUPLICATE` - Resource already exists
- `NOT_FOUND` - Referenced resource missing
- `INTERNAL_ERROR` - Server error

### Backend Error Middleware

Handles specific error types:
1. ZodError → 400 with field errors
2. Duplicate key → 409 Conflict
3. Foreign key violation → 404 Not Found
4. Default → 500 Internal Server Error

### Frontend Error Boundary

Class component that:
- Catches React errors via `getDerivedStateFromError`
- Logs to console (could send to error tracking)
- Shows fallback UI with refresh button
- Supports custom fallback prop

## Database Schema with Triggers (3 minutes)

### Key Tables

**users table:**
- id, username, email, password_hash
- display_name, avatar_url
- follower_count, following_count, tweet_count (denormalized)
- is_celebrity (auto-set when follower_count >= 10000)
- created_at

**tweets table:**
- id (BIGSERIAL), author_id (FK)
- content (VARCHAR 280), media_urls, hashtags, mentions
- reply_to, retweet_of (self-references)
- like_count, retweet_count, reply_count (denormalized)
- deleted_at (soft delete), created_at

### Database Triggers

**update_follow_counts():**
- On INSERT: Increment follower_count, check celebrity threshold
- On DELETE: Decrement follower_count, update celebrity flag

**update_like_count():**
- On INSERT: Increment tweet's like_count
- On DELETE: Decrement tweet's like_count

## Trade-offs and Alternatives (3 minutes)

### 1. Shared Types Package vs. Code Generation

| Approach | Pros | Cons |
|----------|------|------|
| **Shared TypeScript (chosen)** | Simple, no build step, full control | Manual sync required |
| OpenAPI/GraphQL codegen | Automated sync, generated docs | More complexity, build step |

### 2. Optimistic Updates vs. Server Confirmation

| Approach | Pros | Cons |
|----------|------|------|
| **Optimistic with rollback (chosen)** | Instant UI feedback, better UX | Complex rollback handling |
| Wait for server | Simpler implementation | Feels slower to user |

### 3. REST vs. GraphQL

| Approach | Pros | Cons |
|----------|------|------|
| **REST with typed responses (chosen)** | Simple caching, good for Twitter's patterns | Multiple requests for related data |
| GraphQL | Flexible queries, no overfetching | Cache complexity |

### 4. Zod vs. io-ts/Yup

| Approach | Pros | Cons |
|----------|------|------|
| **Zod (chosen)** | Great TS inference, single definition | Bundle size |
| io-ts | More functional style | Steeper learning curve |
| Yup | More established ecosystem | Less TS integration |

## Closing Summary (1 minute)

"Twitter's full-stack architecture solves the fanout problem through coordinated frontend and backend design:

1. **Shared type contracts** - TypeScript interfaces and Zod schemas ensure type safety across the API boundary, preventing integration bugs and enabling confident refactoring.

2. **Optimistic updates with idempotency** - The frontend immediately updates UI state for all user actions, while the backend uses idempotency keys to safely handle retries without duplicates.

3. **Transparent timeline merging** - The hybrid fanout (push for normal users, pull for celebrities) is completely hidden from the frontend. The API returns a unified, sorted timeline that the client simply renders.

4. **Virtualized rendering** - The timeline uses @tanstack/react-virtual to efficiently render thousands of tweets, only creating DOM nodes for visible items.

The main trade-off is development complexity vs. user experience. We chose optimistic updates and complex merging because users expect instant feedback and seamless timelines. Future improvements would include real-time SSE for new tweets and GraphQL for more flexible data fetching."
