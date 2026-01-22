# WhatsApp - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## Opening Statement

"I'll design a real-time messaging platform like WhatsApp, covering both the frontend and backend with emphasis on how they integrate. The key full-stack challenges are establishing a robust WebSocket communication protocol, implementing end-to-end message delivery with status tracking across the stack, handling offline scenarios with both client-side caching and server-side queuing, and ensuring type safety across the API boundary. Let me start by clarifying requirements."

---

## 1. Requirements Clarification (3-4 minutes)

### Functional Requirements

1. **Real-Time Messaging**
   - Send/receive messages with < 100ms latency when both users online
   - Cross-server message routing when users connect to different servers
   - Delivery receipts (sent, delivered, read) synchronized across clients

2. **Offline Support**
   - Server queues messages for offline recipients
   - Client caches conversations and messages in IndexedDB
   - Client queues outgoing messages when disconnected
   - Full synchronization on reconnect

3. **Presence System**
   - Real-time online/offline status
   - Typing indicators with debouncing
   - Last seen timestamps

4. **Group Messaging**
   - Fan-out message delivery to multiple recipients
   - Group membership management
   - Efficient batch notifications

### Non-Functional Requirements

| Requirement | Target | Stack Responsibility |
|-------------|--------|----------------------|
| **Message Latency** | < 100ms (online-to-online) | Backend: Redis routing, Frontend: WebSocket |
| **Offline Capability** | Full read, queued writes | Backend: PostgreSQL queue, Frontend: IndexedDB |
| **Consistency** | At-least-once delivery | Backend: ACKs + DB, Frontend: Deduplication |
| **Scale** | 500 concurrent connections/server | Backend: Multiple instances, Frontend: Virtualization |

---

## 2. Full-Stack Architecture Overview (5-6 minutes)

### System Integration Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Frontend (React)                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │ WebSocket   │  │   Zustand   │  │  IndexedDB  │  │   Service   │          │
│  │  Provider   │◄─┤    Store    │◄─┤   (Dexie)   │  │   Worker    │          │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘          │
│         │                │                │                │                  │
└─────────┼────────────────┼────────────────┼────────────────┼──────────────────┘
          │ WebSocket      │ HTTP/REST      │                │
          │                │                │                │
          ▼                ▼                │                │
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Load Balancer (nginx)                              │
│                        Sticky Sessions for WebSocket                         │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   API Server 1  │    │   API Server 2  │    │   API Server 3  │
│   (Express+WS)  │◄───┤  Redis Pub/Sub  ├───►│   (Express+WS)  │
└────────┬────────┘    └────────┬────────┘    └────────┬────────┘
         │                      │                      │
         └──────────────────────┼──────────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
              ▼                 ▼                 ▼
     ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
     │   PostgreSQL    │ │   Redis/Valkey  │ │     MinIO       │
     │                 │ │                 │ │                 │
     │ - Users         │ │ - Sessions      │ │ - Images        │
     │ - Conversations │ │ - Presence      │ │ - Videos        │
     │ - Messages      │ │ - User→Server   │ │ - Documents     │
     │ - Status        │ │ - Pub/Sub       │ │                 │
     └─────────────────┘ └─────────────────┘ └─────────────────┘
```

### Shared TypeScript Types (API Contract)

The shared types directory contains interfaces used by both frontend and backend:

**Message**: id, conversationId, senderId, content, contentType (text | image | video | file), mediaUrl, replyToId, createdAt. Client-side adds: clientMessageId, status (sending | sent | delivered | read | failed).

**Conversation**: id, type (direct | group), name, participants array, lastMessage, unreadCount, updatedAt.

**Participant**: userId, username, displayName, avatarUrl, role (admin | member).

**WebSocket Message Types**:

```
┌────────────────────────────────────────────────────────────────┐
│                   WebSocket Protocol                            │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Client → Server (WSClientMessage)                             │
│  ├── message: { conversationId, content, contentType,         │
│  │              clientMessageId, mediaUrl?, replyToId? }       │
│  ├── typing: { conversationId }                                │
│  ├── ack: { messageId }                                        │
│  └── read: { conversationId, upToMessageId }                   │
│                                                                 │
│  Server → Client (WSServerMessage)                             │
│  ├── message: Message payload                                  │
│  ├── message_status: { messageId, status, userId }             │
│  ├── typing: { conversationId, userId, username, isTyping }    │
│  ├── presence: { userId, status, lastSeen }                    │
│  └── error: { code, message }                                  │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## 3. Deep Dive: Message Flow (8-10 minutes)

