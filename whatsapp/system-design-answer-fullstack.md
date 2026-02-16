# WhatsApp - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## 🎯 Opening Statement

"I'll design a real-time messaging platform like WhatsApp, covering the full stack from the React frontend through the Node.js backend and into the data layer. The core full-stack challenges are: building a typed WebSocket protocol that both sides share, implementing optimistic UI with server-side persistence and cross-server routing, designing an offline-first architecture with IndexedDB on the client and pending-message delivery on the server, and making delivery receipts flow reliably from recipient back to sender across multiple servers. Let me start with requirements."

---

## 📋 Requirements Clarification (3 minutes)

### Functional Requirements

1. **Real-time 1:1 and group messaging** with sub-100ms delivery when both parties are online
2. **Delivery receipts** — sent, delivered, read — synchronized back to the sender's UI
3. **Typing indicators** with debounced emission and auto-expiry
4. **Offline support** — client queues outbound messages, server queues inbound; full sync on reconnect
5. **Presence** — online/offline status and last-seen timestamps

### Non-Functional Requirements

| Requirement | Target | Stack Responsibility |
|-------------|--------|----------------------|
| Message latency | < 100ms online-to-online | Backend: Redis pub/sub routing. Frontend: WebSocket + optimistic UI |
| Offline capability | Full read access, queued writes | Backend: PostgreSQL pending queue. Frontend: IndexedDB cache + send queue |
| Delivery guarantee | At-least-once, idempotent | Backend: persist-before-route + ACK protocol. Frontend: client-generated UUIDs for dedup |
| Concurrent connections | 500 per server instance | Backend: multiple Express+WS instances. Frontend: virtualized message lists |
| Type safety | Shared contract | Shared TypeScript types used by both frontend and backend |

---

## 🏗️ Full-Stack Architecture (5 minutes)

```
┌────────────────────────────────────────────────────────────────────────┐
│                         Frontend (React + Zustand)                      │
│                                                                         │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐       │
│  │ WebSocket  │  │  Zustand   │  │ IndexedDB  │  │ Virtualized│       │
│  │  Provider  │◄─┤   Store    │◄─┤  (Dexie)   │  │  Lists     │       │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └────────────┘       │
│        │               │               │                                │
└────────┼───────────────┼───────────────┼────────────────────────────────┘
         │ ws://          │ HTTP/REST     │
         │               │               │
         ▼               ▼               │
┌────────────────────────────────────────────────────────────────────────┐
│                    Load Balancer (nginx, sticky sessions)               │
└───────────────────────────┬────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Server 1    │   │  Server 2    │   │  Server 3    │
│  Express+WS  │◄──┤ Redis Pub/Sub├──►│  Express+WS  │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
           ┌──────────────┼──────────────┐
           ▼              ▼              ▼
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │  PostgreSQL  │ │ Redis/Valkey │ │    MinIO      │
   │              │ │              │ │              │
   │ users        │ │ sessions     │ │ images       │
   │ conversations│ │ presence     │ │ videos       │
   │ messages     │ │ user→server  │ │ documents    │
   │ msg_status   │ │ typing TTLs  │ │              │
   └──────────────┘ └──────────────┘ └──────────────┘
```

> "The frontend owns the user experience — optimistic updates, offline queueing, virtualized rendering. The backend owns durability — persist before routing, cross-server pub/sub, idempotent status updates. Shared TypeScript types act as the contract between the two layers."

---

## 🔌 WebSocket Protocol Design (3 minutes)

Rather than ad-hoc JSON, we define a typed message protocol shared by both client and server. Every event has a discriminated `type` field that both sides switch on.

### Client to Server Events

| Type | Payload Fields | Purpose |
|------|---------------|---------|
| `message` | conversationId, content, contentType, clientMessageId, mediaUrl?, replyToId? | Send a new message with client-generated UUID |
| `typing` | conversationId | Signal that user is composing |
| `ack` | messageId | Confirm receipt of a delivered message |
| `read` | conversationId, upToMessageId | Mark all messages up to this one as read |

