# Twitch - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## 1. Requirements Clarification (3 minutes)

### Functional Requirements
- **Live streaming**: Streamers broadcast via RTMP, viewers watch via HLS
- **Real-time chat**: WebSocket-based chat with emotes, badges, moderation
- **Channel management**: Stream keys, go live/offline, viewer counts
- **Follow/Subscribe**: Social features with real-time notifications
- **Creator dashboard**: Stream management, chat settings, analytics

### Non-Functional Requirements
- **Low latency**: 2-5 second glass-to-glass for video, <100ms for chat
- **High availability**: 99.9% uptime for live streams
- **Scalability**: Support 100K+ concurrent viewers per channel
- **Consistency**: Chat messages delivered exactly once, in order

### Full-Stack Focus Areas
1. Shared TypeScript types for type safety across layers
2. End-to-end data flow from streamer to viewer
3. Real-time synchronization between frontend and backend
4. Error handling and recovery at every layer

---

## 2. High-Level Architecture (5 minutes)

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           FRONTEND                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ VideoPlayer │  │  ChatPanel  │  │ BrowsePage  │  │  Dashboard  │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
│         │                │                │                │         │
│         │    HLS         │  WebSocket     │    REST        │  REST   │
└─────────┼────────────────┼────────────────┼────────────────┼─────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                            BACKEND                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │  CDN/HLS    │  │ Chat Pods   │  │  API Server │  │ Admin APIs  │ │
│  │  Segments   │  │ (WebSocket) │  │   (REST)    │  │   (REST)    │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
│         │                │                │                │         │
│         │                │     Redis Pub/Sub               │         │
│         │                └────────┬───────┘                │         │
│         │                         │                        │         │
│  ┌──────┴──────┐  ┌───────────────┴───────────────┐       │         │
│  │   S3/Minio  │  │           PostgreSQL          │◀──────┘         │
│  │  (Segments) │  │  (Users, Channels, Messages)  │                 │
│  └─────────────┘  └───────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────────┘
```

### Shared Type Definitions

| Domain | Key Types |
|--------|-----------|
| User/Auth | User (id, username, displayName, avatarUrl), Session |
| Channel/Stream | Channel (id, name, title, isLive, viewerCount), StreamStatus |
| Chat | ChatMessage (content, badges, emotes, color), ChatSettings |
| WebSocket | WSClientMessage (join/leave/message), WSServerMessage (message/banned/deleted) |
| API | ApiResponse<T> with success/data/error structure |
| Social | Follow, Subscription (tier 1/2/3, isGift) |

---

## 3. Chat System - End to End (10 minutes)

### Backend: WebSocket Server with Redis Pub/Sub

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Chat Server Architecture                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐     ┌──────────────────┐                      │
│  │   Chat Pod 1     │     │   Chat Pod 2     │                      │
│  │ ┌──────────────┐ │     │ ┌──────────────┐ │                      │
│  │ │ WebSocket    │ │     │ │ WebSocket    │ │                      │
│  │ │ Connections  │ │     │ │ Connections  │ │                      │
│  │ └──────┬───────┘ │     │ └──────┬───────┘ │                      │
│  │        │         │     │        │         │                      │
│  │ ┌──────▼───────┐ │     │ ┌──────▼───────┐ │                      │
│  │ │ Channel Rooms│ │     │ │ Channel Rooms│ │                      │
│  │ └──────┬───────┘ │     │ └──────┬───────┘ │                      │
│  └────────┼─────────┘     └────────┼─────────┘                      │
│           │                        │                                 │
│           └───────────┬────────────┘                                 │
│                       ▼                                              │
│           ┌───────────────────────┐                                 │
│           │     Redis Pub/Sub     │                                 │
│           │  Pattern: chat:*      │                                 │
│           └───────────────────────┘                                 │
│                       │                                              │
│                       ▼                                              │
│           ┌───────────────────────┐                                 │
│           │     PostgreSQL        │                                 │
│           │  (Message Storage)    │                                 │
│           └───────────────────────┘                                 │
└─────────────────────────────────────────────────────────────────────┘
```

**Connection Tracking:**
- `channelConnections`: Map<channelId, Set<WebSocket>>
- `userChannels`: Map<WebSocket, channelId>

**Message Flow:**

1. **Client sends message** with idempotencyKey
2. **Deduplication check** via Redis SET (5-min TTL)
3. **Rate limiting** based on channel slow mode settings
4. **Channel settings check** (subscriber-only, follower-only, etc.)
5. **Emote parsing** to extract positions
6. **Badge lookup** for user in channel
7. **Build ChatMessage** with all metadata
8. **Async DB storage** (non-blocking)
9. **Publish to Redis** `chat:{channelId}` channel
10. **All pods receive** and broadcast to local connections

**Rate Limiting Logic:**

