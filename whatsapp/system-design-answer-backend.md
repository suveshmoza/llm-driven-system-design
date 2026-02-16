# WhatsApp - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

---

## 📋 Introduction (2 minutes)

"I'll design the backend for a real-time messaging platform like WhatsApp. This is one of the most demanding backend problems because it combines several hard challenges:

1. **WebSocket connection management** across a distributed server fleet — routing a message from one server to the right recipient on a different server
2. **At-least-once delivery guarantees** — every message must arrive, even if the recipient is offline for days
3. **Idempotent message processing** — network retries and reconnections mean the server will see the same message multiple times and must handle it safely
4. **Group fan-out** — delivering a single message to up to 256 members efficiently without overwhelming any single server

The core tension is achieving sub-100ms delivery for online users while guaranteeing zero message loss for offline users. Let me clarify the requirements."

---

## 🎯 Requirements Clarification (5 minutes)

### Functional Requirements

| Feature | Description |
|---------|-------------|
| One-on-one messaging | Send text messages with delivery receipts (sent, delivered, read) |
| Group chats | Up to 256 members with efficient fan-out |
| Presence and typing | Online/offline status, typing indicators |
| Offline delivery | Queue messages for offline recipients, deliver on reconnect |
| Media sharing | Images, videos, documents with thumbnail generation |

> "I'll focus on three areas: cross-server message routing, the delivery pipeline with idempotency, and group fan-out — these are the hardest backend problems and where most designs fail."

### Non-Functional Requirements

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| Latency | < 100ms message delivery (both online) | Users perceive messaging delays above 200ms as sluggish |
| Scale | 500M concurrent connections, 1M messages/sec | WhatsApp-scale concurrency |
| Durability | At-least-once delivery, zero message loss | Users trust that every message arrives |
| Ordering | Per-conversation ordering | Messages within a chat must appear in send order |
| Availability | 99.99% uptime | Messaging is a utility — downtime is unacceptable |

---

## 🏗️ High-Level Architecture (8 minutes)

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Client Devices                              │
│                     Mobile / Web / Desktop                           │
└─────────────────────────────────────────────────────────────────────┘
                                │ WebSocket (persistent)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      L4 Load Balancer                                │
│               (Sticky sessions by user ID hash)                      │
└─────────────────────────────────────────────────────────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
      ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
      │  Chat Server  │ │  Chat Server  │ │  Chat Server  │
      │    (WS +      │ │    (WS +      │ │    (WS +      │
      │   REST API)   │ │   REST API)   │ │   REST API)   │
      └───────┬───────┘ └───────┬───────┘ └───────┬───────┘
              │                 │                 │
              └─────────────────┼─────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
      ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
      │     Redis     │ │  PostgreSQL   │ │  Object Store │
      │               │ │               │ │   (S3/MinIO)  │
      │ - Sessions    │ │ - Users       │ │               │
      │ - Presence    │ │ - Messages    │ │ - Media files │
      │ - Pub/Sub     │ │ - Delivery    │ │ - Thumbnails  │
      │ - Typing TTL  │ │   status      │ │               │
      └───────────────┘ └───────────────┘ └───────────────┘