### Server to Client Events

| Type | Payload Fields | Purpose |
|------|---------------|---------|
| `message` | Full message object with server-assigned id and createdAt | Deliver incoming message |
| `message_status` | messageId, status (sent/delivered/read), userId | Notify sender of status progression |
| `typing` | conversationId, userId, username, isTyping | Broadcast typing state to conversation |
| `presence` | userId, status (online/offline), lastSeen | Presence change notification |
| `error` | code, message | Validation or authorization errors |

> "Both sides validate against the same schema. The frontend uses discriminated unions to narrow the type in its message handler; the backend validates with Zod before routing to the appropriate handler. This eliminates an entire class of protocol mismatch bugs."

---

## 🔍 Deep Dive 1: End-to-End Message Flow (10 minutes)

This is the most important flow — tracing a single message from the sender's keystroke to the recipient seeing it and the sender seeing blue checkmarks.

### Sequence Diagram

```
  Sender Frontend         Server A            Redis           Server B         Recipient Frontend
       │                     │                  │                 │                    │
       │─── 1. Generate ────►│                  │                 │                    │
       │    clientMessageId  │                  │                 │                    │
       │    optimistic add   │                  │                 │                    │
       │    to Zustand store │                  │                 │                    │
       │                     │                  │                 │                    │
       │── 2. WS: message ──►│                  │                 │                    │
       │                     │                  │                 │                    │
       │                     │── 3. SETNX ─────►│                 │                    │
       │                     │   dedup:clientId  │                 │                    │
       │                     │◄── OK (new) ─────│                 │                    │
       │                     │                  │                 │                    │
       │                     │── 4. INSERT ─────────────────────────────►              │
       │                     │   message + status rows           (PostgreSQL)          │
       │                     │                  │                 │                    │
       │                     │── 5. GET ───────►│                 │                    │
       │                     │   session:recipientId              │                    │
       │                     │◄── server_b ────│                 │                    │
       │                     │                  │                 │                    │
       │                     │── 6. PUBLISH ───►│                 │                    │
       │                     │   server:B       │── deliver ─────►│                    │
       │                     │                  │                 │                    │
       │                     │                  │                 │── 7. WS: message ─►│
       │                     │                  │                 │                    │
       │                     │                  │                 │                    │── 8. Dedup by
       │                     │                  │                 │                    │   messageId,
       │                     │                  │                 │                    │   add to store
       │                     │                  │                 │                    │
       │                     │                  │                 │◄─ 9. WS: ack ─────│
       │                     │                  │                 │                    │
       │                     │                  │                 │── 10. UPDATE ──────────────►
       │                     │                  │                 │   status='delivered'  (PostgreSQL)
       │                     │                  │                 │                    │
       │                     │◄─ 11. PUBLISH ──│◄── server:A ───│                    │
       │                     │   message_status │                 │                    │
       │                     │                  │                 │                    │
       │◄ 12. WS: status ───│                  │                 │                    │
       │   (delivered)       │                  │                 │                    │
       │                     │                  │                 │                    │
       │── 13. Update UI ───►│                  │                 │                    │
       │   double grey       │                  │                 │                    │
       │   checkmarks        │                  │                 │                    │
```

### Frontend: Sending Side

1. User presses send. The hook generates a `clientMessageId` via `crypto.randomUUID()` — this is the idempotency key.
2. An optimistic message is added to the Zustand store with `status: 'sending'` and rendered immediately. The UI feels instant.
3. If the WebSocket is disconnected, the message is queued to IndexedDB's `pendingMessages` table with `status: 'pending'` and `retryCount: 0`. It will be sent when the socket reconnects.
4. If connected, the message is sent as a `type: 'message'` WebSocket event.

### Backend: Processing

