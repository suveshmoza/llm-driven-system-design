# WhatsApp - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Opening Statement

"I'll design the frontend for a real-time messaging platform like WhatsApp that supports one-on-one messaging, group chats, and presence indicators. The key frontend challenges are managing WebSocket connections for real-time updates, building an offline-first architecture with IndexedDB, virtualizing large message lists for performance, and matching WhatsApp's distinctive visual identity with message bubbles, delivery receipts, and typing indicators. Let me start by clarifying requirements."

---

## 1. Requirements Clarification (3-4 minutes)

### Functional Requirements

1. **Conversation List** - Display all active conversations with last message preview, unread badges, real-time updates, sorted by recent activity
2. **Chat Interface** - Message bubbles (green outgoing, white incoming), delivery status indicators, typing indicators, presence status
3. **Message Features** - Send/receive text in real-time, reactions with emoji picker, reply-to threading, infinite scroll
4. **Offline Support** - Queue messages when offline, display cached conversations, sync on reconnect

### Non-Functional Requirements

| Requirement | Target | Implementation |
|-------------|--------|----------------|
| **Message List Performance** | 10,000+ messages smooth | Virtualized list rendering |
| **First Contentful Paint** | < 1.5s | Code splitting, service worker |
| **Offline Capability** | Full read, queue writes | PWA + IndexedDB |
| **Real-time Latency** | < 100ms UI update | WebSocket, optimistic updates |
| **Bundle Size** | < 200KB gzipped | Tree shaking, lazy loading |

---

## 2. Component Architecture (8-10 minutes)

### High-Level Component Tree

```
┌─────────────────────────────────────────────────────────────────┐
│                              App                                 │
├─────────────────────────────────────────────────────────────────┤
│  AuthProvider ─── WebSocketProvider ─── OfflineIndicator        │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                           ChatLayout                             │
├──────────────────────────┬──────────────────────────────────────┤
│        Sidebar           │              ChatView                 │
│  ┌────────────────────┐  │  ┌────────────────────────────────┐  │
│  │ SearchBar          │  │  │ ChatHeader (name, status)      │  │
│  ├────────────────────┤  │  ├────────────────────────────────┤  │
│  │ ConversationList   │  │  │ MessageList (virtualized)      │  │
│  │ (virtualized)      │  │  │  └── MessageBubble             │  │
│  │  └── ConvItem      │  │  │       ├── MessageContent       │  │
│  │      ├── Avatar    │  │  │       ├── MessageStatus        │  │
│  │      ├── Preview   │  │  │       └── MessageReactions     │  │
│  │      └── Badge     │  │  ├────────────────────────────────┤  │
│  ├────────────────────┤  │  │ TypingIndicator                │  │
│  │ NewChatButton      │  │  ├────────────────────────────────┤  │
│  └────────────────────┘  │  │ MessageInput                   │  │
│                          │  └────────────────────────────────┘  │
└──────────────────────────┴──────────────────────────────────────┘
```

### Core Layout Structure

Two-panel responsive layout: 30% sidebar (min 300px, max 400px) with conversation list, 70% main area with chat view or empty state.

---

## 3. Deep Dive: WhatsApp Brand Styling (6-7 minutes)

### Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--whatsapp-primary` | #25D366 | Logo, accents |
| `--whatsapp-teal-dark` | #008069 | Header background |
| `--whatsapp-teal-light` | #00A884 | Active states |
| `--whatsapp-outgoing` | #DCF8C6 | Sent message bubbles |
| `--whatsapp-incoming` | #FFFFFF | Received message bubbles |
| `--whatsapp-chat-bg` | #ECE5DD | Chat background |
| `--whatsapp-text-primary` | #111B21 | Primary text |
| `--whatsapp-text-secondary` | #667781 | Secondary text |
| `--whatsapp-read-receipt` | #53BDEB | Blue double-tick |

### Message Bubble Component

- Max width 65% of container
- Padding 9px horizontal, 6px vertical
- Rounded corners with tail on first message in sequence
- Shadow for depth
- Footer with timestamp + status indicator (for own messages)
- Reactions displayed below content

### Delivery Status Indicators