### End-to-End Message Delivery (Online-to-Online)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Complete Message Flow                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  Frontend (Sender)              Backend                 Frontend (Recipient) │
│        │                          │                            │             │
│  ┌─────┴─────┐                    │                            │             │
│  │ 1. User   │                    │                            │             │
│  │    types  │                    │                            │             │
│  │    message│                    │                            │             │
│  └─────┬─────┘                    │                            │             │
│        │                          │                            │             │
│  ┌─────┴─────┐                    │                            │             │
│  │ 2. Create │                    │                            │             │
│  │ clientId, │                    │                            │             │
│  │ optimistic│                    │                            │             │
│  │ add to UI │                    │                            │             │
│  └─────┬─────┘                    │                            │             │
│        │───WS: message───────────►│                            │             │
│        │                          │                            │             │
│        │                    ┌─────┴─────┐                      │             │
│        │                    │ 3. Persist│                      │             │
│        │                    │ to DB     │                      │             │
│        │                    │ status=   │                      │             │
│        │                    │ 'sent'    │                      │             │
│        │                    └─────┬─────┘                      │             │
│        │                          │                            │             │
│        │                    ┌─────┴─────┐                      │             │
│        │                    │ 4. Lookup │                      │             │
│        │                    │ recipient │                      │             │
│        │                    │ server in │                      │             │
│        │                    │ Redis     │                      │             │
│        │                    └─────┬─────┘                      │             │
│        │                          │                            │             │
│        │                          │ (Redis Pub/Sub if          │             │
│        │                          │  different server)         │             │
│        │                          │───WS: message─────────────►│             │
│        │                          │                            │             │
│        │                          │                      ┌─────┴─────┐       │
│        │                          │                      │ 5. Display│       │
│        │                          │                      │ dedupe by │       │
│        │                          │                      │ messageId │       │
│        │                          │                      └─────┬─────┘       │
│        │                          │◄────WS: ack────────────────│             │
│        │                          │                            │             │
│        │                    ┌─────┴─────┐                      │             │
│        │                    │ 6. Update │                      │             │
│        │                    │ status=   │                      │             │
│        │                    │ delivered │                      │             │
│        │                    └─────┬─────┘                      │             │
│        │◄───WS: message_status────│                            │             │
│        │     (delivered)          │                            │             │
│  ┌─────┴─────┐                    │                            │             │
│  │ 7. Update │                    │                            │             │
│  │ UI: double│                    │                            │             │
│  │ checkmark │                    │                            │             │
│  └───────────┘                    │                            │             │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Frontend: Sending a Message

The `useSendMessage` hook implements the send flow:

1. Generate clientMessageId with crypto.randomUUID()
2. Create optimistic message with status='sending', add to store
3. If socket disconnected: queue to IndexedDB pending messages with retryCount=0
4. If connected: send via WebSocket with type='message'

### Backend: Processing the Message

The message handler performs these steps:

1. **Validate Participation**: Query conversation_participants to verify sender is member
2. **Idempotency Check**: SETNX on `dedup:{clientMessageId}` key with 24h TTL; if exists, return cached message
3. **Persist to Database**: INSERT into messages table, RETURNING the new row
4. **Get Recipients**: Query other participants from conversation_participants
5. **Create Status Records**: INSERT message_status for each recipient with status='sent'
6. **Route to Recipients**: For each recipient, call routeToRecipient()
7. **Confirm to Sender**: Send message event back with status='sent'

### Cross-Server Message Routing

The routeToRecipient function handles delivery:

1. Lookup `session:{userId}` in Redis to get recipient's server ID
2. If no session: user offline, message stays in DB with 'sent' status
3. If same server: deliver directly via local WebSocket map
4. If different server: publish to `server:{serverId}` Redis channel with targetUserId and message

### Frontend: Receiving and Acknowledging

The WebSocket provider's message handler:

