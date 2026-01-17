# Design Slack - System Design Interview Answer

## Introduction (2 minutes)

"Thanks for having me. Today I'll design Slack, a team communication platform. Slack is interesting because it combines real-time messaging at scale, workspace isolation for enterprise customers, and a robust integration platform.

The core technical challenges are:
1. Real-time message delivery to thousands of concurrent users per workspace
2. Threading and reply models that scale to busy channels
3. Workspace-level data isolation for enterprise security
4. A search system that spans millions of messages

Let me clarify the requirements first."

---

## Requirements Clarification (5 minutes)

### Functional Requirements

"For our core product, I'd focus on:

1. **Workspaces**: Isolated team environments with their own users, channels, and data
2. **Channels**: Organized conversations that can be public or private
3. **Messaging**: Send, edit, delete messages with rich formatting and attachments
4. **Threading**: Reply to specific messages, keeping context together
5. **Search**: Find messages across the entire workspace with filters

I'll also touch on presence (online/away status) and integrations (webhooks, bots)."

### Non-Functional Requirements

"Let's establish our scale targets:

- **Message Delivery Latency**: Under 200ms from send to delivery
- **Availability**: 99.99% for the messaging system - this is critical infrastructure
- **Scale**: 10 million workspaces, 1 billion messages per day
- **Message Ordering**: Messages must appear in consistent order across all clients

The ordering requirement is crucial - in a team communication tool, seeing messages out of order would be confusing and could cause business issues."

---

## High-Level Design (10 minutes)

### Architecture Overview

"Here's my proposed architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Client Layer                                │
│       Desktop App │ Web │ Mobile (React Native)                 │
└─────────────────────────────────────────────────────────────────┘
                              │ WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Gateway Cluster                              │
