# Slack - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## Problem Statement

Design a team messaging platform that allows users to:
- Send and receive messages in real-time
- Organize conversations into channels and threads
- Search across message history
- Manage multiple workspaces

This answer covers the end-to-end architecture, emphasizing the integration between frontend and backend components.

## Requirements Clarification

### Functional Requirements
1. **Workspaces**: Isolated team environments with role-based access
2. **Channels**: Public/private channels with membership management
3. **Real-Time Messaging**: Instant message delivery with optimistic UI
4. **Threading**: Reply to specific messages with context preservation
5. **Search**: Full-text search with filters

### Non-Functional Requirements
1. **Low Latency**: Message delivery < 200ms, UI response < 100ms
2. **Consistency**: Messages appear in order across all clients
3. **Availability**: 99.99% uptime for messaging
4. **Scalability**: Support millions of concurrent users

### Scale Estimates
- 10M workspaces, avg 100 users/workspace
- 1B messages/day = ~12K messages/sec
- Read-heavy: 100:1 read:write ratio

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Browser (React Application)                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Components: ChannelSidebar | MessageList | Composer | ThreadPanel│  │
│  └───────────────────────────┬───────────────────────────────────────┘  │
│  ┌───────────────────────────┴───────────────────────────────────────┐  │
│  │  Zustand Store: workspaces, channels, messages, presence, typing  │  │
│  └───────────────────────────┬───────────────────────────────────────┘  │
│  ┌───────────────────────────┴───────────────────────────────────────┐  │
│  │  WebSocket Client + REST API Service                              │  │
│  └───────────────────────────┬───────────────────────────────────────┘  │
└──────────────────────────────┼───────────────────────────────────────────┘
                               │ WebSocket + REST API
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Gateway Cluster (WebSocket)                       │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Connection Manager | Message Router | Presence Tracker           │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Message Service (REST)                            │
│  ┌────────────────┐  ┌──────────────────┐  ┌───────────────────────┐   │
│  │  auth.ts       │  │  channels.ts      │  │  messages.ts          │   │
│  │  - login       │  │  - list           │  │  - send (+ fan-out)   │   │
│  │  - logout      │  │  - create         │  │  - edit               │   │
│  │  - register    │  │  - join/leave     │  │  - delete             │   │
│  └────────────────┘  └──────────────────┘  └───────────────────────┘   │
└─────────────────────────────┬───────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Data Layer                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │  PostgreSQL  │  │    Valkey    │  │Elasticsearch │                  │
│  │  (messages,  │  │  (pub/sub,   │  │  (search     │                  │
│  │  channels)   │  │  presence)   │  │  index)      │                  │
│  └──────────────┘  └──────────────┘  └──────────────┘                  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Data Model

### Database Schema

```sql
-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    username VARCHAR(100) NOT NULL,
    display_name VARCHAR(200) NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workspaces
CREATE TABLE workspaces (
    id UUID PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    domain VARCHAR(100) UNIQUE,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workspace members
CREATE TABLE workspace_members (
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'member'
        CHECK (role IN ('owner', 'admin', 'member', 'guest')),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);

-- Channels
CREATE TABLE channels (
    id UUID PRIMARY KEY,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    topic TEXT,
    is_private BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workspace_id, name)
);

-- Messages with threading
CREATE TABLE messages (
    id BIGSERIAL PRIMARY KEY,
    workspace_id UUID REFERENCES workspaces(id),
    channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    thread_ts BIGINT REFERENCES messages(id),
    content TEXT NOT NULL,
    reply_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    edited_at TIMESTAMPTZ
);

CREATE INDEX idx_messages_channel ON messages(channel_id, created_at DESC);
CREATE INDEX idx_messages_thread ON messages(thread_ts) WHERE thread_ts IS NOT NULL;
```

### TypeScript Interfaces (Shared Types)

```typescript
// shared/types.ts - Used by both frontend and backend

interface User {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url?: string;
}

interface Workspace {
  id: string;
  name: string;
  domain?: string;
}

interface Channel {
  id: string;
  workspace_id: string;
  name: string;
  topic?: string;
  is_private: boolean;
}

interface Message {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  thread_ts?: string;
  reply_count: number;
  created_at: string;
  edited_at?: string;
  // Frontend-only fields
  pending?: boolean;
  failed?: boolean;
}

interface WebSocketMessage {
  type: 'message' | 'presence' | 'typing' | 'reaction_added';
  [key: string]: any;
}
```

## Deep Dive: Real-Time Message Flow

### End-to-End Message Delivery