1. **Validate participation** — query `conversation_participants` to confirm the sender belongs to this conversation. Reject otherwise.
2. **Idempotency check** — `SETNX dedup:{clientMessageId}` with 24h TTL. If the key already exists, return the cached server message. This handles retries from the client or network duplication.
3. **Persist** — INSERT into `messages` table, then INSERT `message_status` rows for every other participant with `status: 'sent'`.
4. **Route** — for each recipient, look up `session:{userId}` in Redis. If the recipient is on the same server, deliver directly via the in-memory WebSocket map. If on a different server, PUBLISH to `server:{serverId}` Redis channel. If no session exists, the message stays in PostgreSQL with 'sent' status until the user reconnects.

### Frontend: Receiving Side

1. The WebSocket provider's message handler receives a `type: 'message'` event. It checks whether `messageId` already exists in the Zustand store (deduplication). If new, it adds the message and caches it to IndexedDB.
2. It immediately sends a `type: 'ack'` event back, which triggers the backend to update `message_status` to 'delivered' and notify the original sender.
3. The sender's UI updates from a single grey checkmark to double grey checkmarks.

> "The critical insight is persist-before-route. We never send a message via Redis pub/sub until it exists in PostgreSQL. If the pub/sub publish fails, the message is still durable and will be delivered when the recipient reconnects. This gives us at-least-once delivery without a dedicated message queue."

---

## 🔍 Deep Dive 2: Offline Sync Architecture (8 minutes)

Offline support must work on both sides of the stack — the client must queue outbound messages and cache inbound ones, while the server must deliver pending messages on reconnect.

### Reconnection Sync Flow

```
  Reconnecting Client              Server                     PostgreSQL
       │                              │                            │
       │── 1. WS: connect ──────────►│                            │
       │   (session cookie)           │                            │
       │                              │                            │
       │                              │── 2. SET session:userId ──►│
       │                              │   to this server's ID     (Redis)
       │                              │                            │
       │                              │── 3. SET presence:userId ─►│
       │                              │   status='online'         (Redis)
       │                              │                            │
       │                              │── 4. SELECT messages ─────►│
       │                              │   JOIN message_status      │
       │                              │   WHERE recipient_id = ?   │
       │                              │   AND status = 'sent'      │
       │                              │◄── pending messages ───────│
       │                              │                            │
       │◄── 5. WS: message[] ────────│                            │
       │   (batch of pending msgs)    │                            │
       │                              │                            │
       │── 6. WS: ack (per msg) ────►│                            │
       │                              │── 7. UPDATE status ───────►│
       │                              │   = 'delivered'            │
       │                              │                            │
       │── 8. Flush IndexedDB ───────►│                            │
       │   pending queue              │                            │
       │                              │                            │
       │── 9. WS: message ──────────►│                            │
       │   (queued while offline)     │── 10. Normal flow ────────►│
```

### Frontend: Offline Queue (IndexedDB via Dexie)

The IndexedDB schema stores four tables: `pendingMessages` (outbound queue), `messages` (cached received messages), `conversations` (cached metadata), and `syncMetadata` (per-conversation sync timestamps).

**When the socket disconnects:**
- The WebSocket provider sets a `connected: false` flag in the Zustand store.
- Any new outbound message goes to IndexedDB's `pendingMessages` table with `status: 'pending'` instead of the socket.
- The UI renders from the cached `messages` table. The user can read all previously loaded conversations without any network.

**When the socket reconnects:**
1. Query `pendingMessages` where `status = 'pending'`, ordered by `createdAt`.
2. For each message: set `status` to `'sending'`, send via WebSocket, delete from IndexedDB on success.
3. If a send fails and `retryCount >= 3`, mark as `'failed'` so the UI shows a retry button.
4. For each conversation, fetch from the server: `GET /api/v1/conversations/{id}/messages?since={lastSyncAt}`.
5. Merge server messages with the local cache, update `syncMetadata` with the current timestamp.

### Backend: Pending Delivery on Connect

When a user's WebSocket connection is established:

