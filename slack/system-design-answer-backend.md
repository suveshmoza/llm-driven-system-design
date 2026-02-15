# Slack - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Problem Statement

Design the backend infrastructure for a team messaging platform that allows:
- Real-time message delivery to thousands of concurrent users per workspace
- Workspace isolation for enterprise security
- Threading and reply models that scale to busy channels
- Full-text search across millions of messages

## Requirements Clarification

### Functional Requirements
1. **Workspace Management**: Isolated team environments with role-based access
2. **Channel CRUD**: Public and private channels with membership management
3. **Messaging**: Send, edit, delete messages with rich formatting
4. **Threading**: Reply to specific messages, maintaining context
5. **Search**: Full-text search with filters (channel, user, date range)
6. **Presence**: Track online/away status in real-time

### Non-Functional Requirements
1. **Low Latency**: Message delivery < 200ms from send to receipt
2. **Availability**: 99.99% uptime for messaging (critical infrastructure)
3. **Consistency**: Messages must appear in consistent order across all clients
4. **Scalability**: Support 10M workspaces, 1B messages per day

### Scale Estimates
- 10M workspaces, avg 100 users/workspace = 1B users
- 1B messages/day = ~12K messages/sec average, 50K/sec peak
- Avg message size: 500 bytes → 500GB/day raw data
- Read-heavy: 100:1 read:write ratio

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Load Balancer (nginx)                           │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                   ┌───────────────┼───────────────┐
                   ▼               ▼               ▼
           ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
           │   Gateway   │ │   Gateway   │ │   Gateway   │
           │  (WebSocket)│ │  (WebSocket)│ │  (WebSocket)│
           └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
                  │               │               │
                  └───────────────┼───────────────┘
                                  │
           ┌──────────────────────┼──────────────────────┐
           │                      │                      │
           ▼                      ▼                      ▼
   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
   │    Valkey    │      │  PostgreSQL  │      │ Elasticsearch│
   │   (Pub/Sub   │      │   Primary    │      │   (Search)   │
   │   Sessions)  │      │              │      │              │
   └──────────────┘      └──────────────┘      └──────────────┘
