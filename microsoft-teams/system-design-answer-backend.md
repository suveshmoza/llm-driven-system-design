# Microsoft Teams - Backend System Design Answer

## 🏗️ Architecture Overview

> "I'm designing the backend for an enterprise chat platform like Microsoft Teams. The core challenge is delivering messages in real-time across a hierarchical organization structure -- organizations contain teams, teams contain channels, and channels contain threaded conversations. The system must handle millions of concurrent connections, persist every message for compliance, and track user presence across all channels."

The backend follows a service-oriented architecture behind an API gateway, with PostgreSQL for persistent storage, Redis for real-time state (presence, pub/sub, sessions), and MinIO (S3-compatible) for file storage.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────────────────────────────┐
│   Clients   │────▶│  API Gateway│────▶│            Service Layer                │
│  (Web/Mobile)│    │  (nginx/LB) │     │                                         │
└──────┬──────┘     └─────────────┘     │  ┌─────────┐ ┌─────────┐ ┌──────────┐  │
       │                                │  │  Auth   │ │ Message │ │ Presence │  │
       │  SSE Stream                    │  │ Service │ │ Service │ │ Service  │  │
       │◀───────────────────────────────│  └─────────┘ └────┬────┘ └────┬─────┘  │
                                        │                   │           │         │
                                        │  ┌─────────┐ ┌───┴─────┐ ┌──┴──────┐  │
                                        │  │  File   │ │  Redis  │ │  Redis  │  │
                                        │  │ Service │ │ Pub/Sub │ │ TTL Keys│  │
                                        │  └────┬────┘ └─────────┘ └─────────┘  │
                                        └───────┼────────────────────────────────┘
                                                │
                            ┌──────────┐  ┌─────┴─────┐  ┌──────────┐
                            │PostgreSQL│  │   MinIO   │  │  Valkey  │
                            │(Messages)│  │  (Files)  │  │ (Cache)  │
                            └──────────┘  └───────────┘  └──────────┘