```

### Component Responsibilities

**Chat Servers** are stateless WebSocket handlers. Each server maintains an in-memory map of its local connections (user ID to socket) but stores no durable state. Any server can handle any user. At production scale, each server manages roughly 100K concurrent connections.

**Redis** serves four distinct roles. First, it is the session registry — a hash mapping each online user to the server they are connected to. Second, it provides pub/sub channels for cross-server message routing. Third, it stores presence state (online/offline with last-seen timestamps). Fourth, it holds typing indicators as keys with 3-second TTL that auto-expire, so no cleanup is needed.

**PostgreSQL** is the source of truth for all persistent data: users, conversations, messages, participants, and per-recipient delivery status. Messages are written synchronously before any routing attempt, ensuring durability even if the routing layer fails.

**Object Store** holds uploaded media. The chat server generates a presigned upload URL, the client uploads directly, and the resulting media URL is embedded in the message.

> "The key architectural insight is that Redis is ephemeral routing state and PostgreSQL is durable truth. If Redis dies, we lose presence and cross-server routing temporarily, but no messages are lost. If PostgreSQL dies, we stop accepting new messages entirely — we never sacrifice durability."

---

## 🔧 Deep Dive 1: WebSocket Connection Management & Cross-Server Routing (8 minutes)

### The Problem

With hundreds of chat servers, the sender and recipient are almost never on the same server. When Alice on Server A sends a message to Bob on Server C, the system must discover where Bob is connected and route the message there — all in under 100ms.

### Session Registry

When a user connects via WebSocket, the server registers the mapping in Redis as a hash: the key is the user ID, the values include the server ID, connection timestamp, and last-seen time. This hash has a 24-hour TTL refreshed on every heartbeat. When the user disconnects, the server deletes the key immediately.

The session registry answers one question: "Which server is this user connected to right now?" The answer is either a server ID (user is online) or null (user is offline).

### Routing Algorithm

When a message arrives, the chat server executes this sequence:

1. **Persist the message** to PostgreSQL with a "sent" delivery status — this guarantees durability before any routing attempt
2. **Look up the recipient's session** in Redis to find their server ID
3. **If the recipient is on the same server**, deliver directly from the local in-memory connection map
4. **If the recipient is on a different server**, publish the message to that server's Redis pub/sub channel — the target server receives it and delivers to its local socket
5. **If the recipient is offline** (no session exists), increment their pending count in Redis and stop — the message is already persisted and will be delivered on reconnect

### Cross-Server Pub/Sub

Each chat server subscribes to its own Redis channel on startup (for example, channel "server:A"). When Server A needs to deliver a message to a user on Server C, it publishes to the "server:C" channel. Server C receives the event through its subscription, looks up the recipient in its local connection map, and pushes the message through the WebSocket.

This pattern avoids direct server-to-server communication, which would require service discovery and O(N^2) connections between servers. Redis pub/sub acts as an intermediary — each server maintains exactly one subscriber connection regardless of fleet size.

### Heartbeat and Stale Session Detection

Clients send heartbeat pings every 30 seconds. The server updates the last-seen timestamp in the Redis session hash on each heartbeat. If a client silently disconnects (network failure, app crash), the 24-hour TTL eventually cleans up the stale session. For faster detection, a background sweep can check sessions with last-seen older than 90 seconds and proactively remove them.

> "The critical design choice here is persisting to PostgreSQL *before* attempting delivery. Many designs route first and persist later — but if the routing layer or Redis fails mid-delivery, the message is lost. Write-first, route-second means the worst case is a delayed delivery, never a lost message."

### Trade-off: Redis Pub/Sub vs Kafka for Cross-Server Routing

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Redis Pub/Sub | Sub-millisecond latency, simple to operate, no consumer group management | Fire-and-forget — if target server is down, message is dropped from pub/sub |
| ❌ Kafka | Durable, replayable, ordered per partition | 5-50ms added latency per hop, requires Zookeeper/KRaft, significant operational overhead |

> "Redis pub/sub is fire-and-forget, which sounds dangerous. But it works here because we persist every message to PostgreSQL before routing. If Redis pub/sub drops the message, the recipient will pick it up from the pending messages table on their next connect. We get the latency benefit of Redis for the happy path (both users online) without sacrificing durability. Kafka would add 10-50ms of latency to every single message for a durability guarantee we already have from PostgreSQL. The only scenario where Kafka wins is if we need message replay for analytics or audit — and that is a separate concern from real-time delivery."

---

## 🔧 Deep Dive 2: Message Delivery Pipeline & Idempotency (8 minutes)

### The Problem

Network instability means the client might send the same message twice, the server might attempt delivery twice, and acknowledgments might be lost. Without idempotency, users see duplicate messages — a terrible experience in a messaging app.

### Client-Generated Idempotency Keys

The client generates a UUID for every message before sending it. This UUID (the client message ID) is the idempotency key. The server uses it to detect and safely handle duplicates.

The deduplication flow works as follows:

1. The server receives a message with a client message ID
2. It attempts a Redis SETNX on the key "dedup:{clientMessageId}" — this atomically sets the key only if it does not already exist
3. If SETNX returns success (key was new), this is the first attempt — proceed to insert the message into PostgreSQL and route it
4. If SETNX returns failure (key already existed), this is a duplicate — query the existing message by client message ID and return it without re-inserting or re-routing
5. The dedup key has a 24-hour TTL, which covers any reasonable retry window

### Data Model

The core tables are described below. Note that schema descriptions use prose tables per the interview format — no DDL.

**conversations**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID, PK | Auto-generated |
| type | enum: direct, group | Determines fan-out behavior |
| name | varchar(100) | Null for direct chats, set for groups |
| created_by | UUID, FK to users | Group creator |
| created_at | timestamptz | |

**conversation_participants**

| Column | Type | Notes |
|--------|------|-------|
| conversation_id | UUID, FK, part of composite PK | |
| user_id | UUID, FK, part of composite PK | |
| role | enum: admin, member | Used for group permission checks |
| last_read_at | timestamptz | Tracks read position for unread counts |

**messages**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID, PK | Server-generated |
| conversation_id | UUID, FK | Indexed with created_at DESC for pagination |
| sender_id | UUID, FK | |
| content | text | Encrypted in production (E2E) |
| content_type | enum: text, image, video, file | |
| media_url | text | Presigned URL reference |
| client_message_id | UUID, unique | The idempotency key — unique constraint prevents duplicates even if Redis dedup fails |
| created_at | timestamptz | Composite index on (conversation_id, created_at DESC) for efficient history queries |

**message_status**

| Column | Type | Notes |
|--------|------|-------|
| message_id | UUID, FK, part of composite PK | |
| recipient_id | UUID, FK, part of composite PK | One row per recipient per message |
| status | enum: sent, delivered, read | Can only progress forward |
| updated_at | timestamptz | |

Index on (recipient_id) WHERE status = 'sent' enables fast pending message queries on reconnect.

### Status Progression and Idempotent Updates

Message status follows a strict forward-only progression: sent, then delivered, then read. The database enforces this by using a conditional update: assign a numeric rank to each status (sent=0, delivered=1, read=2) and only update if the new rank is strictly greater than the current rank. This means:

- Duplicate "delivered" acknowledgments are silently ignored
- A "read" receipt correctly skips over "delivered" if the delivered ACK was lost
- Status can never move backwards
- No distributed locks are needed — the conditional update is atomic within PostgreSQL

When a status update succeeds, the server notifies the original sender via WebSocket (or queues the notification if the sender is offline) so the UI can update the check marks.

### Offline Delivery on Reconnect

When a user connects, the server queries the message_status table for all rows where the recipient matches the connecting user and the status is "sent." These are the pending messages. The server delivers them in batches of 50 to avoid overwhelming the client. After each batch, the client sends a batch acknowledgment, and the server updates all those messages to "delivered" status in a single database operation.

> "The two-layer deduplication — Redis SETNX for speed and PostgreSQL unique constraint on client_message_id for safety — is deliberate. Redis handles 99.9% of duplicates at sub-millisecond cost. The unique constraint is the safety net for the rare case where Redis is unavailable or the dedup key has expired. Belt and suspenders."

### Trade-off: At-Least-Once vs Exactly-Once Delivery

| Approach | Pros | Cons |
|----------|------|------|
| ✅ At-least-once | Simple server implementation, guaranteed delivery, idempotent clients handle duplicates | Clients must track seen message IDs to suppress duplicates |
| ❌ Exactly-once | No client dedup logic needed | Requires distributed transactions or consensus protocols, adds 10-100x latency, impossible to guarantee across unreliable networks |

> "Exactly-once delivery across a network is a theoretical impossibility without expensive consensus protocols. At-least-once with client-side deduplication is the standard approach for every production messaging system — WhatsApp, Signal, Telegram all do this. The client maintains a set of recently seen message IDs (the last 10,000) and silently drops duplicates. This is a trivial amount of client-side logic compared to the distributed transaction complexity of attempting exactly-once."

---

## 🔧 Deep Dive 3: Group Message Fan-Out (6 minutes)

### The Problem

When a user sends a message to a group of 256 members, the server must deliver it to up to 255 recipients (everyone except the sender). Naively, this means 255 Redis session lookups, 255 pub/sub publishes, and 255 message_status inserts. At scale, groups generate massive write amplification.

### Server-Batched Routing

The key optimization is grouping recipients by their connected server and sending one pub/sub message per server rather than one per recipient:

1. **Persist the message once** — a single insert into the messages table
2. **Fetch all group members** — from a Redis cache of the participant list (cached for 5 minutes with invalidation on membership changes), falling back to PostgreSQL
3. **Look up sessions in bulk** — use Redis MGET or pipeline to fetch all member sessions in a single round-trip rather than 255 sequential lookups
4. **Partition members by server** — group the online members by which server they are connected to, and collect offline members separately
5. **Publish once per server** — instead of 255 individual publishes, send one message per server containing the message payload and the list of recipient user IDs on that server. If 100 members are spread across 5 servers, this is 5 publishes instead of 100
6. **Insert status rows in bulk** — use a single batch insert to create all 255 message_status rows with status "sent"
7. **Offline members need no action** — their messages are already persisted and will be delivered when they reconnect

### Optimizing the Member List Lookup

Group membership changes infrequently compared to message volume. The participant list is cached in Redis as a set with a 5-minute TTL. When a member is added or removed, the cache is invalidated immediately. This means the typical group message requires zero PostgreSQL queries for membership — just a Redis SMEMBERS call.

### Write Amplification Concerns

For a 256-member group, each message generates:
- 1 message row
- 255 message_status rows
- 5-10 pub/sub publishes (assuming members distributed across servers)

At 1,000 group messages per second, this creates 255,000 status inserts per second. To handle this, message_status inserts are batched — the server collects status rows for 100ms or until 100 rows accumulate, then flushes in a single multi-row insert. This reduces the number of database round-trips by 10-50x.

> "The server-batching optimization is where most group chat designs fail. Publishing 255 individual messages to Redis creates 255x the pub/sub traffic. By grouping recipients by server and sending one payload per server, we reduce pub/sub traffic from O(members) to O(servers) — typically a 20-50x reduction."

---

## 📡 API Design (4 minutes)

### REST Endpoints

```
Authentication
POST   /api/v1/auth/register              Create account
POST   /api/v1/auth/login                 Create session
POST   /api/v1/auth/logout                Destroy session
GET    /api/v1/auth/me                    Current user profile