1. Register the session in Redis: `SET session:{userId}` to this server's ID.
2. Update presence: `HSET presence:{userId}` with `status=online`, `server=SERVER_ID`, `lastSeen=now`.
3. Store the WebSocket reference in the in-memory connections map.
4. Query PostgreSQL for all messages where `message_status.recipient_id = userId AND status = 'sent'`, ordered by `created_at ASC`.
5. Send each pending message over the new WebSocket connection.
6. Broadcast a presence change to users who share conversations with this user.

When a user disconnects, the mirror operation: delete session from Redis, set presence to offline with `lastSeen`, remove from connections map, broadcast presence change.

### Trade-off: IndexedDB vs LocalStorage

| Approach | Pros | Cons |
|----------|------|------|
| ✅ IndexedDB (Dexie) | Async, structured queries, 50MB+ capacity, indexes | More complex API, browser differences |
| ❌ LocalStorage | Simpler API, synchronous | 5MB limit, blocks main thread, no indexing |

> "LocalStorage's 5MB limit means we could store roughly 10,000 messages before hitting the wall — one active group chat could exhaust that in a week. IndexedDB gives us structured queries with indexes on conversationId and createdAt, so fetching cached messages for a specific conversation is an indexed lookup rather than scanning all stored messages. The async API also avoids blocking the main thread during writes, which matters when we're bulk-caching 50 messages on reconnect."

---

## 🔍 Deep Dive 3: Delivery Receipts and Read Status (6 minutes)

Status progression is the most visible full-stack feature — users watch their checkmarks change in real time. The flow must be idempotent, forward-only, and efficient for batch reads.

### Status Progression

```
  sending ──► sent ──► delivered ──► read
  (client)    (server    (recipient    (recipient
   only)      persisted)  ACKed)       scrolled
                                       to message)
```

Each transition is forward-only. The backend enforces this with a conditional UPDATE: only change status if the current status has a lower ordinal than the new one. This means duplicate ACKs, retried read receipts, or out-of-order pub/sub messages are safely ignored.

### Read Receipt: Full-Stack Flow

**Frontend — detecting reads with IntersectionObserver:**

1. Each message element in the virtualized list registers with an IntersectionObserver (threshold 0.5 — at least half visible).
2. When a message enters the viewport, its ID is collected into a buffer.
3. A 500ms debounce timer fires, finding the latest message ID in the buffer.
4. A `type: 'read'` event is sent with `conversationId` and `upToMessageId`.
5. A `lastSentReadReceipt` ref prevents sending the same read position twice.

**Backend — batch status update:**

1. Look up the `created_at` timestamp of the `upToMessageId`.
2. Batch UPDATE: set `status = 'read'` on all rows in `message_status` where `conversation_id` matches, `recipient_id` matches, `created_at <= upToTimestamp`, and current status is not already 'read'.
3. Update `conversation_participants.last_read_at` for this user.
4. Group the updated message IDs by `sender_id`.
5. Route a `message_status` notification to each distinct sender via the same Redis pub/sub routing logic.

**Frontend — displaying status on sender side:**

The Zustand store updates the message's status field. The UI renders:
- Single grey checkmark for 'sent'
- Double grey checkmarks for 'delivered'
- Double blue checkmarks for 'read'

For group messages, status reflects the *minimum* across all recipients — 'delivered' only when all members have ACKed, 'read' only when all have read.

### Batching Matters

> "Without batch reads, opening a conversation with 200 unread messages would fire 200 individual status updates. By using `upToMessageId`, a single WebSocket event and a single UPDATE query marks all 200 messages as read. The IntersectionObserver debounce ensures we send at most 2 read events per second regardless of scroll speed."

---