1. On 'message' event: Add to store (handles deduplication by messageId), send 'ack' event back, cache to IndexedDB
2. On 'message_status' event: Update message status in store (sent → delivered → read with checkmark icons)

### Backend: Processing Delivery ACK

The ack handler performs idempotent status update:

1. UPDATE message_status SET status='delivered' WHERE message_id=$1 AND recipient_id=$2 AND status='sent'
2. If no rows updated: already delivered or read, skip
3. Query sender_id from messages table
4. Route message_status notification to sender

---

## 4. Deep Dive: Offline Sync (6-7 minutes)

### Offline Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Offline Sync Architecture                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  User Goes Offline                              User Comes Online            │
│        │                                              │                      │
│        ▼                                              ▼                      │
│  ┌───────────┐                                  ┌───────────┐                │
│  │ WebSocket │                                  │ WebSocket │                │
│  │  Closes   │                                  │ Reconnects│                │
│  └─────┬─────┘                                  └─────┬─────┘                │
│        │                                              │                      │
│        ▼                                              ▼                      │
│  ┌───────────┐                                  ┌───────────┐                │
│  │ Queue new │                                  │ Sync from │                │
│  │ messages  │                                  │ IndexedDB │                │
│  │ to        │                                  │ pending   │                │
│  │ IndexedDB │                                  │ queue     │                │
│  └─────┬─────┘                                  └─────┬─────┘                │
│        │                                              │                      │
│        ▼                                              ▼                      │
│  ┌───────────┐                               ┌───────────────────┐           │
│  │ Show from │                               │ Backend: Fetch    │           │
│  │ cached    │                               │ messages since    │           │
│  │ messages  │                               │ last sync         │           │
│  └───────────┘                               └─────────┬─────────┘           │
│                                                        │                     │
│                                                        ▼                     │
│                                              ┌───────────────────┐           │
│                                              │ Merge server      │           │
│                                              │ messages with     │           │
│                                              │ local cache       │           │
│                                              └───────────────────┘           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Frontend: Offline Queue and Sync (OfflineSyncService)

**queueMessage(message)**: Add to IndexedDB pendingMessages table with status='pending'.

**syncPendingMessages(socket)**:
1. Query pendingMessages where status='pending'
2. For each message: update status to 'sending', send via WebSocket, delete on success
3. On error: increment retryCount; if >= 3, mark as 'failed', else reset to 'pending'

**fetchMissedMessages(conversationId)**:
1. Get lastSyncAt from syncMetadata table
2. Fetch `/api/v1/conversations/{id}/messages?since={lastSyncAt}`
3. Bulk cache returned messages
4. Update syncMetadata with current timestamp

**getCachedMessages(conversationId)**: Query messages table by conversationId, sorted by createdAt descending.

### Backend: Pending Message Delivery on Connect

The handleUserConnect function:

1. Register session: SET `session:{userId}` to SERVER_ID
2. Update presence: HSET `presence:{userId}` with status='online', server, lastSeen
3. Store WebSocket in connections map
4. Query pending messages: SELECT from messages JOIN message_status WHERE recipient_id=$1 AND status='sent' ORDER BY created_at
5. Send each pending message via WebSocket
6. Broadcast presence change to interested users

The handleUserDisconnect function:

1. DEL `session:{userId}`
2. HSET `presence:{userId}` with status='offline', lastSeen
3. Delete from connections map
4. Broadcast presence change

### Backend: Messages Since Timestamp API

The GET /conversations/:id/messages endpoint:

- **since** parameter: Fetch messages after timestamp (for offline sync), ORDER BY created_at ASC
- **before** parameter: Pagination for infinite scroll, ORDER BY created_at DESC
- Default: Latest messages, ORDER BY created_at DESC
- All queries join message_status for delivery_status per recipient
- Returns { messages, hasMore } where hasMore indicates if limit was reached

---

## 5. Deep Dive: Typing Indicators (4-5 minutes)