```

## 🏢 Organizational Hierarchy

> "Enterprise chat differs from consumer chat in one fundamental way: the resource hierarchy. Slack has workspaces and channels. Discord has servers and channels. Teams has organizations, teams within those organizations, and channels within those teams. This three-level hierarchy mirrors how enterprises actually organize -- a company (org) has departments (teams) with topic-specific discussion spaces (channels)."

The hierarchy drives access control at every level:
- A user must be an org member to see any teams in that org
- A user must be a team member to see channels in that team (unless the channel is public)
- A user must be a channel member to send messages (auto-joined for public channels)

Creating a team automatically creates a "General" channel and adds the creator to both. This is done in a database transaction to ensure atomicity. Without the transaction, a crash between team creation and channel creation would leave a team with no channels -- an invalid state that would confuse the frontend.

## 💾 Data Model

> "The data model centers on a four-level hierarchy: Organization, Team, Channel, Message. Each level has a membership table for access control. Threading is modeled as a self-referencing foreign key on the messages table."

### Core Tables

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| users | id (UUID PK), username (unique), email (unique), password_hash | username, email | Display name, avatar URL, role |
| organizations | id (UUID PK), name, slug (unique), created_by (FK users) | slug | Top-level container |
| org_members | id, org_id (FK), user_id (FK), role | (org_id, user_id) unique, user_id | Roles: owner, admin, member |
| teams | id, org_id (FK), name, is_private, created_by (FK) | org_id | Cascade delete from org |
| team_members | id, team_id (FK), user_id (FK), role | (team_id, user_id) unique, user_id | Roles: owner, member |
| channels | id, team_id (FK), name, is_private, created_by (FK) | team_id | Cascade delete from team |
| channel_members | id, channel_id (FK), user_id (FK), last_read_at | (channel_id, user_id) unique, user_id | Read tracking per user |
| messages | id, channel_id (FK), user_id (FK), parent_message_id (self FK), content, is_edited | (channel_id, created_at DESC), parent_message_id | Thread via self-reference |
| message_reactions | id, message_id (FK), user_id (FK), emoji | message_id, (message_id, user_id, emoji) unique | One reaction per emoji per user |
| files | id, message_id (FK), channel_id (FK), user_id (FK), filename, storage_path, size_bytes | channel_id, message_id | Cascade delete from message |

### Threading Model

> "I chose self-referencing messages over a separate threads table. A thread is simply a message whose parent_message_id is NULL (top-level) with replies pointing back to it. This keeps the schema simple -- one table handles both top-level messages and replies. The trade-off is that deeply nested threads aren't supported, but Teams uses flat thread replies (one level deep), making this the right fit."

### UUID Primary Keys

> "Every table uses UUID primary keys instead of auto-incrementing integers. UUIDs can be generated on any node without coordination, which is essential for horizontal scaling. Auto-increment requires a single source of truth, which becomes a bottleneck when you shard the database. The trade-off is larger index sizes (16 bytes vs. 4-8 bytes) and slightly slower index lookups due to non-sequential insertion, but the operational benefits outweigh this at enterprise scale."

### Cascade Deletion Chain

The cascade chain flows: Organization -> Team -> Channel -> Message -> Reaction/File. Deleting an organization removes everything beneath it. This simplifies cleanup but requires careful confirmation UIs. In production, I'd implement soft deletes with a `deleted_at` timestamp and a separate archival process rather than hard cascades.

### Read Tracking

The `last_read_at` column on channel_members tracks each user's read position. Unread count is computed as the number of messages with `created_at > last_read_at`. At scale, this query is expensive (scans the messages index per channel per user) and should be denormalized into a counter updated on each new message.

## 🔄 API Design

### Authentication
```
POST /api/auth/register     → Create account, start session
POST /api/auth/login        → Authenticate, start session
POST /api/auth/logout       → Destroy session
GET  /api/auth/me           → Current user info
```

### Organization and Team Management
```
GET  /api/organizations             → List user's orgs
POST /api/organizations             → Create org (auto-adds creator as owner)
GET  /api/organizations/:id         → Get org details
GET  /api/organizations/:id/members → List org members
POST /api/organizations/:id/members → Add member
GET  /api/teams?orgId=xxx           → List teams in org
POST /api/teams                     → Create team (auto-creates General channel)
GET  /api/teams/:id                 → Get team details
GET  /api/teams/:id/members         → List team members
POST /api/teams/:id/members         → Add member
```

### Channels and Messaging
```
GET  /api/channels?teamId=xxx                 → List channels
POST /api/channels                            → Create channel
GET  /api/channels/:id                        → Get channel details
GET  /api/channels/:id/members                → List channel members
POST /api/channels/:id/members                → Add member
POST /api/channels/:id/read                   → Mark as read
GET  /api/messages?channelId=xxx&before=ts    → Paginated messages
POST /api/messages                            → Send message
PUT  /api/messages/:id                        → Edit message (owner only)
DELETE /api/messages/:id                      → Delete message (owner only)
GET  /api/messages/:id/thread                 → Get thread replies
```

### Real-Time, Presence, Files, and Reactions
```
GET    /api/sse/:channelId           → SSE event stream
POST   /api/presence/heartbeat       → Presence heartbeat
GET    /api/presence/channel/:id     → Channel member presence
POST   /api/files                    → Upload file (multipart)
GET    /api/files/:id/download       → Presigned download URL
GET    /api/files?channelId=xxx      → List channel files
POST   /api/reactions                → Add reaction
DELETE /api/reactions                → Remove reaction
GET    /api/users/search?q=xxx       → Search users by name
```

### Pagination Design

> "Messages use cursor-based pagination with a `before` timestamp parameter rather than offset-based pagination. With offset pagination, new messages arriving between page loads shift all offsets -- page 2 at offset 50 would include messages from page 1 if 5 new messages were posted. Cursor pagination anchors to a timestamp, guaranteeing no duplicates or gaps regardless of concurrent writes."

## 🔒 Security and Rate Limiting

Session-based authentication using Redis-backed express-session with HTTP-only, SameSite cookies. Three-tier rate limiting protects against abuse:

| Tier | Limit | Scope | Purpose |
|------|-------|-------|---------|
| Auth | 50 req / 15 min | Login/register | Brute-force protection |
| API | 1000 req / 15 min | All /api routes | General abuse prevention |
| Messages | 120 req / 1 min | POST /messages | Spam prevention |

> "Rate limiting at the message level is critical for chat -- without it, a single misbehaving client could flood a channel with 1000 messages per second, overwhelming both the database and every connected SSE client. The 120/minute limit still allows fast-paced conversation (2 messages per second) while preventing spam."

## 🔧 Deep Dive 1: Real-Time Message Delivery

> "The hardest problem in a chat system is delivering messages in real-time across multiple server instances to thousands of concurrent clients per channel."

### The Pipeline

1. Client sends `POST /api/messages` with channel ID and content
2. Server validates auth, membership, rate limit. Persists to PostgreSQL
3. Server publishes to Redis pub/sub on `teams:channel:{channelId}`
4. Every server instance subscribing to that channel receives the event
5. Each server iterates its local SSE client map and writes the event to each response stream

### Why SSE Over WebSocket

| Approach | Pros | Cons |
|----------|------|------|
| ✅ SSE (Server-Sent Events) | HTTP-native, auto-reconnect, simpler server | Unidirectional only |
| ❌ WebSocket | Bidirectional, lower overhead per message | Connection upgrade complexity, no auto-reconnect |

> "I chose SSE because the communication pattern is asymmetric. Messages are sent via REST POST (client-to-server), and pushed via SSE (server-to-client). SSE gives us automatic reconnection with EventSource, works through HTTP proxies without special configuration, and doesn't require a separate protocol upgrade. The trade-off is that we can't push typing indicators as efficiently -- but typing indicators are low-priority ephemeral data that can tolerate higher latency. For typing, I'd use a separate polling endpoint at 3-second intervals rather than contaminating the SSE stream with high-frequency low-value events."

### Cross-Instance Broadcasting

> "Without Redis pub/sub, messages only reach clients connected to the same server instance that received the POST. With 10 API servers, 90% of clients would miss messages. Redis pub/sub acts as a broadcast bus -- when any server receives a message, it publishes to Redis, and all subscribing servers relay it to their local SSE clients."

### SSE Connection Management

Each server maintains a `Map<channelId, Set<SSEClient>>`. When a client connects:
- Server sets SSE headers (text/event-stream, no-cache, keep-alive, X-Accel-Buffering: no)
- Subscribes to the Redis pub/sub channel if not already subscribed
- Adds client to the in-memory map
- Sends periodic heartbeat comments every 30 seconds to prevent proxy timeout
- On disconnect, removes client from the set and unsubscribes from Redis if set is empty

The `X-Accel-Buffering: no` header is critical for nginx reverse proxies -- without it, nginx buffers SSE events and delivers them in bursts rather than streaming immediately.

### Failure Modes and Recovery

- **Server crash**: SSE connections drop, clients auto-reconnect to another server via load balancer. On reconnect, the client fetches messages since its last received timestamp to fill the gap.
- **Redis pub/sub failure**: Circuit breaker opens after 50% error rate. Messages still persist to PostgreSQL but real-time delivery degrades. Clients fall back to polling on SSE reconnect failure.
- **Client network loss**: EventSource retries automatically with increasing intervals. The browser handles all retry logic.
- **Redis message loss**: Redis pub/sub is fire-and-forget -- if no subscriber is listening, the message is lost. This is acceptable because the message is durably stored in PostgreSQL. SSE is a notification mechanism, not the source of truth.

## 🔧 Deep Dive 2: Thread Model at Scale

> "Threading seems simple -- just add a parent_message_id column. But the scaling implications of that choice ripple through queries, real-time delivery, and UI data requirements."

### Query Patterns

Two distinct access patterns emerge:
1. **Channel feed**: Top-level messages (`WHERE parent_message_id IS NULL`) ordered by `created_at DESC`, with reply counts via correlated subquery
2. **Thread view**: All messages for a thread (`WHERE id = :parentId OR parent_message_id = :parentId`) ordered by `created_at ASC`

### Reply Count Optimization

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Correlated subquery (current) | Always accurate | O(n) subqueries per page load |
| ❌ Denormalized reply_count column | O(1) reads | Must update on every reply, counter drift risk |
| ❌ Materialized view | Fast reads | Refresh lag, cannot be real-time |

> "For the local implementation, I use a correlated subquery because correctness matters more than performance at small scale. At production scale, I'd add a denormalized reply_count column and update it atomically in the same transaction that inserts the reply. Counter drift is mitigated by nightly reconciliation jobs comparing stored counts against actual counts."

### Real-Time Thread Updates

When a reply arrives via pub/sub, the SSE event includes the `parent_message_id`. The client must:
1. Increment the reply count on the parent message in the channel feed
2. If the thread panel is open for that parent, append the reply
3. Not add the reply to the channel feed (replies only appear in threads)

### Thread Pagination

Most threads have fewer than 100 replies, so the thread view loads all replies without pagination. For outlier threads with thousands of replies, cursor-based pagination would be added when thread loading exceeds the 200ms p99 latency target.

## 🔧 Deep Dive 3: Presence System Design

> "Presence tracking -- showing who's online -- seems trivial until you consider 10 million concurrent users sending heartbeats every 30 seconds. That's 333K heartbeats per second."

### Redis TTL Approach

Each user's online status is a Redis key with a TTL:
- Key: `presence:{userId}`, Value: timestamp, TTL: 60 seconds
- Client sends heartbeat every 30 seconds (2x safety margin over TTL)
- If heartbeat stops, key expires automatically -- no cleanup job needed
- Checking presence: `EXISTS presence:{userId}` returns 1 (online) or 0 (offline)

### Why Redis TTL Over Alternatives

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Redis TTL keys | Auto-expiry, O(1) per heartbeat | Must batch reads for efficiency |
| ❌ Database column + timestamp | Persistent, queryable | Polling needed, no auto-cleanup |
| ❌ Redis SET per channel | O(1) per channel lookup | 50 SADD ops per heartbeat for user in 50 channels |
| ❌ WebSocket connection state | Instant transitions | Requires WebSocket, no horizontal scaling |

> "I chose Redis TTL keys because the set-per-channel approach has unacceptable write amplification. A user in 50 channels would need 50 SADD operations on every heartbeat. With TTL keys, each heartbeat is a single SETEX regardless of channel count. The read side uses Redis pipeline to batch N EXISTS calls into a single round trip when loading a member list."

### Batch Presence Queries

When loading a channel's member list, we need presence for N users. Individual EXISTS calls create N round trips. Redis pipeline batches all checks into one round trip: queue N EXISTS commands, execute, zip results with user IDs.

### Scale Considerations

At 10M concurrent users with 30-second heartbeats:
- 333K writes/second to Redis (SETEX operations)
- Each key is ~50 bytes, total memory: ~500MB
- This fits on a single Redis instance but can be sharded by user ID hash for redundancy

### Presence Change Notifications

The current implementation polls presence when loading the member list. At production scale, I'd add real-time presence change events:
- On first heartbeat after absence: publish "user_online" event to their channels
- On key expiry: use Redis keyspace notifications to broadcast "user_offline"
- Rate-limit presence notifications to at most once per 10 seconds per user to avoid flapping

## 📊 Observability

### Metrics (Prometheus)

| Metric | Type | Labels | Purpose |
|--------|------|--------|---------|
| http_request_duration_seconds | Histogram | method, route, status | API latency tracking |
| http_requests_total | Counter | method, route, status | Request volume |
| messages_total | Counter | channel_id | Message throughput per channel |
| sse_connections_active | Gauge | - | Current SSE connection count |
| presence_updates_total | Counter | - | Heartbeat volume |

### Structured Logging

JSON-formatted logs via Pino with request correlation via pino-http. Key fields: userId, channelId, operation for distributed tracing.

### Health Check

`GET /api/health` verifies database connectivity. Used by load balancers to route traffic away from unhealthy instances.

## ⚡ Scalability Discussion

### What Breaks First

1. **SSE connection limits**: At 100K connections per server, memory (~10GB) and file descriptor limits become bottlenecks. Solution: dedicated SSE gateway servers separate from API servers.

2. **Messages table**: Billions of rows slow the `(channel_id, created_at)` B-tree index. Solution: range partition by `created_at` monthly, or migrate to Cassandra for high-volume channels.

3. **Redis pub/sub fan-out**: A 10K-member channel at 100 msgs/sec means 1M SSE pushes/sec. Solution: batch delivery over 100ms windows, tiered fan-out through gateway servers.

### Scaling Path

- **Phase 1**: Vertical scaling -- bigger database, more Redis memory
- **Phase 2**: Read replicas for message history, separate write/read endpoints
- **Phase 3**: Database partitioning by date range
- **Phase 4**: CQRS -- PostgreSQL for writes, Elasticsearch for search, Cassandra for reads
- **Phase 5**: Multi-region with per-region storage and cross-region metadata sync

## ⚖️ Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| ✅ SSE | Simple, HTTP-native, auto-reconnect | ❌ WebSocket | Unidirectional push sufficient, REST for sends |
| ✅ Redis pub/sub | Low latency, simple setup | ❌ Kafka | Chat prioritizes speed over durability |
| ✅ Self-referencing threads | One table, simple joins | ❌ Separate threads table | Flat threads match Teams UX |
| ✅ Redis TTL for presence | Auto-expiry, no cleanup jobs | ❌ Database polling | Sub-minute accuracy, O(1) per heartbeat |
| ✅ PostgreSQL | ACID, joins, mature | ❌ Cassandra | Sufficient until billions of messages |
| ✅ MinIO (S3-compatible) | Presigned URLs, scalable | ❌ Database BLOBs | Offloads bandwidth |
| ✅ Session auth | Immediate revocation | ❌ JWT | No token refresh, works with SSE |
| ✅ Cursor pagination | Stable under concurrent writes | ❌ Offset pagination | No duplicates from new messages |
| ✅ UUID primary keys | No coordination needed | ❌ Auto-increment | Required for database sharding |
