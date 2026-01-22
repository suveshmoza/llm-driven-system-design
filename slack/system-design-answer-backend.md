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

```sql
-- Users with workspace-agnostic identity
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    username VARCHAR(100) NOT NULL,
    display_name VARCHAR(200) NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workspaces for tenant isolation
CREATE TABLE workspaces (
    id UUID PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    domain VARCHAR(100) UNIQUE,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workspace membership with roles
CREATE TABLE workspace_members (
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'member'
        CHECK (role IN ('owner', 'admin', 'member', 'guest')),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);

-- Channels within workspaces
CREATE TABLE channels (
    id UUID PRIMARY KEY,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    topic TEXT,
    is_private BOOLEAN DEFAULT FALSE,
    is_archived BOOLEAN DEFAULT FALSE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workspace_id, name)
);

-- Channel membership
CREATE TABLE channel_members (
    channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    last_read_at TIMESTAMPTZ,
    PRIMARY KEY (channel_id, user_id)
);

-- Messages with threading support
CREATE TABLE messages (
    id BIGSERIAL PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    thread_ts BIGINT REFERENCES messages(id),  -- NULL for top-level
    content TEXT NOT NULL,
    attachments JSONB,
    reply_count INTEGER DEFAULT 0,
    edited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reactions
CREATE TABLE reactions (
    message_id BIGINT REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id, emoji)
);
```

### Index Strategy

```sql
-- Primary index for channel message queries
CREATE INDEX idx_messages_channel ON messages(channel_id, created_at DESC);

-- Thread replies lookup
CREATE INDEX idx_messages_thread ON messages(thread_ts)
    WHERE thread_ts IS NOT NULL;

-- Workspace-level queries
CREATE INDEX idx_messages_workspace ON messages(workspace_id);

-- Channel membership lookups
CREATE INDEX idx_channel_members_user ON channel_members(user_id);

-- Workspace membership lookups
CREATE INDEX idx_workspace_members_user ON workspace_members(user_id);

-- Full-text search fallback (when Elasticsearch unavailable)
CREATE INDEX idx_messages_content_fts
    ON messages USING gin(to_tsvector('english', content));
```

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

```javascript
// Message send flow
async function sendMessage(workspaceId, channelId, userId, content) {
    // 1. Persist the message
    const message = await db('messages').insert({
        workspace_id: workspaceId,
        channel_id: channelId,
        user_id: userId,
        content
    }).returning('*');

    // 2. Get channel members
    const members = await db('channel_members')
        .where({ channel_id: channelId })
        .pluck('user_id');

    // 3. Publish to each member's subscription channel
    for (const memberId of members) {
        await redis.publish(
            `user:${memberId}:messages`,
            JSON.stringify(message)
        );
    }

    // 4. Queue for search indexing (async)
    await searchQueue.add({ type: 'index_message', message });

    return message;
}
```

### Gateway Subscription

```javascript
// Gateway handles WebSocket connections
gateway.on('connection', async (ws, userId) => {
    // Create dedicated subscriber for this user
    const subscriber = redis.duplicate();
    await subscriber.subscribe(`user:${userId}:messages`);

    subscriber.on('message', (channel, data) => {
        ws.send(data);
    });

    ws.on('close', () => {
        subscriber.unsubscribe();
        subscriber.quit();
    });
});
```

### Why User-Level vs Channel-Level Pub/Sub?

| Approach | Pros | Cons |
|----------|------|------|
| **User-level** | Simple gateway logic, exact targeting | More pub/sub channels |
| Channel-level | Fewer channels | Gateway must filter by membership |

**Decision**: User-level pub/sub. The message service handles fan-out once; gateways simply forward everything they receive. This keeps gateway logic simple and stateless.

### Connection State Management

```javascript
// Track which gateway handles which user
async function registerConnection(userId, gatewayId) {
    await redis.hset('connections', userId, gatewayId);
    await redis.expire('connections', 3600);  // 1 hour cleanup
}

// Find gateway for a specific user
async function getGatewayForUser(userId) {
    return await redis.hget('connections', userId);
}
```

## Deep Dive: Threading Model

### Design Decision: Thread as Message Attribute

```javascript
// Thread reply is just a message with thread_ts set
async function replyToThread(parentId, content, userId) {
    return await db.transaction(async (trx) => {
        // Insert reply
        const [reply] = await trx('messages').insert({
            channel_id: parentMessage.channel_id,
            user_id: userId,
            thread_ts: parentId,
            content
        }).returning('*');

        // Update parent reply count atomically
        await trx('messages')
            .where({ id: parentId })
            .increment('reply_count', 1);

        return reply;
    });
}

// Get thread with all replies
async function getThread(messageTs) {
    const parent = await db('messages')
        .where({ id: messageTs })
        .first();

    const replies = await db('messages')
        .where({ thread_ts: messageTs })
        .orderBy('created_at', 'asc');

    return { parent, replies };
}
```

### Why Not a Separate Threads Table?

| Approach | Pros | Cons |
|----------|------|------|
| **Thread as attribute** | Simple queries, same delivery path | Denormalized reply count |
| Separate threads table | Normalized | Complex joins, two delivery paths |

**Decision**: Thread as message attribute. A thread reply is still a message - same data model, same delivery path. The parent message contains denormalized thread metadata (reply_count).

## Deep Dive: Presence System

### TTL-Based Presence