### End-to-End Typing Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Typing Indicator Flow                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Frontend (Typer)              Backend                 Frontend (Viewer)    │
│        │                          │                          │              │
│        │──user types──            │                          │              │
│        │              │           │                          │              │
│        │──debounce 2s─┤           │                          │              │
│        │              │           │                          │              │
│        │◄─────────────┘           │                          │              │
│        │                          │                          │              │
│        │───WS: typing────────────►│                          │              │
│        │                          │                          │              │
│        │                    ┌─────┴─────┐                    │              │
│        │                    │ SETEX     │                    │              │
│        │                    │ typing:   │                    │              │
│        │                    │ conv:user │                    │              │
│        │                    │ TTL=3s    │                    │              │
│        │                    └─────┬─────┘                    │              │
│        │                          │                          │              │
│        │                          │───WS: typing────────────►│              │
│        │                          │                          │              │
│        │                          │                    ┌─────┴─────┐        │
│        │                          │                    │ Show      │        │
│        │                          │                    │ "typing"  │        │
│        │                          │                    │ indicator │        │
│        │                          │                    └─────┬─────┘        │
│        │                          │                          │              │
│        │──stops typing──          │                          │              │
│        │                          │                          │              │
│        │                    ┌─────┴─────┐                    │              │
│        │                    │ TTL       │                    │              │
│        │                    │ expires   │                    │              │
│        │                    │ (3s)      │                    │              │
│        │                    └─────┬─────┘                    │              │
│        │                          │                          │              │
│        │                          │───WS: typing=false──────►│              │
│        │                          │                          │              │
│        │                          │                    ┌─────┴─────┐        │
│        │                          │                    │ Hide      │        │
│        │                          │                    │ indicator │        │
│        │                          │                    └───────────┘        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Frontend: Debounced Typing Events

The `useTypingIndicator` hook:

- Maintains lastTypingSent ref with TYPING_INTERVAL=2000ms
- On input change: if elapsed >= 2s, send 'typing' event and update timestamp
- This prevents spamming typing events on every keystroke

### Backend: Typing Handler with Redis TTL

The handleTyping function:

1. SETEX `typing:{conversationId}:{userId}` with 3s TTL
2. Query username from users table
3. Broadcast 'typing' event to all other participants with isTyping=true
4. If this was a new typing session (key didn't exist), schedule stop notification in 3.5s
5. When timeout fires: check if key still exists; if not, broadcast isTyping=false

### Frontend: Displaying Typing Indicators

The Zustand store maintains `typingUsers: Record<conversationId, Map<userId, { username, timestamp }>>`.

The setTypingUser action:
- If isTyping=true: add to Map with current timestamp
- If isTyping=false: delete from Map

The TypingIndicator component:
- Renders nothing if Map is empty
- Shows "Alice is typing..." or "Alice, Bob are typing..." with bouncing dots

---

## 6. Deep Dive: Read Receipts (4-5 minutes)

### Read Receipt Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Read Receipt Flow                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Recipient opens chat                                                        │
│        │                                                                     │
│        ▼                                                                     │
│  ┌───────────────┐                                                          │
│  │ Frontend:     │                                                          │
│  │ Mark messages │                                                          │
│  │ as read up to │                                                          │
│  │ last visible  │                                                          │
│  └───────┬───────┘                                                          │
│          │                                                                   │
│          │───WS: read (conversationId, upToMessageId)────►                  │
│          │                                               │                   │
│          │                                         ┌─────┴─────┐            │
│          │                                         │ Backend:  │            │
│          │                                         │ UPDATE    │            │
│          │                                         │ all status│            │
│          │                                         │ <= msgId  │            │
│          │                                         │ to 'read' │            │
│          │                                         └─────┬─────┘            │
│          │                                               │                   │
│          │                                               │───WS: status───► │
│          │                                               │   (to sender)    │
│          │                                               │                   │
│          │                                         ┌─────┴─────┐            │
│          │                                         │ Sender UI:│            │
│          │                                         │ Blue ticks│            │
│          │                                         └───────────┘            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Frontend: Sending Read Receipts

The `useReadReceipts` hook uses IntersectionObserver:

1. Create observer with threshold=0.5
2. On intersection: collect visible message IDs, find latest
3. Debounce 500ms to avoid spamming
4. Send 'read' event with conversationId and upToMessageId
5. Track lastSentReadReceipt to avoid duplicate sends

### Backend: Batch Read Status Update

The handleRead function:

1. Get created_at timestamp for upToMessageId
2. Batch UPDATE message_status SET status='read' for all messages in conversation where created_at <= upToTimestamp AND status != 'read' AND recipient_id = userId
3. UPDATE conversation_participants SET last_read_at = upToTimestamp
4. Group updated messages by sender_id
5. Route message_status notifications to each sender

---

## 7. API Design and Validation (4-5 minutes)

### Zod Schemas for Validation

The shared schemas define validation for all WebSocket messages:

**SendMessageSchema**: conversationId (uuid), content (1-10000 chars), contentType (enum), clientMessageId (uuid), mediaUrl (optional url), replyToId (optional uuid).

**WSClientMessageSchema**: Discriminated union on 'type' field covering message, typing, read, and ack payloads.

### Backend WebSocket Message Router

The router parses incoming JSON, validates against WSClientMessageSchema:
- On parse error: send error with code='INVALID_JSON'
- On validation error: send error with code='VALIDATION_ERROR' and first issue message
- On success: route to appropriate handler (handleMessage, handleTyping, handleRead, handleAck)

### Frontend API Client

The ApiClient class provides type-safe HTTP methods:

**Core request() method**: Adds credentials='include' for session cookies, sets Content-Type, throws ApiError on non-ok response.

**Methods**:
- getConversations() → Conversation[]
- createConversation(participantIds, type, name?) → Conversation
- getMessages(conversationId, { before?, since?, limit? }) → { messages, hasMore }
- addReaction(conversationId, messageId, emoji) → void

---

## 8. Trade-offs and Alternatives (3-4 minutes)

### Architecture Decisions

| Decision | Trade-off | Alternative |
|----------|-----------|-------------|
| **WebSocket for all real-time** | Stateful connections, need sticky LB | Socket.IO (auto-fallback but larger) |
| **Redis Pub/Sub for cross-server** | No persistence, fire-and-forget | Kafka (durable but more complex) |
| **PostgreSQL for messages** | Simpler, limited write scale | Cassandra (better writes, more ops) |
| **IndexedDB for offline** | Browser-specific, 50MB limit | LocalStorage (simpler but 5MB) |
| **Zod for validation** | Runtime cost, bundle size | io-ts (FP style), ajv (faster) |

### Scaling Considerations

| Component | Current | Scaling Path |
|-----------|---------|--------------|
| WebSocket servers | 3 instances | Auto-scale based on connection count |
| PostgreSQL | Single node | Read replicas, then shard by conversation |
| Redis | Single node | Redis Cluster for HA |
| Offline storage | IndexedDB | Consider reducing TTL as DB grows |

### When to Reconsider

- **Add Kafka**: When message durability is critical or need replay
- **Add Cassandra**: When write throughput exceeds 1K messages/sec
- **Add CDN**: When serving media to distributed users
- **Add push notifications**: When mobile app requires background delivery

---

## 9. Testing Strategy (2-3 minutes)

### Integration Test Approach

Tests use WebSocket connections with test users and conversations:

**Setup**: setupTestDb(), createTestUser() for sender and recipient, createConversation(), connectAsUser() for WebSocket connections.

**Key Test Cases**:

1. **Message delivery flow**: Sender sends message via WebSocket, verify recipient receives it, recipient sends ACK, verify sender receives 'delivered' status.

2. **Offline message delivery**: Disconnect recipient, send message, reconnect recipient, verify pending message is delivered on connect.

3. **Read receipt batch update**: Open conversation, send read event, verify all older messages marked as read, verify sender receives status updates.

---

## Summary

The full-stack WhatsApp design integrates:

1. **Shared Type System**: TypeScript types and Zod schemas ensure consistency between frontend and backend

2. **WebSocket Protocol**: Bidirectional real-time communication with message, typing, presence, and ACK events

3. **Message Delivery Pipeline**: Optimistic UI updates, server persistence, cross-server routing, delivery receipts

4. **Offline Architecture**: Frontend IndexedDB queue + cache, backend pending message delivery on reconnect

5. **Status Synchronization**: Idempotent status transitions (sent → delivered → read) with batched updates

The architecture supports reliable message delivery with seamless offline capability while maintaining type safety across the stack.