```
User A types message
        │
        ▼
┌─────────────────┐
│  MessageComposer │  (React Component)
│  - Optimistic UI │
│  - Send to API   │
└────────┬────────┘
         │ POST /api/messages
         ▼
┌─────────────────┐
│  Message Service │  (Express Route)
│  - Validate      │
│  - Store to DB   │
│  - Fan-out       │
└────────┬────────┘
         │ PUBLISH user:{id}:messages
         ▼
┌─────────────────┐
│  Valkey Pub/Sub  │
│  - Route to      │
│    subscribers   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Gateway Server  │
│  - WebSocket     │
│    connection    │
└────────┬────────┘
         │ ws.send(message)
         ▼
┌─────────────────┐
│  User B Browser  │
│  - Zustand store │
│  - MessageList   │
│    re-renders    │
└─────────────────┘
```

### Backend: Message Send Handler

```typescript
// Backend: routes/messages.ts
router.post('/channels/:channelId/messages', async (req, res) => {
  const { channelId } = req.params;
  const { content, idempotency_key } = req.body;
  const userId = req.session.userId;

  // 1. Idempotency check
  if (idempotency_key) {
    const existing = await redis.get(`idem:${idempotency_key}`);
    if (existing) {
      return res.json(JSON.parse(existing));
    }
  }

  // 2. Verify channel membership
  const membership = await db('channel_members')
    .where({ channel_id: channelId, user_id: userId })
    .first();

  if (!membership) {
    return res.status(403).json({ error: 'Not a channel member' });
  }

  // 3. Insert message
  const [message] = await db('messages')
    .insert({
      channel_id: channelId,
      user_id: userId,
      content,
      workspace_id: membership.workspace_id,
    })
    .returning('*');

  // 4. Fan-out to channel members
  const members = await db('channel_members')
    .where({ channel_id: channelId })
    .pluck('user_id');

  for (const memberId of members) {
    await redis.publish(
      `user:${memberId}:messages`,
      JSON.stringify({ type: 'message', message })
    );
  }

  // 5. Queue for search indexing
  await searchQueue.add({ type: 'index_message', message });

  // 6. Cache idempotency key
  if (idempotency_key) {
    await redis.setex(`idem:${idempotency_key}`, 86400, JSON.stringify(message));
  }

  res.status(201).json(message);
});
```

### Frontend: Optimistic Message Send