| User Type | Default Cooldown | Slow Mode |
|-----------|------------------|-----------|
| Normal | 1 second | Configurable (5s, 30s, etc.) |
| Subscriber | 0.5 seconds | Half of slow mode |
| Moderator | No limit | No limit |

### Frontend: Chat Integration

```
┌─────────────────────────────────────────────────────────────────────┐
│                       useChat Hook Flow                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐  │
│  │   Connect   │───▶│   onopen    │───▶│ Send JOIN for channelId │  │
│  └─────────────┘    └─────────────┘    └─────────────────────────┘  │
│                                                                      │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐  │
│  │  onmessage  │───▶│ Parse JSON  │───▶│ handleServerMessage()   │  │
│  └─────────────┘    └─────────────┘    └─────────────────────────┘  │
│                                                                      │
│  ┌─────────────┐    ┌─────────────────────────────────────────────┐ │
│  │   onclose   │───▶│ Reconnect with exponential backoff          │ │
│  └─────────────┘    │ (1s, 2s, 4s, ... max 30s)                   │ │
│                     └─────────────────────────────────────────────┘ │
│                                                                      │
│  Pending Messages Map:                                               │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ idempotencyKey -> { content, timestamp }                     │    │
│  │ - Retry on reconnect                                         │    │
│  │ - Clear after 30 seconds                                     │    │
│  │ - Remove when server confirms                                │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Zustand Store for Chat State

| State | Description |
|-------|-------------|
| messages | ChatMessage[] (max 500, FIFO) |
| connectionStatus | 'connecting' / 'connected' / 'disconnected' |
| slowMode | Seconds between messages |
| cooldownRemaining | Countdown timer for next allowed message |
| viewerCount | Current channel viewers |
| settings | ChatSettings (slow mode, sub-only, etc.) |

**Actions:**
- `addMessage`: Append and trim to MAX_MESSAGES
- `setConnectionStatus`: Update connection state
- `setCooldown`: Start countdown timer
- `clearMessages`: Reset on channel change

---

## 4. Stream Lifecycle - End to End (10 minutes)

### Backend: Stream Management API

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Stream Status Flow                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  GET /channels/:channelId/status                                    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ 1. Check Redis cache (10s TTL)                              │    │
│  │ 2. If miss, query PostgreSQL                                │    │
│  │ 3. Return StreamStatus { isLive, viewerCount, peakViewers } │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  POST /channels/:channelId/go-live                                  │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ 1. Acquire distributed lock (Redis SET NX, 30s TTL)         │    │
│  │ 2. Check if already live (reject if yes)                    │    │
│  │ 3. Update DB: is_live=true, started_at=NOW()                │    │
│  │ 4. Invalidate cache                                         │    │
│  │ 5. Publish stream_online event                              │    │
│  │ 6. Release lock                                             │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  POST /channels/:channelId/go-offline                               │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ 1. Update DB: is_live=false, ended_at=NOW()                 │    │
│  │ 2. Invalidate cache                                         │    │
│  │ 3. Publish stream_offline event                             │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  POST /internal/viewer-count (called by chat servers)               │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ 1. Update DB: viewer_count, peak_viewers=GREATEST()         │    │
│  │ 2. Broadcast to viewers via Redis pub/sub                   │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Frontend: Stream Page Integration

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Channel Page Layout                           │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────┬──────────────────┐ │
│  │                 Main Content                 │   Chat Sidebar   │ │
│  │  ┌─────────────────────────────────────┐    │ ┌──────────────┐ │ │
│  │  │                                     │    │ │   Messages   │ │ │
│  │  │         Video Player                │    │ │   ────────   │ │ │
│  │  │     (HLS if live, Offline UI)       │    │ │   user1: hi  │ │ │
│  │  │                                     │    │ │   user2: lol │ │ │
│  │  └─────────────────────────────────────┘    │ │   ...        │ │ │
│  │  ┌─────────────────────────────────────┐    │ ├──────────────┤ │ │
│  │  │         Channel Info                │    │ │ [Input box]  │ │ │
│  │  │  StreamerName | Category | Viewers  │    │ └──────────────┘ │ │
│  │  └─────────────────────────────────────┘    │                  │ │
│  └─────────────────────────────────────────────┴──────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

**Data Fetching Strategy:**

| Data | Method | Interval |
|------|--------|----------|
| Channel info | useQuery | Once on mount |
| Stream status | useQuery | Poll every 30s |
| Chat messages | WebSocket | Real-time |
| Viewer count | WebSocket | Real-time |

**Offline Screen:**
- Show channel avatar and name
- "Check back later" message
- Follow button for notifications

### API Client with Type Safety

Centralized API client with:
- Bearer token injection from localStorage
- Consistent error handling with typed ApiError
- Methods for all endpoints returning typed responses:

| Method | Endpoint | Return Type |
|--------|----------|-------------|
| getChannel | GET /api/channels/:name | Channel |
| getStreamStatus | GET /api/channels/:id/status | StreamStatus |
| goLive | POST /api/channels/:id/go-live | { channelId, isLive } |
| goOffline | POST /api/channels/:id/go-offline | void |
| followChannel | POST /api/follows/:id | Follow |
| subscribe | POST /api/subscriptions/:id | Subscription |

---

## 5. Subscription Flow with Idempotency (5 minutes)

### Backend: Idempotent Subscription Handler

```
┌─────────────────────────────────────────────────────────────────────┐
│              Subscription Creation Flow                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Request: POST /subscriptions/:channelId                            │
│  Body: { tier: 1|2|3, idempotencyKey: string }                      │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ 1. Check idempotency key in Redis                           │    │
│  │    └─▶ If found: return cached response                     │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                       │                                              │
│                       ▼ (key not found)                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ 2. BEGIN transaction                                        │    │
│  │ 3. Check for existing active subscription                   │    │
│  │    └─▶ If exists: ROLLBACK, return ALREADY_SUBSCRIBED       │    │
│  │ 4. INSERT subscription (1 month duration)                   │    │
│  │ 5. COMMIT                                                   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                       │                                              │
│                       ▼                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ 6. Cache response with idempotency key (24h TTL)            │    │
│  │ 7. Publish new_subscriber event to chat channel             │    │
│  │ 8. Return subscription object                               │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Frontend: Subscribe Modal

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Subscribe Modal                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│                Subscribe to StreamerName                             │
│                                                                      │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐              │
│  │    Tier 1     │ │    Tier 2     │ │    Tier 3     │              │
│  │   $4.99/mo    │ │   $9.99/mo    │ │  $24.99/mo    │              │
│  │   5 emotes    │ │  10 emotes    │ │  20 emotes    │              │
│  │   [selected]  │ │               │ │               │              │
│  └───────────────┘ └───────────────┘ └───────────────┘              │
│                                                                      │
│                    [Cancel]  [Subscribe - $4.99]                     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Idempotency Key Generation:**
- Format: `sub-{channelId}-{timestamp}-{random}`
- Generated client-side before mutation
- Sent in both body and header
- Enables safe retry on network failure