```

## Deep Dive: Data Model Design

### Database Schema

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **users** | id (UUID PK), email (unique), password_hash, username, display_name, avatar_url, created_at | Unique on email | Workspace-agnostic identity |
| **workspaces** | id (UUID PK), name, domain (unique), settings (JSONB), created_at | Unique on domain | Tenant isolation boundary |
| **workspace_members** | workspace_id + user_id (composite PK), role (owner/admin/member/guest), joined_at | PK serves as index | Role-based access per workspace |
| **channels** | id (UUID PK), workspace_id (FK), name, topic, is_private, is_archived, created_by, created_at | Unique on (workspace_id, name) | Public and private channels |
| **channel_members** | channel_id + user_id (composite PK), joined_at, last_read_at | PK serves as index | Tracks membership and read position |
| **messages** | id (BIGSERIAL PK), workspace_id (FK), channel_id (FK), user_id (FK), thread_ts (self-ref FK, NULL for top-level), content, attachments (JSONB), reply_count, edited_at, created_at | See index strategy below | Threading via self-referential thread_ts |
| **reactions** | message_id + user_id + emoji (composite PK), created_at | PK serves as index | One reaction per user per emoji per message |

### Index Strategy

Key indexes on the messages table:

| Index | Columns | Notes |
|-------|---------|-------|
| idx_messages_channel | channel_id, created_at DESC | Primary query path for channel message history |
| idx_messages_thread | thread_ts (partial: WHERE thread_ts IS NOT NULL) | Thread replies lookup, partial index saves space |
| idx_messages_workspace | workspace_id | Workspace-level queries |
| idx_channel_members_user | user_id on channel_members | Find channels a user belongs to |
| idx_workspace_members_user | user_id on workspace_members | Find workspaces a user belongs to |
| idx_messages_content_fts | GIN index on to_tsvector('english', content) | Full-text search fallback when Elasticsearch unavailable |

### Why PostgreSQL + Elasticsearch?

| Consideration | PostgreSQL | Elasticsearch | Decision |
|---------------|------------|---------------|----------|
| Message storage | Excellent (ACID) | Eventual consistency | PostgreSQL primary |
| Time range queries | Good (B-tree) | Good | PostgreSQL |
| Full-text search | Moderate (GIN) | Excellent | Elasticsearch |
| Complex filters | Excellent | Excellent | Both |
| Operational complexity | Low | Moderate | PostgreSQL primary |

**Decision**: PostgreSQL for source of truth, Elasticsearch for search. Messages are indexed asynchronously via a queue.

## Deep Dive: Real-Time Message Delivery

### The Fan-Out Problem

When a user sends a message to a channel with 1000 members, we need to deliver that message to potentially 1000 different WebSocket connections across multiple gateway servers.

### User-Level Pub/Sub Architecture

The message send flow works in four steps:

1. **Persist the message** - Insert into the messages table with workspace_id, channel_id, user_id, and content
2. **Get channel members** - Query channel_members for all user_ids in the target channel
3. **Publish to each member's subscription channel** - For each member, publish the serialized message to their personal Redis pub/sub channel (keyed as `user:{memberId}:messages`)
4. **Queue for search indexing** - Enqueue the message for async Elasticsearch indexing

This fan-out happens at the message service level, keeping gateway logic simple.

### Gateway Subscription

When a WebSocket connection is established, the gateway creates a dedicated Redis subscriber for that user's personal channel (`user:{userId}:messages`). Every message received on that channel is forwarded directly to the WebSocket. When the WebSocket closes, the subscriber unsubscribes and disconnects. This keeps gateways stateless - they don't need to know about channel membership.

### Why User-Level vs Channel-Level Pub/Sub?

| Approach | Pros | Cons |
|----------|------|------|
| **User-level** | Simple gateway logic, exact targeting | More pub/sub channels |
| Channel-level | Fewer channels | Gateway must filter by membership |

**Decision**: User-level pub/sub. The message service handles fan-out once; gateways simply forward everything they receive. This keeps gateway logic simple and stateless.

### Connection State Management

We track which gateway handles which user using a Redis hash (`connections`). When a user connects, we store the mapping of user_id to gateway_id with a 1-hour TTL for automatic cleanup. To find the gateway serving a specific user, we perform a simple hash get operation. This enables targeted delivery when needed.

## Deep Dive: Threading Model

### Design Decision: Thread as Message Attribute

A thread reply is simply a message with the `thread_ts` field set to the parent message's ID. The reply flow works as follows:

1. **Within a database transaction**, insert the reply as a new message with `thread_ts` pointing to the parent
2. **Atomically increment** the parent message's `reply_count` by 1
3. To **retrieve a thread**, fetch the parent message by its ID, then query all messages where `thread_ts` equals that ID, ordered by `created_at` ascending

This approach keeps threads on the same delivery path as regular messages - no special handling needed.

### Why Not a Separate Threads Table?

| Approach | Pros | Cons |
|----------|------|------|
| **Thread as attribute** | Simple queries, same delivery path | Denormalized reply count |
| Separate threads table | Normalized | Complex joins, two delivery paths |

**Decision**: Thread as message attribute. A thread reply is still a message - same data model, same delivery path. The parent message contains denormalized thread metadata (reply_count).

## Deep Dive: Presence System

### TTL-Based Presence

The presence system uses Redis keys with a 60-second TTL for automatic cleanup:

1. **Heartbeat** (every 30 seconds): The client sends a heartbeat which sets a Redis key `presence:{workspaceId}:{userId}` with a 60-second TTL containing the status and last seen timestamp. It then broadcasts the presence change to relevant users.
2. **Online check**: Simply check if the Redis key exists - if it does, the user is online.
3. **List online users**: Use Redis SCAN with pattern `presence:{workspaceId}:*` to iterate through keys in batches of 100, extracting user IDs from the key names. SCAN is used instead of KEYS to avoid blocking on large workspaces.

### Presence Optimization for Large Workspaces

For workspaces with 100,000+ users, broadcasting every presence change is expensive.

For workspaces with 100,000+ users, broadcasting every presence change is expensive. The optimization is to only broadcast to users who can actually see the person:

1. **Find the user's channels** - Query channel_members for all channels the user belongs to
2. **Find visible users** - Query for distinct user_ids across those channels
3. **Batch presence updates** - Publish presence changes only to those visible users' personal pub/sub channels (`user:{targetUserId}:presence`)

This dramatically reduces the fan-out for large workspaces where most users don't share channels.

## Deep Dive: Search Architecture

### Elasticsearch Indexing

Messages are indexed asynchronously via a queue consumer:

**Indexing**: Each message is indexed into Elasticsearch with fields for workspace_id, channel_id, user_id, content, and created_at. The message ID serves as the document ID.

**Search**: Queries use a bool query structure with a mandatory workspace_id term filter (for tenant isolation) and a full-text match on content. Optional filters include channel_id, user_id, and date range. Results include highlighted content snippets to show matching terms in context.

### PostgreSQL Fallback

When Elasticsearch is unavailable, search falls back to PostgreSQL's built-in full-text search using `to_tsvector('english', content)` with `plainto_tsquery`. Results are ordered by created_at descending with a limit of 100. The GIN index on the content column makes this viable for moderate query volumes.

## Caching Strategy

### Cache Layers

```
┌──────────────────────────────────────────────────────────────┐
│                      Valkey Cache Layer                       │
│                                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │
│  │ User Cache  │  │Channel Cache│  │ Workspace   │           │
│  │ TTL: 5min   │  │ TTL: 2min   │  │ TTL: 10min  │           │
│  └─────────────┘  └─────────────┘  └─────────────┘           │
│                                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │
│  │  Presence   │  │  Sessions   │  │ Rate Limits │           │
│  │  TTL: 60s   │  │ TTL: 24hr   │  │  TTL: 1min  │           │
│  └─────────────┘  └─────────────┘  └─────────────┘           │
└──────────────────────────────────────────────────────────────┘
```

### Cache-Aside Pattern

For frequently accessed data like channel members, we use a cache-aside pattern:

1. **Read path**: Check Redis cache first (key: `channel:{channelId}:members`, TTL: 2 minutes). On hit, return the cached member list. On miss, query the database joining channel_members with users to get id, username, and avatar_url, then populate the cache.
2. **Write path (invalidation)**: When a member is added or removed from a channel, delete the cache key immediately. The next read will repopulate from the database.

This pattern is applied consistently across user profiles (5-min TTL), channel metadata (2-min TTL), and workspace settings (10-min TTL).

## Idempotency for Message Sending

To prevent duplicate messages on client retry, the send function accepts an idempotency key. It first checks Redis for an existing response cached under `idem:{idempotencyKey}`. If found, it returns the cached response. Otherwise, it processes the message within a database transaction, then caches the response in Redis with a 24-hour TTL. Subsequent retries with the same key return the cached result without creating duplicate messages.

## Rate Limiting

We use a sliding window rate limiter backed by Redis sorted sets. The algorithm works as follows:

1. Remove all entries outside the current time window using ZREMRANGEBYSCORE
2. Add the current request timestamp as a new entry with ZADD
3. Count remaining entries with ZCARD to determine if the limit is exceeded
4. Set an expiry on the key equal to the window duration

All four operations execute atomically via a Redis MULTI/EXEC pipeline.

| Endpoint | Limit | Window |
|----------|-------|--------|
| POST /messages | 60 | 1 min |
| POST /channels | 10 | 1 min |
| POST /reactions | 30 | 1 min |
| GET /search | 20 | 1 min |

## Scalability Considerations

### Read Scaling

1. **Read Replicas**: Route message history queries to replicas
2. **Connection Pooling**: PgBouncer for connection management
3. **Caching**: Channel members and user profiles heavily cached

### Write Scaling

1. **Partitioning by Workspace**: Shard the messages table by workspace_id using hash-based partitioning (e.g., modulus 4) so each partition handles a subset of workspaces

2. **Async Indexing**: Search indexing via background queue

### Estimated Capacity

| Component | Single Node | Scaled (4x) |
|-----------|-------------|-------------|
| PostgreSQL writes | 5K/sec | 20K/sec (sharded) |
| PostgreSQL reads | 20K/sec | 80K/sec (replicas) |
| Valkey pub/sub | 100K/sec | 100K/sec |
| WebSocket connections | 10K/gateway | 40K (4 gateways) |

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| User-level pub/sub | Simple gateway, exact targeting | More pub/sub channels |
| Thread as message attribute | Same delivery path, simple queries | Denormalized reply count |
| Valkey TTL for presence | Auto-cleanup, fast | Eventual consistency |
| Async search indexing | No write latency impact | Search lag (1-5 sec) |
| PostgreSQL + Elasticsearch | Best of both | Operational complexity |

## Future Backend Enhancements

1. **Message Retention Policies**: Auto-delete old messages per workspace settings
2. **Rate Limiting per Workspace**: Different limits for different pricing tiers
3. **Audit Logging**: Track all admin actions for compliance
4. **Webhooks & Integrations**: External system notifications
5. **Geographic Distribution**: Multi-region deployment for global workspaces