## 💾 Data Model (3 minutes)

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **users** | id (UUID PK), username (unique), email (unique), password_hash, display_name, avatar_url | username, email | Standard user table |
| **conversations** | id (UUID PK), type (direct/group), name, created_by (FK users) | type | Name is null for direct chats |
| **conversation_participants** | conversation_id + user_id (composite PK), role (admin/member), last_read_at | (conversation_id, user_id) | Tracks read position per user |
| **messages** | id (UUID PK), conversation_id (FK), sender_id (FK), content, content_type, media_url, reply_to_id, created_at | (conversation_id, created_at DESC), (sender_id, created_at DESC) | Paginated by conversation + time |
| **message_status** | message_id + recipient_id (composite PK), status (sent/delivered/read), updated_at | (recipient_id, status) | One row per recipient per message |

### Redis Keys

| Key Pattern | Type | TTL | Purpose |
|-------------|------|-----|---------|
| `session:{userId}` | String (server ID) | 24h | Which server holds this user's WebSocket |
| `presence:{userId}` | Hash (status, server, lastSeen) | None (manual delete) | Online/offline tracking |
| `typing:{convId}:{userId}` | String | 3s | Auto-expiring typing indicator |
| `dedup:{clientMessageId}` | String | 24h | Idempotency guard for message sends |
| `server:{serverId}` | Pub/Sub channel | N/A | Cross-server message routing |

---

## 📡 API Design (2 minutes)

### REST Endpoints

```
POST   /api/v1/auth/register              Create account
POST   /api/v1/auth/login                 Create session
POST   /api/v1/auth/logout                Destroy session
GET    /api/v1/auth/me                    Current user profile

GET    /api/v1/conversations              List user's conversations
POST   /api/v1/conversations              Create conversation (1:1 or group)
GET    /api/v1/conversations/:id/messages Get messages (paginated, ?before=, ?since=)
PUT    /api/v1/conversations/:id/read     Mark conversation read up to timestamp

POST   /api/v1/conversations/:id/participants     Add member (groups)
DELETE /api/v1/conversations/:id/participants/:uid Remove member

POST   /api/v1/media/upload              Upload file, returns media_url
```

Pagination uses cursor-based approach: `?before={messageId}&limit=50` for scrolling back, `?since={timestamp}` for offline sync. Response includes `{ messages, hasMore }`.

---

## ⚖️ Trade-offs (5 minutes)

### 1. WebSocket vs HTTP Polling for Real-Time Delivery

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Raw WebSocket (ws library) | Sub-100ms delivery, bidirectional, minimal overhead per message | Stateful — requires sticky sessions at the load balancer, reconnection logic on the client |
| ❌ HTTP long-polling | Stateless servers, trivial load balancing | Average 500ms latency at 1s intervals. At 100K users polling every second, the API layer handles 100K req/s of pure overhead — orders of magnitude more expensive than 100K idle WebSocket connections |

> "Messaging is the textbook case for WebSockets. Users expect instant delivery — a 500ms delay makes conversations feel asynchronous rather than real-time. The operational cost of sticky sessions is a one-time nginx configuration. The alternative costs us 100x the server capacity for a worse experience. The trade-off is reconnection complexity: we need heartbeat detection, exponential backoff reconnection, and offline queue flushing — but this complexity lives in a single WebSocket provider component, not scattered across the app."

### 2. Redis Pub/Sub vs Kafka for Cross-Server Routing

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Redis Pub/Sub | ~1ms latency, zero configuration beyond existing Redis, no consumer groups to manage | Fire-and-forget — if the subscribing server is down, the message is lost from the pub/sub channel |
| ❌ Kafka | Durable, replayable, ordered partitions | 5-15ms latency per message, requires ZooKeeper/KRaft cluster, consumer group coordination |

> "The 'lost message' concern with Redis pub/sub sounds alarming, but it's not a real problem here. We persist every message to PostgreSQL *before* publishing to Redis. If the pub/sub delivery fails — target server crashed, network blip, anything — the message is already durable. When the recipient reconnects, the pending-message query picks it up from PostgreSQL. Redis pub/sub is just an optimization for instant delivery to already-connected users. Kafka's durability guarantee is redundant with our persist-before-route pattern, and its 5-15ms overhead on every message is a real cost we'd be paying for no benefit. If we needed event replay for analytics or audit, Kafka would be the right choice — but for routing, Redis is sufficient."