```tsx
// Frontend: components/MessageComposer.tsx
function MessageComposer({ channelId }: { channelId: string }) {
  const [content, setContent] = useState('');
  const addMessage = useSlackStore((state) => state.addMessage);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    // Generate idempotency key
    const idempotencyKey = `msg:${channelId}:${Date.now()}`;

    // Optimistic update
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: Message = {
      id: tempId,
      channel_id: channelId,
      user_id: currentUserId,
      content: content.trim(),
      created_at: new Date().toISOString(),
      reply_count: 0,
      pending: true,
    };

    addMessage(channelId, optimisticMessage);
    setContent('');

    try {
      const realMessage = await api.sendMessage(channelId, {
        content: content.trim(),
        idempotency_key: idempotencyKey,
      });

      // Replace optimistic message with real one
      useSlackStore.setState((state) => ({
        messages: {
          ...state.messages,
          [channelId]: state.messages[channelId].map((m) =>
            m.id === tempId ? realMessage : m
          ),
        },
      }));
    } catch (error) {
      // Mark as failed
      useSlackStore.setState((state) => ({
        messages: {
          ...state.messages,
          [channelId]: state.messages[channelId].map((m) =>
            m.id === tempId ? { ...m, failed: true, pending: false } : m
          ),
        },
      }));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-t p-4">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={`Message #${channelName}`}
        className="w-full p-2 border rounded"
      />
      <button type="submit" className="mt-2 px-4 py-2 bg-blue-500 text-white rounded">
        Send
      </button>
    </form>
  );
}
```

### Frontend: WebSocket Integration

```tsx
// Frontend: hooks/useWebSocket.ts
function useWebSocket() {
  const addMessage = useSlackStore((state) => state.addMessage);
  const setPresence = useSlackStore((state) => state.setPresence);

  useEffect(() => {
    const ws = new WebSocket('wss://api.slack.local/ws');

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'message':
          // Don't add if it's our own message (already optimistically added)
          if (data.message.user_id !== currentUserId) {
            addMessage(data.message.channel_id, data.message);
          }
          break;

        case 'presence':
          setPresence(data.user_id, data.status);
          break;

        case 'typing':
          setTyping(data.channel_id, data.user_id);
          break;
      }
    };

    return () => ws.close();
  }, []);
}
```

## Deep Dive: Thread Implementation

### Backend: Thread Reply

```typescript
// Backend: routes/messages.ts
router.post('/messages/:messageId/replies', async (req, res) => {
  const { messageId } = req.params;
  const { content } = req.body;
  const userId = req.session.userId;

  // Get parent message
  const parent = await db('messages').where({ id: messageId }).first();
  if (!parent) {
    return res.status(404).json({ error: 'Message not found' });
  }

  // Transaction: insert reply + update parent reply_count
  const [reply] = await db.transaction(async (trx) => {
    const [newReply] = await trx('messages')
      .insert({
        channel_id: parent.channel_id,
        workspace_id: parent.workspace_id,
        user_id: userId,
        thread_ts: messageId,
        content,
      })
      .returning('*');

    await trx('messages')
      .where({ id: messageId })
      .increment('reply_count', 1);

    return [newReply];
  });

  // Fan-out to thread participants + channel members
  await fanOutThreadReply(parent, reply);

  res.status(201).json(reply);
});
```

### Frontend: Thread Panel

```tsx
// Frontend: components/ThreadPanel.tsx
function ThreadPanel() {
  const activeThreadId = useSlackStore((state) => state.activeThreadId);
  const closeThread = useSlackStore((state) => state.closeThread);
  const [replies, setReplies] = useState<Message[]>([]);

  // Fetch thread replies
  useEffect(() => {
    if (!activeThreadId) return;

    api.getThreadReplies(activeThreadId).then(setReplies);
  }, [activeThreadId]);

  // Listen for new replies via WebSocket
  useEffect(() => {
    function handleReply(data: WebSocketMessage) {
      if (data.type === 'message' && data.message.thread_ts === activeThreadId) {
        setReplies((prev) => [...prev, data.message]);
      }
    }

    wsEvents.on('message', handleReply);
    return () => wsEvents.off('message', handleReply);
  }, [activeThreadId]);

  if (!activeThreadId) return null;

  return (
    <div className="w-96 border-l flex flex-col">
      <header className="p-4 border-b flex justify-between">
        <h3 className="font-bold">Thread</h3>
        <button onClick={closeThread}>Close</button>
      </header>

      <div className="flex-1 overflow-auto">
        {replies.map((reply) => (
          <MessageItem key={reply.id} message={reply} />
        ))}
      </div>

      <ThreadComposer parentId={activeThreadId} />
    </div>
  );
}
```

## Deep Dive: Presence System

### Backend: Presence Tracking

```typescript
// Backend: routes/presence.ts

// Called by WebSocket gateway on heartbeat
async function updatePresence(userId: string, workspaceId: string) {
  // Set presence with 60-second TTL
  await redis.setex(
    `presence:${workspaceId}:${userId}`,
    60,
    JSON.stringify({ status: 'online', lastSeen: Date.now() })
  );

  // Broadcast to users who can see this person
  await broadcastPresenceChange(workspaceId, userId, 'online');
}

// Get online users for a workspace
async function getOnlineUsers(workspaceId: string): Promise<string[]> {
  const keys: string[] = [];
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

  return keys.map((k) => k.split(':')[2]);
}
```

### Frontend: Presence Display

```tsx
// Frontend: components/PresenceIndicator.tsx
function PresenceIndicator({ userId }: { userId: string }) {
  const isOnline = useSlackStore((state) => state.onlineUsers.has(userId));

  return (
    <span
      className={cn(
        'w-2 h-2 rounded-full',
        isOnline ? 'bg-green-500' : 'bg-gray-400'
      )}
      aria-label={isOnline ? 'Online' : 'Offline'}
    />
  );
}