**Mutation Handling:**
- On success: invalidate subscription queries, close modal
- On ALREADY_SUBSCRIBED: refresh subscription status (idempotent)

---

## 6. Error Handling Strategy (4 minutes)

### Backend: Centralized Error Handler

**AppError Class:**
- statusCode (HTTP status)
- code (machine-readable string)
- message (human-readable)

**Error Mapping:**

| Error Type | Status | Code | Message |
|------------|--------|------|---------|
| AppError | Varies | Custom | Custom |
| PostgreSQL 23505 | 409 | DUPLICATE | "Resource already exists" |
| Unknown | 500 | INTERNAL_ERROR | "An unexpected error occurred" |

### Frontend: Error Boundary and Retry

**ErrorBoundary Component:**
- Catches render errors
- Shows fallback UI with "Try again" button
- Logs error info for debugging

**Query Retry Configuration:**

| Condition | Retry? | Max Attempts |
|-----------|--------|--------------|
| 4xx errors | No | 0 |
| 5xx errors | Yes | 3 |
| Network errors | Yes | 3 |

Retry delay: Exponential backoff (1s, 2s, 4s, max 30s)

---

## 7. Summary (3 minutes)

### Full-Stack Integration Points

| Feature | Frontend | Backend | Shared |
|---------|----------|---------|--------|
| Chat | WebSocket hook, virtualized list | WebSocket server, Redis pub/sub | Message types, badge types |
| Stream Status | Polling + real-time updates | REST API + Redis cache | StreamStatus type |
| Subscriptions | Modal with idempotency key | Transactional handler | Subscription type |
| Error Handling | Error boundaries, retry logic | Centralized error handler | Error response format |

### Type Safety Wins

1. **Shared types** prevent API contract mismatches
2. **Discriminated unions** for WebSocket messages ensure exhaustive handling
3. **ApiResponse wrapper** provides consistent error handling

### Key Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| WebSocket per channel | Single connection + room joins | Simpler than connection-per-channel |
| Idempotency keys | Client-generated | Enables safe retries for subscriptions |
| Viewer count | Redis + polling | Real-time updates without per-viewer writes |
| Chat storage | Async write | Don't block message delivery on DB |

### What Would Be Different at Scale

1. **Type Generation**: Use OpenAPI/gRPC for automatic type generation
2. **Message Queues**: Kafka between chat pods for guaranteed delivery
3. **State Sync**: CRDT-based state for offline-first mobile apps
4. **Monitoring**: End-to-end tracing with OpenTelemetry