Users
GET    /api/v1/users                      Search by username
GET    /api/v1/users/:id                  Get user profile

Conversations
GET    /api/v1/conversations              List user's conversations (with unread counts)
POST   /api/v1/conversations              Create direct or group conversation
GET    /api/v1/conversations/:id          Conversation details
PUT    /api/v1/conversations/:id          Update name (groups)
GET    /api/v1/conversations/:id/messages Paginated history (cursor-based, newest first)
PUT    /api/v1/conversations/:id/read     Mark as read up to a message ID

Group Management
POST   /api/v1/conversations/:id/participants      Add member
DELETE /api/v1/conversations/:id/participants/:uid  Remove member

Media
POST   /api/v1/media/upload               Upload file, returns media URL
GET    /api/v1/media/:id                  Download via presigned URL
```

### WebSocket Events

The WebSocket connection handles all real-time communication. Events flow in both directions:

**Client to Server:** message (send), typing (indicator), ack (delivery confirmation), read (read receipt with conversation ID and up-to message ID)

**Server to Client:** message (new incoming), message_status (delivery/read receipt for sender), typing (indicator from other user), presence (online/offline change), error (rate limit, validation failure)

> "REST is used for CRUD operations and initial data loading. WebSocket handles everything real-time: message sending, delivery receipts, typing, and presence. The REST fallback for message sending exists for reliability — if the WebSocket reconnects mid-send, the client can retry via REST with the same client message ID."

---

## ⚖️ Scalability & Trade-offs (5 minutes)

### What Breaks First

| Scale Threshold | Bottleneck | Mitigation |
|----------------|------------|------------|
| 100K concurrent connections per server | OS file descriptor limits, memory | Tune kernel params, horizontal scale to more servers |
| 10M messages/day | PostgreSQL write throughput | Partition messages table by conversation_id hash, add write replicas |
| 100M messages/day | Single PostgreSQL instance | Migrate message storage to Cassandra — optimized for high-write, partition-per-conversation access pattern |
| 1B messages/day | Redis pub/sub fan-out | Shard Redis by server-ID prefix, or replace with dedicated message broker |
| 500M users | Session registry size | Redis Cluster with consistent hashing on user ID |

### Sharding Strategy

| Data | Shard Key | Rationale |
|------|-----------|-----------|
| Messages | conversation_id | Co-locates all messages in a conversation for efficient pagination queries |
| Users | user_id | Even distribution, no hot partitions |
| Sessions | user_id modulo N | Consistent hashing for predictable routing |
| Message status | (conversation_id, message_id) | Co-locates with the message for join-free status queries |

### Key Trade-off Decisions

**Message storage: PostgreSQL vs Cassandra**

| Approach | Pros | Cons |
|----------|------|------|
| ✅ PostgreSQL (initial) | ACID transactions, rich query support, simpler operations, strong consistency for status updates | Write throughput ceiling around 50K inserts/sec on a single instance |
| ❌ Cassandra (at scale) | Near-linear write scaling, natural partition-per-conversation model, built-in TTL for message expiry | Eventually consistent, no multi-row transactions, operational complexity with compaction tuning |

> "Starting with PostgreSQL is the right call because it handles the first 100M messages/day without issue and gives us transactional guarantees for message status updates. The migration path to Cassandra is clean — messages are already accessed by conversation_id, which maps directly to a Cassandra partition key. We would migrate message storage to Cassandra while keeping users, conversations, and participants in PostgreSQL where we need relational integrity. This is a hybrid approach — use each database for what it does best."

**Connection model: WebSocket vs HTTP long polling**

| Approach | Pros | Cons |
|----------|------|------|
| ✅ WebSocket | Full duplex, sub-10ms push latency, single persistent connection | Stateful connections complicate load balancing, requires sticky sessions |
| ❌ HTTP long polling | Stateless, works through any proxy, simpler load balancing | 200-500ms average latency, one outstanding request per client, higher server resource usage from constant connection cycling |

> "For a messaging app where users expect instant delivery, 200-500ms of polling latency is disqualifying. Users perceive that delay as the app being broken. WebSocket's full-duplex connection means the server pushes messages the instant they arrive — no waiting for the next poll cycle. The operational cost of sticky sessions and stateful connections is real, but it is a well-understood problem solved by L4 load balancers with connection-aware routing. Every production messaging system uses persistent connections."

**Delivery guarantee: At-least-once with client dedup vs server-side exactly-once**

| Approach | Pros | Cons |
|----------|------|------|
| ✅ At-least-once + client dedup | Simple server logic, robust against network failures, proven pattern | Clients must maintain a seen-message set |
| ❌ Server-side exactly-once | No client-side dedup needed | Requires distributed transactions or consensus, 10-100x latency overhead, still not truly exactly-once across unreliable networks |

> "The engineering community has broadly concluded that exactly-once delivery over unreliable networks is impractical at messaging scale. The Two Generals Problem makes this a theoretical impossibility without acknowledgment loops that add latency. At-least-once with idempotent processing and client-side deduplication is how WhatsApp, iMessage, Signal, and every major messaging platform works. The client tracks recent message IDs in a bounded set and drops duplicates — this is a few lines of client code versus months of distributed systems complexity."

### Rate Limiting

Rate limiting uses a sliding window counter in Redis. Each action type has its own limit:

| Action | Window | Max | Rationale |
|--------|--------|-----|-----------|
| Messages | 1 minute | 60 | Prevents spam, allows burst typing |
| Typing indicators | 10 seconds | 10 | Prevents indicator flicker |
| WebSocket connects | 1 minute | 5 | Prevents reconnection storms |
| Login attempts | 15 minutes | 5 | Brute-force protection |
| Media uploads | 1 hour | 100 | Storage abuse prevention |

The sliding window is implemented with a Redis sorted set per user per action. Each request adds a timestamped entry, entries outside the window are removed, and the remaining count is checked against the limit — all in a single Redis pipeline for atomicity.

### Circuit Breakers

Circuit breakers wrap every external dependency (PostgreSQL, Redis, object store). The circuit has three states: closed (normal), open (failing fast), and half-open (testing recovery). Configuration is tuned for messaging workloads:

- **Failure threshold**: 50% of requests in the last 10 seconds
- **Open duration**: 30 seconds before attempting recovery
- **Timeout**: 3 seconds per request (messages should be fast)

When the PostgreSQL circuit opens, the server rejects new message sends with a retryable error. When the Redis circuit opens, the server falls back to local-only delivery (no cross-server routing) and disables presence/typing features. This graceful degradation keeps the core messaging flow working even during partial outages.

### Graceful Degradation Matrix

| Component Down | Impact | Degraded Behavior |
|---------------|--------|-------------------|
| Redis | No cross-server routing, no presence/typing | Local-only delivery, messages queue in PostgreSQL for later |
| PostgreSQL | Cannot persist new messages | Reject sends with retryable error, existing WebSocket connections remain open |
| Object Store | Media uploads fail | Text messaging continues normally, media sends fail with clear error |
| One chat server | Connections on that server drop | Clients reconnect to healthy server via load balancer, pending messages delivered |

### Session-Based Authentication

> "I chose session-based auth with Redis over JWT for two reasons specific to messaging. First, WebSocket connections are inherently stateful — we already have a Redis session registry for routing, so adding session auth adds no new infrastructure. Second, messaging requires immediate session revocation (account compromise, device theft). With JWT, a stolen token is valid until expiry — potentially hours. With Redis sessions, we delete the key and the user is immediately disconnected on the next heartbeat."

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Session-based (Redis) | Instant revocation, no token expiry window, reuses existing Redis infrastructure | Stateful, requires Redis availability for auth |
| ❌ JWT | Stateless, no server-side storage per session | Cannot revoke instantly, token size grows with claims, requires refresh token rotation |

---

## 📝 Summary

"I've designed a real-time messaging backend built on three core principles:

1. **Write-first, route-second** — every message hits PostgreSQL before any delivery attempt, guaranteeing zero message loss regardless of routing failures
2. **Two-layer idempotency** — Redis SETNX for fast dedup on the hot path, PostgreSQL unique constraints as the safety net, and forward-only status progression to prevent state corruption
3. **Server-batched fan-out** — group messages are routed per-server rather than per-recipient, reducing pub/sub traffic from O(members) to O(servers)

The architecture scales horizontally by adding chat servers behind the L4 load balancer. The first bottleneck will be PostgreSQL write throughput for messages, which we address by partitioning by conversation_id and eventually migrating to Cassandra for the message storage layer while keeping relational data in PostgreSQL.

The system achieves sub-100ms delivery for online users through Redis pub/sub routing, while offline delivery is guaranteed by the pending message query on reconnect — both paths are idempotent and safe to retry.

With more time, I would explore end-to-end encryption using the Signal Protocol (where the server never sees plaintext), push notifications via FCM/APNs for mobile offline delivery, and multi-device support where a single user has concurrent sessions on phone, tablet, and desktop — each requiring independent message delivery and read-state synchronization."