// In the channel sidebar
function ChannelItem({ channel }: { channel: Channel }) {
  return (
    <button className="flex items-center gap-2 px-3 py-1 w-full hover:bg-gray-100">
      {channel.is_dm ? (
        <PresenceIndicator userId={channel.other_user_id} />
      ) : (
        <HashIcon className="w-4 h-4" />
      )}
      <span>{channel.name}</span>
    </button>
  );
}
```

## Deep Dive: Search

### Backend: Search API

```typescript
// Backend: routes/search.ts
router.get('/search', async (req, res) => {
  const { q, channel_id, user_id, from, to } = req.query;
  const workspaceId = req.session.workspaceId;

  try {
    const results = await es.search({
      index: 'messages',
      body: {
        query: {
          bool: {
            must: [
              { term: { workspace_id: workspaceId } },
              { match: { content: q } },
            ],
            filter: [
              channel_id && { term: { channel_id } },
              user_id && { term: { user_id } },
              (from || to) && {
                range: {
                  created_at: {
                    ...(from && { gte: from }),
                    ...(to && { lte: to }),
                  },
                },
              },
            ].filter(Boolean),
          },
        },
        highlight: { fields: { content: {} } },
      },
    });

    res.json({
      messages: results.hits.hits.map((hit) => ({
        ...hit._source,
        highlight: hit.highlight?.content?.[0],
      })),
      total: results.hits.total.value,
    });
  } catch (error) {
    // Fallback to PostgreSQL FTS
    const results = await db('messages')
      .where({ workspace_id: workspaceId })
      .whereRaw(
        "to_tsvector('english', content) @@ plainto_tsquery('english', ?)",
        [q]
      )
      .limit(50);

    res.json({ messages: results, total: results.length });
  }
});
```

### Frontend: Search UI

```tsx
// Frontend: components/SearchModal.tsx
function SearchModal() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Debounced search
  const debouncedSearch = useMemo(
    () =>
      debounce(async (q: string) => {
        if (!q.trim()) {
          setResults([]);
          return;
        }

        setIsLoading(true);
        try {
          const response = await api.search({ q });
          setResults(response.messages);
        } finally {
          setIsLoading(false);
        }
      }, 300),
    []
  );

  useEffect(() => {
    debouncedSearch(query);
  }, [query]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center pt-20">
      <div className="bg-white rounded-lg w-full max-w-2xl shadow-xl">
        <div className="p-4 border-b">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages..."
            className="w-full text-lg outline-none"
            autoFocus
          />
        </div>

        <div className="max-h-96 overflow-auto">
          {isLoading ? (
            <div className="p-4 text-center text-gray-500">Searching...</div>
          ) : results.length === 0 ? (
            <div className="p-4 text-center text-gray-500">No results</div>
          ) : (
            results.map((result) => (
              <SearchResultItem key={result.id} result={result} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SearchResultItem({ result }: { result: SearchResult }) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(`/channel/${result.channel_id}?message=${result.id}`)}
      className="w-full p-4 text-left hover:bg-gray-50 border-b"
    >
      <div className="text-sm text-gray-500">
        #{result.channel_name} · {formatDate(result.created_at)}
      </div>
      <div
        className="mt-1"
        dangerouslySetInnerHTML={{
          __html: result.highlight || result.content,
        }}
      />
    </button>
  );
}
```

## Session Management

### Backend Configuration

```typescript
// Backend: app.ts
import session from 'express-session';

app.use(
  session({
    store: new RedisStore({ client: redis }),
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  })
);
```

### Frontend Auth State

```typescript
// Frontend: stores/authStore.ts
interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  checkAuth: async () => {
    try {
      const user = await api.getCurrentUser();
      set({ user, isAuthenticated: true });
    } catch {
      set({ user: null, isAuthenticated: false });
    } finally {
      set({ isLoading: false });
    }
  },

  login: async (email, password) => {
    const user = await api.login(email, password);
    set({ user, isAuthenticated: true });
  },

  logout: async () => {
    await api.logout();
    set({ user: null, isAuthenticated: false });
  },
}));
```

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| User-level pub/sub | Simple gateway logic | More pub/sub channels |
| Optimistic updates | Instant UI feedback | Rollback complexity |
| Zustand over Redux | Less boilerplate | Smaller ecosystem |
| PostgreSQL + Elasticsearch | Best of both | Operational complexity |
| Session in Redis | Fast, supports WebSocket auth | Additional infra |

## Scalability Path

### Current: Single Server

```
Browser → Gateway (WebSocket) → Express (REST) → PostgreSQL
                            ↓
                          Valkey (pub/sub, sessions)
```

### Future: Scaled

```
Browser → CDN (static) → Load Balancer → Gateway Cluster (3 nodes)
                                     ↓
                              Valkey Cluster (pub/sub)
                                     ↓
                              API Servers (3 nodes)
                                     ↓
                         PostgreSQL (sharded by workspace)
```

1. **Shard by workspace**: Each workspace's data on specific shards
2. **Gateway cluster**: Multiple WebSocket servers behind load balancer
3. **Read replicas**: Scale read-heavy message queries
4. **CDN for assets**: Static files and user avatars

## Future Enhancements

1. **Rich Text Editor**: WYSIWYG with markdown support
2. **File Uploads**: Drag & drop with previews
3. **Webhooks & Integrations**: External system notifications
4. **Voice/Video Calls**: WebRTC integration
5. **Message Retention**: Configurable retention policies
6. **Audit Logging**: Enterprise compliance features