```javascript
// Client sends heartbeat every 30 seconds
async function heartbeat(userId, workspaceId) {
    // Set presence with 60-second TTL
    await redis.setex(
        `presence:${workspaceId}:${userId}`,
        60,
        JSON.stringify({ status: 'online', lastSeen: Date.now() })
    );

    // Broadcast presence change to relevant users
    await broadcastPresence(workspaceId, userId, 'online');
}

// Check if user is online
async function isOnline(workspaceId, userId) {
    const presence = await redis.get(`presence:${workspaceId}:${userId}`);
    return presence !== null;
}

// Get all online users (use SCAN for large workspaces)
async function getOnlineUsers(workspaceId) {
    const keys = [];
    let cursor = '0';

    do {
        const [newCursor, matchedKeys] = await redis.scan(
            cursor,
            'MATCH', `presence:${workspaceId}:*`,
            'COUNT', 100
        );
        cursor = newCursor;
        keys.push(...matchedKeys);
    } while (cursor !== '0');

    return keys.map(k => k.split(':')[2]);
}
```

### Presence Optimization for Large Workspaces

For workspaces with 100,000+ users, broadcasting every presence change is expensive.

```javascript
// Only broadcast to users who can see the person
async function broadcastPresence(workspaceId, userId, status) {
    // Get channels the user is in
    const userChannels = await db('channel_members')
        .where({ user_id: userId })
        .pluck('channel_id');

    // Get unique users in those channels
    const visibleUsers = await db('channel_members')
        .whereIn('channel_id', userChannels)
        .distinct('user_id')
        .pluck('user_id');

    // Batch presence updates
    const batch = [];
    for (const targetUserId of visibleUsers) {
        batch.push(redis.publish(
            `user:${targetUserId}:presence`,
            JSON.stringify({ userId, status })
        ));
    }
    await Promise.all(batch);
}
```

## Deep Dive: Search Architecture

### Elasticsearch Indexing

```javascript
// Async message indexing via queue
async function indexMessage(message) {
    await es.index({
        index: 'messages',
        id: message.id.toString(),
        body: {
            workspace_id: message.workspace_id,
            channel_id: message.channel_id,
            user_id: message.user_id,
            content: message.content,
            created_at: message.created_at
        }
    });
}

// Search with filters
async function searchMessages(workspaceId, query, filters) {
    return await es.search({
        index: 'messages',
        body: {
            query: {
                bool: {
                    must: [
                        { term: { workspace_id: workspaceId } },
                        { match: { content: query } }
                    ],
                    filter: [
                        filters.channelId && { term: { channel_id: filters.channelId } },
                        filters.userId && { term: { user_id: filters.userId } },
                        filters.dateRange && {
                            range: {
                                created_at: {
                                    gte: filters.from,
                                    lte: filters.to
                                }
                            }
                        }
                    ].filter(Boolean)
                }
            },
            highlight: { fields: { content: {} } }
        }
    });
}
```

### PostgreSQL Fallback

```javascript
// Fallback when Elasticsearch is unavailable
async function searchMessagesFallback(workspaceId, query) {
    return await db('messages')
        .where({ workspace_id: workspaceId })
        .whereRaw(
            "to_tsvector('english', content) @@ plainto_tsquery('english', ?)",
            [query]
        )
        .orderBy('created_at', 'desc')
        .limit(100);
}
```

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

```javascript
// Cache-aside for channel members (frequently accessed)
async function getChannelMembers(channelId) {
    const cacheKey = `channel:${channelId}:members`;

    // Check cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
        return JSON.parse(cached);
    }

    // Cache miss - fetch from database
    const members = await db('channel_members')
        .where({ channel_id: channelId })
        .join('users', 'users.id', 'channel_members.user_id')
        .select('users.id', 'users.username', 'users.avatar_url');

    // Populate cache
    await redis.setex(cacheKey, 120, JSON.stringify(members));

    return members;
}

// Invalidate on membership change
async function addChannelMember(channelId, userId) {
    await db('channel_members').insert({ channel_id: channelId, user_id: userId });
    await redis.del(`channel:${channelId}:members`);
}
```

## Idempotency for Message Sending

```javascript
// Prevent duplicate messages on client retry
async function sendMessageIdempotent(idempotencyKey, workspaceId, channelId, userId, content) {
    // Check for existing request
    const existing = await redis.get(`idem:${idempotencyKey}`);
    if (existing) {
        return JSON.parse(existing);  // Return cached response
    }

    // Process the message
    const message = await db.transaction(async (trx) => {
        const [msg] = await trx('messages').insert({
            workspace_id: workspaceId,
            channel_id: channelId,
            user_id: userId,
            content
        }).returning('*');

        return msg;
    });

    // Cache response for 24 hours
    await redis.setex(`idem:${idempotencyKey}`, 86400, JSON.stringify(message));

    return message;
}
```

## Rate Limiting

```javascript
// Sliding window rate limiter
async function checkRateLimit(key, limit, windowSec) {
    const now = Date.now();
    const windowStart = now - (windowSec * 1000);

    const multi = redis.multi();
    multi.zremrangebyscore(key, 0, windowStart);  // Remove old entries
    multi.zadd(key, now, `${now}:${Math.random()}`);  // Add current
    multi.zcard(key);  // Count in window
    multi.expire(key, windowSec);

    const results = await multi.exec();
    const count = results[2][1];

    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}
```

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

1. **Partitioning by Workspace**: Shard messages table by workspace_id
   ```sql
   CREATE TABLE messages_p0 PARTITION OF messages
       FOR VALUES WITH (MODULUS 4, REMAINDER 0);
   ```

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