│         (WebSocket management, presence, routing)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Message Service                              │
│              - Send - Threads - Reactions                       │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  PostgreSQL   │    │   Valkey      │    │ Elasticsearch │
│  - Messages   │    │ - Connections │    │ - Search index│
│  - Channels   │    │ - Presence    │    │               │
│  - Workspaces │    │ - Pub/Sub     │    │               │
└───────────────┘    └───────────────┘    └───────────────┘
```

Let me explain each component."

### Gateway Cluster

"The Gateway cluster manages WebSocket connections. When a user opens Slack, they establish a persistent WebSocket connection to a gateway server.

Key responsibilities:
- **Connection Management**: Track which users are connected to which gateway
- **Message Routing**: When a message needs to be delivered, route it to the right gateway
- **Presence**: Track online/away status using heartbeats

The gateways are stateless except for the WebSocket connections themselves. Connection state is stored in Valkey so any gateway can route messages to any user."

### Message Service

"The Message Service handles the business logic for messaging:
- Validate message content and permissions
- Persist to PostgreSQL
- Trigger delivery through the pub/sub system
- Queue messages for search indexing

This is a standard stateless service that can scale horizontally."

### Data Layer

"We have three main data stores:

1. **PostgreSQL**: Source of truth for messages, channels, users, workspaces
2. **Valkey (Redis-compatible)**: Real-time data - connections, presence, pub/sub for message delivery
3. **Elasticsearch**: Full-text search across messages

Each serves a specific purpose based on access patterns."

---

## Deep Dive: Message Model & Threading (8 minutes)

### Message Schema

"Here's our core message model:

```sql
CREATE TABLE messages (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL,
  channel_id UUID REFERENCES channels(id),
  user_id UUID REFERENCES users(id),

  -- Threading support
  thread_ts BIGINT,  -- NULL for top-level, parent ID for replies
  reply_count INTEGER DEFAULT 0,
  latest_reply TIMESTAMP,
  reply_users UUID[],  -- Users who replied

  content TEXT NOT NULL,
  attachments JSONB,
  edited_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_messages_channel ON messages(channel_id, created_at DESC);
CREATE INDEX idx_messages_thread ON messages(thread_ts) WHERE thread_ts IS NOT NULL;
```

The key design decision here is how we model threads."

### Threading Approach

"Threads are replies that reference a parent message. When you reply to a message, we set `thread_ts` to the parent message ID.

This is simpler than a separate threads table because:
1. A thread reply is still a message - same data model, same delivery path
2. The parent message contains denormalized thread metadata (reply count, participants)
3. Queries are straightforward: get channel messages, get thread replies

```javascript
async function getThread(messageTs) {
  const parent = await db('messages').where({ id: messageTs }).first()
  const replies = await db('messages')
    .where({ thread_ts: messageTs })
    .orderBy('created_at', 'asc')

  return { parent, replies }
}
```

The tradeoff is we need to update the parent message's metadata on each reply, but that's acceptable for the query simplicity we gain."

---

## Deep Dive: Real-Time Message Delivery (10 minutes)

### Delivery Flow

"When a user sends a message, here's the full flow:

```javascript
async function sendMessage(workspaceId, channelId, userId, content) {
  // 1. Persist the message
  const message = await db('messages').insert({
    workspace_id: workspaceId,
    channel_id: channelId,
    user_id: userId,
    content
  }).returning('*')

  // 2. Get channel members
  const members = await db('channel_members')
    .where({ channel_id: channelId })
    .pluck('user_id')

  // 3. Publish to each member's subscription channel
  for (const memberId of members) {
    await redis.publish(
      `user:${memberId}:messages`,
      JSON.stringify(message)
    )
  }

  // 4. Queue for search indexing (async)
  await searchQueue.add({ type: 'index_message', message })

  return message
}
```

The key insight is we're using Valkey pub/sub to fan out messages to users."

### Gateway Subscription

"Each gateway subscribes to message channels for connected users:

```javascript
gateway.on('connection', async (ws, userId) => {
  const subscriber = redis.duplicate()
  await subscriber.subscribe(`user:${userId}:messages`)

  subscriber.on('message', (channel, data) => {
    ws.send(data)
  })
})
```

This architecture scales well because:
- Gateways are stateless and can be added/removed
- Valkey pub/sub handles the routing
- Each user has their own subscription channel"

### Why User-Level Pub/Sub?

"You might ask: why not publish to channel-level topics instead of user-level?

The problem is that a user might be in 50+ channels. If we used channel-level pub/sub, each gateway would need to track which channels each connected user is in, and filter messages accordingly.

With user-level pub/sub, the message service does the fan-out once, and gateways just forward everything they receive. Simpler gateway logic, cleaner separation of concerns."

---

## Deep Dive: Presence System (5 minutes)

### Tracking Online Status

"Presence is surprisingly tricky at scale. Here's our approach:

```javascript
// Client sends heartbeat every 30 seconds
async function heartbeat(userId, workspaceId) {
  // Set presence with 60-second TTL
  await redis.setex(
    `presence:${workspaceId}:${userId}`,
    60,
    JSON.stringify({ status: 'online', lastSeen: Date.now() })
  )

  // Broadcast presence change to workspace
  await broadcastPresence(workspaceId, userId, 'online')
}
```

Using TTL keys means if a user disconnects (even ungracefully), their presence automatically expires. No cleanup job needed."

### Presence at Scale

"For a large workspace with 100,000 users, we can't broadcast every presence change to everyone. We optimize by:

1. Only broadcast to users who have the person visible (same channel, DM, etc.)
2. Batch presence updates - collect changes over 5 seconds and send in bulk
3. Only send deltas - 'user X went offline' rather than full presence list

```javascript
async function getOnlineUsers(workspaceId) {
  const keys = await redis.keys(`presence:${workspaceId}:*`)
  return keys.map(k => k.split(':')[2])
}
```

For very large workspaces, we'd use Redis SCAN instead of KEYS to avoid blocking."

---

## Deep Dive: Search (5 minutes)

### Message Indexing

"We use Elasticsearch for search because:
- Full-text search with relevance ranking
- Complex filters (by channel, user, date range)
- Scales to billions of documents

```javascript
async function indexMessage(message) {
  await es.index({
    index: 'messages',
    id: message.id,
    body: {
      workspace_id: message.workspace_id,
      channel_id: message.channel_id,
      user_id: message.user_id,
      content: message.content,
      created_at: message.created_at
    }
  })
}
```

Indexing happens asynchronously through a queue, so it doesn't slow down message delivery."

### Search Query

"Search queries translate to Elasticsearch:

```javascript
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
              range: { created_at: { gte: filters.from, lte: filters.to } }
            }
          ].filter(Boolean)
        }
      },
      highlight: { fields: { content: {} } }
    }
  })
}
```

Notice we always filter by workspace_id first - this is our isolation boundary."

---

## Deep Dive: Integrations (3 minutes)

### Incoming Webhooks

"Slack's power comes from integrations. Here's how incoming webhooks work:

```javascript
// Generate webhook URL
async function createWebhook(workspaceId, channelId) {
  const token = crypto.randomBytes(32).toString('hex')

  await db('webhooks').insert({
    workspace_id: workspaceId,
    channel_id: channelId,
    token
  })

  return `https://hooks.slack.com/services/${workspaceId}/${channelId}/${token}`
}

// Handle incoming webhook
app.post('/services/:workspace/:channel/:token', async (req, res) => {
  const webhook = await db('webhooks')
    .where({
      workspace_id: req.params.workspace,
      channel_id: req.params.channel,
      token: req.params.token
    })
    .first()

  if (!webhook) return res.status(404).send('Not found')

  await sendMessage(
    webhook.workspace_id,
    webhook.channel_id,
    SYSTEM_USER_ID,
    req.body.text
  )

  res.status(200).send('ok')
})
```

The token in the URL provides authentication. External services just POST JSON to the URL."

---

## Trade-offs and Alternatives (2 minutes)

"Let me summarize key decisions:

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Threading | Parent reference | Separate table | Simpler queries, same delivery path |
| Delivery | Valkey pub/sub | Direct push | Decouples storage from delivery |
| Presence | TTL keys | Database | Auto-cleanup, speed |
| Search | Elasticsearch | PostgreSQL FTS | Scale, features, complexity of queries |

If I had more time, I'd discuss:
- Message retention and archival policies
- Rate limiting and abuse prevention
- Message edit history and compliance features
- Sharding strategy for very large workspaces"

---

## Summary

"To summarize, I've designed Slack with:

1. **Gateway cluster** for WebSocket management with stateless scaling
2. **Valkey pub/sub** for real-time message fan-out to users
3. **Thread model** using parent references for simplicity
4. **Presence system** using TTL keys for automatic cleanup
5. **Elasticsearch** for powerful workspace-scoped search
6. **Webhook system** for extensible integrations

The architecture prioritizes real-time delivery performance while maintaining workspace isolation for enterprise security.

What aspects would you like me to dive deeper into?"