| Status | Icon | Color |
|--------|------|-------|
| `sending` | Clock | Gray (#667781) |
| `sent` | Single check | Gray (#667781) |
| `delivered` | Double check | Gray (#667781) |
| `read` | Double check | Blue (#53BDEB) |

### Typing Indicator

Displays "X is typing" with animated bouncing dots (3 dots, 150ms stagger between animations).

---

## 4. Deep Dive: WebSocket Real-Time Communication (6-7 minutes)

### WebSocket Provider Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     WebSocketProvider                            │
├─────────────────────────────────────────────────────────────────┤
│  State:                                                          │
│   • isConnected: boolean                                         │
│   • reconnectAttempts: number                                    │
│                                                                  │
│  Methods:                                                        │
│   • sendMessage(msg) ───────────────────────────────────┐       │
│   • sendTyping(conversationId)                          │       │
│   • sendReadReceipt(conversationId, messageId)          │       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Message Handlers                             │
├───────────────┬───────────────┬───────────────┬─────────────────┤
│   message     │ message_status│    typing     │    presence     │
├───────────────┼───────────────┼───────────────┼─────────────────┤
│ addMessage()  │ updateStatus()│ setTypingUser │ updatePresence()│
│ sendDelivery  │               │               │                 │
│ Receipt()     │               │               │                 │
└───────────────┴───────────────┴───────────────┴─────────────────┘
```

### Reconnection Strategy

Exponential backoff: delay = min(1000 * 2^attempts, 30000ms). On connect, sync pending messages from offline queue.

### Optimistic Updates with Rollback

1. Generate client-side UUID
2. Add message to UI with status "sending"
3. If disconnected, queue to IndexedDB
4. Send via WebSocket
5. On failure, update status to "failed"

### Typing Indicator Debouncing

Send typing events at most every 2 seconds (TYPING_INTERVAL = 2000ms) to reduce network overhead.

---

## 5. Deep Dive: Virtualized Message List (5-6 minutes)

### Why Virtualization?

| Messages | DOM Nodes (No Virtualization) | DOM Nodes (Virtualized) |
|----------|-------------------------------|-------------------------|
| 100 | ~100 | ~15 |
| 1,000 | ~1,000 (lag) | ~15 |
| 10,000 | ~10,000 (crash) | ~15 |

### Implementation with TanStack Virtual

```
┌─────────────────────────────────────────────────────────────────┐
│                      MessageList Container                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Scroll Container (ref: parentRef)                        │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  Virtual Content (height: getTotalSize())           │  │  │
│  │  │  ┌───────────────────────────────────────────────┐  │  │  │
│  │  │  │ Virtual Item (translateY: virtualItem.start)  │  │  │  │
│  │  │  │   └── MessageBubble                           │  │  │  │
│  │  │  ├───────────────────────────────────────────────┤  │  │  │
│  │  │  │ Virtual Item                                  │  │  │  │
│  │  │  │   └── MessageBubble                           │  │  │  │
│  │  │  ├───────────────────────────────────────────────┤  │  │  │
│  │  │  │ ... (only ~15 items rendered)                 │  │  │  │
│  │  │  └───────────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

Key settings: estimateSize = 60px, overscan = 5 items, dynamic measurement via measureElement.

### Infinite Scroll (Load More at Top)

Trigger loadMore() when scrollTop < 100px and hasMore && !isLoading.

### Auto-Scroll to Bottom

On new messages, scroll to last index with smooth behavior. Track prevMessageCount to detect additions.

### Scroll Position Preservation

Before loading older messages, save scrollHeight. After prepend, restore scroll position by adding heightDiff to scrollTop.

---

## 6. Deep Dive: Offline-First Architecture (5-6 minutes)

### IndexedDB Schema with Dexie

```
┌─────────────────────────────────────────────────────────────────┐
│                       WhatsAppDatabase                           │
├─────────────────────────────────────────────────────────────────┤
│  pendingMessages                                                 │
│  ├── clientMessageId (PK)                                        │
│  ├── conversationId (indexed)                                    │
│  ├── status (indexed: pending | sending | failed)                │
│  ├── content                                                     │
│  ├── createdAt (indexed)                                         │
│  └── retryCount                                                  │
├─────────────────────────────────────────────────────────────────┤
│  messages                                                        │
│  ├── id (PK)                                                     │
│  ├── conversationId (indexed)                                    │
│  ├── senderId                                                    │
│  ├── content                                                     │
│  ├── status                                                      │
│  ├── createdAt (indexed)                                         │
│  └── cachedAt                                                    │
├─────────────────────────────────────────────────────────────────┤
│  conversations                                                   │
│  ├── id (PK)                                                     │
│  ├── name                                                        │
│  ├── type (direct | group)                                       │
│  ├── lastMessagePreview                                          │
│  ├── lastMessageAt (indexed)                                     │
│  ├── unreadCount                                                 │
│  └── cachedAt                                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Offline Sync Service

**Queue Message Flow:**
1. Add to pendingMessages with status "pending"
2. On reconnect, iterate pending messages
3. Update status to "sending"
4. Send via WebSocket
5. On success: delete from queue
6. On failure: increment retryCount, mark "failed" after 3 attempts

**Cache Strategy:**
- Cache messages on fetch with timestamp
- Return cached messages when offline
- Prune data older than 7 days

### Online/Offline Detection

Use navigator.onLine + window events (online/offline). Show banner: red when offline, green "Back online!" for 3 seconds after reconnect.

---

## 7. State Management with Zustand (4-5 minutes)

### Chat Store Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                         ChatState                                │
├─────────────────────────────────────────────────────────────────┤
│  conversations: Conversation[]                                   │
│  activeConversationId: string | null                            │
│  messagesByConversation: Record<string, Message[]>              │
│  paginationState: Record<string, { hasMore, loading }>          │
│  typingUsers: Record<string, string[]>  (convId → usernames)    │
│  userPresence: Record<string, { status, lastSeen }>             │
├─────────────────────────────────────────────────────────────────┤
│  Actions:                                                        │
│  ├── setActiveConversation(id)                                  │
│  ├── addMessage(message) ── dedupe + sort by createdAt          │
│  ├── updateMessageStatus(messageId, status)                     │
│  ├── setTypingUser(conversationId, userId, isTyping)            │
│  ├── updateUserPresence(userId, status, lastSeen)               │
│  ├── updateReactions(messageId, reactions)                      │
│  └── loadMoreMessages(conversationId, beforeId)                 │
└─────────────────────────────────────────────────────────────────┘
```

### Duplicate Detection

When adding messages, check if ID or clientMessageId already exists. If duplicate, merge/update existing message instead of adding new.

---

## 8. PWA Configuration (3-4 minutes)

### Vite PWA Setup

- registerType: autoUpdate
- manifest: name, theme_color (#008069), display: standalone
- icons: 192x192 and 512x512 (maskable)

### Workbox Runtime Caching

| Pattern | Strategy | Cache Name | Max Age |
|---------|----------|------------|---------|
| `/conversations` | NetworkFirst | conversations-cache | 24h |
| `/messages` | NetworkFirst | messages-cache | 24h |

### Service Worker Update

Prompt user when new version available: "New version available. Reload to update?"

---

## 9. Trade-offs and Alternatives (3-4 minutes)

### State Management

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **Zustand** | Simple, lightweight (2KB), no boilerplate | Less structured for complex apps | **Chosen** |
| Redux Toolkit | Mature, DevTools, middleware | More boilerplate, larger bundle | Overkill for this scope |
| Jotai/Recoil | Atomic updates, fine-grained | Newer, less ecosystem | Good alternative |

### Virtualization

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **TanStack Virtual** | Headless, flexible, dynamic heights | Manual integration | **Chosen** |
| react-window | Simple API, battle-tested | Fixed heights only | Doesn't fit message bubbles |
| react-virtuoso | Built-in infinite scroll | Larger bundle | Good alternative |

### Offline Storage

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **Dexie (IndexedDB)** | Type-safe, promise-based, powerful queries | Learning curve | **Chosen** |
| localForage | Simple key-value API | Limited querying | Too simple for messages |
| Native IndexedDB | No dependencies | Verbose, callback-based | Dexie wraps this better |

### Real-Time Communication

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **Native WebSocket** | Full control, lightweight | Manual reconnection | **Chosen** |
| Socket.IO | Auto-reconnect, rooms, fallbacks | Larger bundle, server required | Overkill for native WS |
| Ably/Pusher | Managed, scalable | Cost at scale, vendor lock-in | For production at scale |

---

## 10. Accessibility (2-3 minutes)

### Key Accessibility Features

- **Keyboard navigation**: Arrow keys for message list, Enter to open reaction picker
- **ARIA roles**: Message list as `role="log"`, conversations as `role="listbox"`
- **Screen reader announcements**: Live region announces new messages
- **Status indicators**: `aria-label` on tick marks ("Message read", "Message delivered")

### ARIA Patterns

- Conversation list: `role="listbox"` with `role="option"` items, `aria-selected` for active
- Message bubbles: `aria-label` with sender name and content
- Unread badges: Include count in `aria-label` ("5 unread messages")

---

## Summary

The WhatsApp frontend design addresses these key challenges:

1. **Real-Time Updates**: WebSocket provider with automatic reconnection, message handlers for all event types, and optimistic UI updates for instant feedback

2. **WhatsApp Brand Styling**: Authentic color palette, distinctive message bubbles with tails, delivery status tick marks, and typing indicators

3. **Performance at Scale**: TanStack Virtual for message list virtualization, supporting 10,000+ messages with only ~15 DOM nodes rendered

4. **Offline-First**: PWA with service worker, IndexedDB for message caching, offline message queue with retry logic

5. **State Management**: Zustand store with normalized message storage, real-time typing/presence state, and pagination tracking

The architecture supports the core messaging experience while maintaining performance and providing a seamless offline experience.