### 3. PostgreSQL vs Cassandra for Message Storage

| Approach | Pros | Cons |
|----------|------|------|
| ✅ PostgreSQL | ACID transactions, complex queries (JOINs for unread counts, status aggregation), familiar tooling | Write throughput ceiling around 10K-50K inserts/sec on a single node |
| ❌ Cassandra | Linear write scaling, natural partitioning by conversation_id, built-in TTL | No JOINs — computing unread counts requires denormalized counters, eventual consistency complicates status transitions |

> "The unread count query joins messages, message_status, and conversation_participants in a single SQL statement. In Cassandra, this requires maintaining a separate counter table that we increment on every message send and decrement on every read — with all the consistency pitfalls of distributed counters. At WhatsApp's actual scale (billions of messages/day), Cassandra is the right answer. At our target scale and for demonstrating the full delivery-receipt flow with transactional guarantees, PostgreSQL keeps the code honest. The migration path is clear: when write throughput exceeds what a PostgreSQL primary with connection pooling can handle, move message storage to Cassandra while keeping user and conversation metadata in PostgreSQL."

### 4. Optimistic UI vs Wait-for-Server

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Optimistic update with client UUID | Instant feedback, message appears in chat within 1 frame | Must handle the failure case (revert or show retry) |
| ❌ Wait for server round-trip | Simpler — no reconciliation needed | 100-300ms delay before message appears; feels sluggish |

> "Users send messages dozens of times per minute in active conversations. Even 100ms of perceived lag on every send creates a noticeable 'heaviness' to the app. The client-generated UUID makes reconciliation straightforward: when the server confirms, we match by clientMessageId and update the status from 'sending' to 'sent'. If the server rejects (validation error, not a participant), we mark the message as 'failed' and show a retry button. The 1% failure path is worth optimizing the 99% success path."

### 5. Forward-Only Status vs Unrestricted Updates

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Forward-only (sent < delivered < read) | Idempotent, no race conditions, no distributed locks | Cannot "unread" a message |
| ❌ Arbitrary status updates | Supports "mark as unread" feature | Race conditions between ACK and read events, requires distributed coordination |

> "In a multi-server system with Redis pub/sub, messages arrive out of order. A 'delivered' event might arrive after a 'read' event if pub/sub channels have different latencies. Forward-only status means we never regress — the conditional UPDATE simply returns 0 rows affected when the message is already at a higher status. No locks, no retries, deterministic resolution."

---

## 📊 Scaling Path

| Component | Current | First Bottleneck | Scaling Step |
|-----------|---------|------------------|--------------|
| WebSocket servers | 3 instances | Connection count per process (~10K) | Auto-scale instances based on connection gauge |
| PostgreSQL | Single node | Write throughput on messages table | Read replicas for conversation queries, then shard messages by conversation_id |
| Redis | Single node | Memory for sessions + presence | Redis Cluster (3 shards) for HA |
| Frontend bundle | Single SPA | Initial load time | Code-split by route, lazy-load chat view |

---

## 🎯 Summary

This design balances three concerns across the stack:

1. **Instant feel** — optimistic UI with client UUIDs, WebSocket delivery, virtualized message lists. The user never waits for the server.

2. **Reliable delivery** — persist-before-route ensures no message is lost. Pending-message queries on reconnect catch anything Redis pub/sub missed. Forward-only status transitions eliminate race conditions.

3. **Offline resilience** — IndexedDB caches received messages and queues unsent ones. The reconnection flow flushes the outbound queue and fetches missed inbound messages with a single `?since=` timestamp.

The shared TypeScript types between frontend and backend eliminate protocol mismatch errors, and the WebSocket event protocol gives us a clean, typed contract for all real-time communication. The architecture scales horizontally by adding more Express+WS instances behind the sticky-session load balancer, with Redis pub/sub handling cross-server routing at negligible latency cost.
