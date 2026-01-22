# Slack - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Problem Statement

Design the frontend architecture for a team messaging platform that allows users to:
- Send and receive messages in real-time across channels
- Navigate between workspaces, channels, and threads
- See presence status and typing indicators
- Search across message history

## Requirements Clarification

### Functional Requirements
1. **Workspace Switcher**: Navigate between multiple workspaces
2. **Channel List**: Sidebar with public/private channels and DMs
3. **Message View**: Scrollable message history with infinite scroll
4. **Real-Time Updates**: Live message delivery, typing indicators, presence
5. **Thread View**: Slide-out panel for thread replies
6. **Search**: Full-text search with result highlighting

### Non-Functional Requirements
1. **Performance**: Message list should scroll smoothly with 10K+ messages
2. **Responsiveness**: Desktop and mobile layouts
3. **Accessibility**: Keyboard navigation, screen reader support
4. **Offline Resilience**: Show cached data when offline

### UI/UX Requirements
- Messages should appear instantly (optimistic updates)
- Unread indicators for channels with new messages
- Typing indicators when others are composing
- Visual distinction between own messages and others

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          React Application                               │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                        TanStack Router                               ││
│  │    /workspace/:id          → Workspace Layout                        ││
│  │    /workspace/:id/channel/:channelId → Channel View                 ││
│  │    /workspace/:id/dm/:dmId → Direct Message View                    ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  ┌────────────────┐  ┌─────────────────────┐  ┌────────────────────┐   │
│  │    Sidebar     │  │    Message Area     │  │   Thread Panel     │   │
│  │  ┌──────────┐  │  │  ┌───────────────┐  │  │  ┌──────────────┐  │   │
│  │  │ Workspace│  │  │  │ Channel Header│  │  │  │ Parent Msg   │  │   │
│  │  │ Switcher │  │  │  └───────────────┘  │  │  └──────────────┘  │   │
│  │  └──────────┘  │  │  ┌───────────────┐  │  │  ┌──────────────┐  │   │
│  │  ┌──────────┐  │  │  │  MessageList  │  │  │  │  Replies     │  │   │
│  │  │ Channels │  │  │  │ (virtualized) │  │  │  │  (scrollable)│  │   │
│  │  └──────────┘  │  │  └───────────────┘  │  │  └──────────────┘  │   │
│  │  ┌──────────┐  │  │  ┌───────────────┐  │  │  ┌──────────────┐  │   │
│  │  │   DMs    │  │  │  │  Composer     │  │  │  │  Composer    │  │   │
│  │  └──────────┘  │  │  └───────────────┘  │  │  └──────────────┘  │   │
│  └────────────────┘  └─────────────────────┘  └────────────────────┘   │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                     Zustand Store                                    ││
│  │  workspaces | channels | messages | threads | presence | typing     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                     WebSocket Connection                             ││
│  │  Real-time: messages, presence, typing, reactions                   ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

## Deep Dive: State Management with Zustand

### Store Design

```typescript
// stores/slackStore.ts
import { create } from 'zustand';

interface SlackState {
  // Workspace state
  currentWorkspaceId: string | null;
  workspaces: Workspace[];

  // Channel state
  currentChannelId: string | null;
  channels: Channel[];
  unreadCounts: Record<string, number>;

  // Message state
  messages: Record<string, Message[]>;  // channelId -> messages
  isLoadingMessages: boolean;
  hasMoreMessages: Record<string, boolean>;

  // Thread state
  activeThreadId: string | null;
  threadMessages: Record<string, Message[]>;  // parentId -> replies

  // Presence & typing
  onlineUsers: Set<string>;
  typingUsers: Record<string, string[]>;  // channelId -> userIds

  // Actions
  setCurrentWorkspace: (id: string) => void;
  setCurrentChannel: (id: string) => void;
  addMessage: (channelId: string, message: Message) => void;
  loadMoreMessages: (channelId: string) => Promise<void>;
  openThread: (messageId: string) => void;
  closeThread: () => void;
  setTyping: (channelId: string, userId: string) => void;
  clearTyping: (channelId: string, userId: string) => void;
}

export const useSlackStore = create<SlackState>((set, get) => ({
  currentWorkspaceId: null,
  workspaces: [],
  currentChannelId: null,
  channels: [],
  unreadCounts: {},
  messages: {},
  isLoadingMessages: false,
  hasMoreMessages: {},
  activeThreadId: null,
  threadMessages: {},
  onlineUsers: new Set(),
  typingUsers: {},

  setCurrentChannel: (channelId) => {
    set({ currentChannelId: channelId });
    // Load messages if not already loaded
    const { messages, loadMoreMessages } = get();
    if (!messages[channelId]) {
      loadMoreMessages(channelId);
    }
  },

  addMessage: (channelId, message) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: [...(state.messages[channelId] || []), message],
      },
    }));
  },

  loadMoreMessages: async (channelId) => {
    const { messages, isLoadingMessages } = get();
    if (isLoadingMessages) return;

    set({ isLoadingMessages: true });

    const existingMessages = messages[channelId] || [];
    const oldestMessage = existingMessages[0];
    const cursor = oldestMessage?.created_at;

    try {
      const response = await api.getMessages(channelId, { before: cursor });
      set((state) => ({
        messages: {
          ...state.messages,
          [channelId]: [...response.messages, ...existingMessages],
        },
        hasMoreMessages: {
          ...state.hasMoreMessages,
          [channelId]: response.hasMore,
        },
      }));
    } finally {
      set({ isLoadingMessages: false });
    }
  },

  openThread: (messageId) => {
    set({ activeThreadId: messageId });
  },

  closeThread: () => {
    set({ activeThreadId: null });
  },
}));
```

### Why Zustand Over Redux?

| Factor | Zustand | Redux |
|--------|---------|-------|
| Boilerplate | Minimal | Significant |
| Bundle size | ~1KB | ~7KB + middleware |
| Learning curve | Simple | Steeper |
| DevTools | Supported | Excellent |
| Selective subscriptions | Built-in | Requires selectors |

**Decision**: Zustand provides the power we need with less ceremony. Real-time apps benefit from its simple subscription model.

## Deep Dive: Virtualized Message List

### The Problem

A busy channel can have 10,000+ messages. Rendering all of them would be extremely slow and memory-intensive.

### Solution: @tanstack/react-virtual

```tsx
// components/MessageList.tsx
import { useVirtualizer } from '@tanstack/react-virtual';

function MessageList({ channelId }: { channelId: string }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const messages = useSlackStore((state) => state.messages[channelId] || []);
  const hasMore = useSlackStore((state) => state.hasMoreMessages[channelId]);
  const loadMore = useSlackStore((state) => state.loadMoreMessages);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,  // Estimated message height
    overscan: 10,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  // Load more when scrolling to top
  const handleScroll = useCallback(() => {
    const { scrollTop } = parentRef.current!;
    if (scrollTop < 100 && hasMore) {
      loadMore(channelId);
    }
  }, [channelId, hasMore, loadMore]);

  // Scroll to bottom on new messages
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.user_id === currentUserId) {
      virtualizer.scrollToIndex(messages.length - 1);
    }
  }, [messages.length]);

  return (
    <div
      ref={parentRef}
      onScroll={handleScroll}
      className="flex-1 overflow-auto"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const message = messages[virtualRow.index];
          return (
            <div
              key={message.id}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <MessageItem message={message} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

### Message Item Component

```tsx
// components/MessageItem.tsx
function MessageItem({ message }: { message: Message }) {
  const openThread = useSlackStore((state) => state.openThread);
  const user = useUser(message.user_id);

  return (
    <div className="flex gap-3 px-4 py-2 hover:bg-gray-50 group">
      <img
        src={user?.avatar_url}
        alt={user?.display_name}
        className="w-9 h-9 rounded"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-sm">{user?.display_name}</span>
          <span className="text-xs text-gray-500">
            {formatTime(message.created_at)}
          </span>
        </div>
        <div className="text-sm text-gray-900 whitespace-pre-wrap">
          {message.content}
        </div>

        {/* Thread indicator */}
        {message.reply_count > 0 && (
          <button
            onClick={() => openThread(message.id)}
            className="flex items-center gap-1 text-xs text-blue-600 mt-1 hover:underline"
          >
            <ThreadIcon className="w-4 h-4" />
            {message.reply_count} {message.reply_count === 1 ? 'reply' : 'replies'}
          </button>
        )}

        {/* Reactions */}
        {message.reactions?.length > 0 && (
          <ReactionList reactions={message.reactions} messageId={message.id} />
        )}
      </div>

      {/* Action buttons (show on hover) */}
      <div className="opacity-0 group-hover:opacity-100 flex gap-1">
        <button className="p-1 hover:bg-gray-200 rounded">
          <EmojiIcon className="w-4 h-4" />
        </button>
        <button className="p-1 hover:bg-gray-200 rounded">
          <ThreadIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
```

## Deep Dive: WebSocket Integration

### Connection Manager

```tsx
// hooks/useWebSocket.ts
function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number>();

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(`wss://api.slack.local/ws`);

      ws.onopen = () => {
        console.log('WebSocket connected');
        // Send auth token
        ws.send(JSON.stringify({
          type: 'auth',
          token: getAuthToken(),
        }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting...');
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };

      wsRef.current = ws;
    }

    connect();

    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, []);

  return wsRef;
}

function handleMessage(data: WebSocketMessage) {
  switch (data.type) {
    case 'message':
      useSlackStore.getState().addMessage(data.channel_id, data.message);
      break;

    case 'presence':
      useSlackStore.setState((state) => {
        const onlineUsers = new Set(state.onlineUsers);
        if (data.status === 'online') {
          onlineUsers.add(data.user_id);
        } else {
          onlineUsers.delete(data.user_id);
        }
        return { onlineUsers };
      });
      break;

    case 'typing':
      useSlackStore.getState().setTyping(data.channel_id, data.user_id);
      break;

    case 'reaction_added':
      // Update message reactions
      break;
  }
}
```

### Typing Indicator

```tsx
// components/TypingIndicator.tsx
function TypingIndicator({ channelId }: { channelId: string }) {
  const typingUsers = useSlackStore(
    (state) => state.typingUsers[channelId] || []
  );

  if (typingUsers.length === 0) return null;

  const text = typingUsers.length === 1
    ? `${typingUsers[0]} is typing...`
    : typingUsers.length === 2
    ? `${typingUsers[0]} and ${typingUsers[1]} are typing...`
    : `${typingUsers.length} people are typing...`;

  return (
    <div className="px-4 py-1 text-xs text-gray-500 flex items-center gap-2">
      <TypingDots />
      {text}
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex gap-0.5">
      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  );
}
```

## Deep Dive: Message Composer

### Rich Text Composer

```tsx
// components/MessageComposer.tsx
function MessageComposer({ channelId }: { channelId: string }) {
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ws = useWebSocket();

  // Send typing indicator (debounced)
  const sendTyping = useMemo(
    () =>
      debounce(() => {
        ws.current?.send(
          JSON.stringify({ type: 'typing', channel_id: channelId })
        );
      }, 1000),
    [channelId]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || isSubmitting) return;

    setIsSubmitting(true);

    // Optimistic update
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: Message = {
      id: tempId,
      channel_id: channelId,
      user_id: currentUserId,
      content: content.trim(),
      created_at: new Date().toISOString(),
      pending: true,
    };

    useSlackStore.getState().addMessage(channelId, optimisticMessage);
    setContent('');

    try {
      const realMessage = await api.sendMessage(channelId, content.trim());
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
      // Mark message as failed
      useSlackStore.setState((state) => ({
        messages: {
          ...state.messages,
          [channelId]: state.messages[channelId].map((m) =>
            m.id === tempId ? { ...m, failed: true, pending: false } : m
          ),
        },
      }));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [content]);

  return (
    <form onSubmit={handleSubmit} className="border-t p-4">
      <div className="flex items-end gap-2 bg-gray-100 rounded-lg p-2">
        <button type="button" className="p-2 hover:bg-gray-200 rounded">
          <PlusIcon className="w-5 h-5" />
        </button>

        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            sendTyping();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          placeholder={`Message #${channelName}`}
          rows={1}
          className="flex-1 bg-transparent resize-none outline-none text-sm"
        />

        <button type="button" className="p-2 hover:bg-gray-200 rounded">
          <EmojiIcon className="w-5 h-5" />
        </button>

        <button
          type="submit"
          disabled={!content.trim() || isSubmitting}
          className="p-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
        >
          <SendIcon className="w-5 h-5" />
        </button>
      </div>
    </form>
  );
}
```

## Deep Dive: Thread Panel

### Slide-Out Thread View

```tsx
// components/ThreadPanel.tsx
function ThreadPanel() {
  const activeThreadId = useSlackStore((state) => state.activeThreadId);
  const closeThread = useSlackStore((state) => state.closeThread);
  const parentMessage = useMessage(activeThreadId);
  const replies = useSlackStore(
    (state) => state.threadMessages[activeThreadId!] || []
  );

  if (!activeThreadId) return null;

  return (
    <div className="w-96 border-l flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h3 className="font-bold">Thread</h3>
        <button
          onClick={closeThread}
          className="p-1 hover:bg-gray-100 rounded"
        >
          <CloseIcon className="w-5 h-5" />
        </button>
      </div>

      {/* Parent message */}
      <div className="border-b">
        <MessageItem message={parentMessage!} isThreadParent />
      </div>

      {/* Reply count */}
      <div className="px-4 py-2 text-xs text-gray-500 border-b">
        {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
      </div>

      {/* Replies */}
      <div className="flex-1 overflow-auto">
        {replies.map((reply) => (
          <MessageItem key={reply.id} message={reply} />
        ))}
      </div>

      {/* Composer */}
      <ThreadComposer parentId={activeThreadId} />
    </div>
  );
}
```

## Deep Dive: Channel Sidebar

### Channel List with Unread Indicators

```tsx
// components/ChannelSidebar.tsx
function ChannelSidebar() {
  const channels = useSlackStore((state) => state.channels);
  const currentChannelId = useSlackStore((state) => state.currentChannelId);
  const unreadCounts = useSlackStore((state) => state.unreadCounts);
  const setCurrentChannel = useSlackStore((state) => state.setCurrentChannel);

  const publicChannels = channels.filter((c) => !c.is_private && !c.is_dm);
  const privateChannels = channels.filter((c) => c.is_private && !c.is_dm);
  const directMessages = channels.filter((c) => c.is_dm);

  return (
    <aside className="w-64 bg-purple-900 text-white flex flex-col">
      {/* Workspace header */}
      <WorkspaceHeader />

      {/* Search */}
      <div className="px-3 py-2">
        <button className="w-full px-3 py-1 bg-white/10 rounded text-sm text-left text-white/70">
          Search...
        </button>
      </div>

      {/* Channel sections */}
      <div className="flex-1 overflow-auto">
        <ChannelSection
          title="Channels"
          channels={publicChannels}
          currentId={currentChannelId}
          unreadCounts={unreadCounts}
          onSelect={setCurrentChannel}
        />

        <ChannelSection
          title="Private"
          channels={privateChannels}
          currentId={currentChannelId}
          unreadCounts={unreadCounts}
          onSelect={setCurrentChannel}
        />

        <ChannelSection
          title="Direct Messages"
          channels={directMessages}
          currentId={currentChannelId}
          unreadCounts={unreadCounts}
          onSelect={setCurrentChannel}
          showPresence
        />
      </div>
    </aside>
  );
}

function ChannelSection({
  title,
  channels,
  currentId,
  unreadCounts,
  onSelect,
  showPresence,
}: ChannelSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="mb-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1 px-3 py-1 text-sm font-medium text-white/70 hover:text-white w-full"
      >
        <ChevronIcon
          className={cn('w-3 h-3 transition-transform', !isExpanded && '-rotate-90')}
        />
        {title}
      </button>

      {isExpanded && (
        <ul>
          {channels.map((channel) => (
            <ChannelItem
              key={channel.id}
              channel={channel}
              isActive={channel.id === currentId}
              unreadCount={unreadCounts[channel.id] || 0}
              onClick={() => onSelect(channel.id)}
              showPresence={showPresence}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ChannelItem({
  channel,
  isActive,
  unreadCount,
  onClick,
  showPresence,
}: ChannelItemProps) {
  const onlineUsers = useSlackStore((state) => state.onlineUsers);
  const isOnline = showPresence && onlineUsers.has(channel.other_user_id);

  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          'w-full px-3 py-1 text-sm text-left flex items-center gap-2',
          isActive ? 'bg-blue-600' : 'hover:bg-white/10',
          unreadCount > 0 && 'font-bold'
        )}
      >
        {showPresence ? (
          <PresenceIndicator online={isOnline} />
        ) : channel.is_private ? (
          <LockIcon className="w-4 h-4" />
        ) : (
          <HashIcon className="w-4 h-4" />
        )}

        <span className="truncate flex-1">
          {channel.name}
        </span>

        {unreadCount > 0 && (
          <span className="bg-red-500 text-white text-xs px-1.5 rounded-full">
            {unreadCount}
          </span>
        )}
      </button>
    </li>
  );
}
```

## Performance Optimizations

### 1. Selective Store Subscriptions

```tsx
// Only re-render when specific state changes
function ChannelHeader() {
  // Only subscribes to current channel, not all messages
  const currentChannelId = useSlackStore((state) => state.currentChannelId);
  const channel = useSlackStore(
    (state) => state.channels.find((c) => c.id === state.currentChannelId)
  );

  return (
    <header className="border-b p-4">
      <h2 className="font-bold">#{channel?.name}</h2>
    </header>
  );
}
```

### 2. Memoized Message Rendering

```tsx
// Memoize individual messages to prevent unnecessary re-renders
const MessageItem = memo(function MessageItem({ message }: { message: Message }) {
  // Component implementation
}, (prev, next) => prev.message.id === next.message.id);
```

### 3. Debounced Typing Indicator

```tsx
// Only send typing events every 1 second
const sendTyping = useMemo(
  () => debounce(() => {
    ws.send(JSON.stringify({ type: 'typing', channel_id: channelId }));
  }, 1000),
  [channelId]
);
```

### 4. Optimistic Updates

```tsx
// Show message immediately, sync with server in background
function sendMessage(content: string) {
  const tempMessage = { id: `temp-${Date.now()}`, content, pending: true };
  addMessage(channelId, tempMessage);

  api.sendMessage(channelId, content)
    .then((realMessage) => replaceMessage(tempMessage.id, realMessage))
    .catch(() => markMessageFailed(tempMessage.id));
}
```

## Accessibility (a11y)

### Keyboard Navigation

```tsx
// hooks/useKeyboardNavigation.ts
function useKeyboardNavigation() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Skip if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case 'ArrowUp':
          if (e.altKey) {
            // Previous channel
            navigateToPreviousChannel();
          }
          break;
        case 'ArrowDown':
          if (e.altKey) {
            // Next channel
            navigateToNextChannel();
          }
          break;
        case 'Escape':
          // Close thread panel
          closeThread();
          break;
        case 'k':
          if (e.metaKey || e.ctrlKey) {
            // Open search
            e.preventDefault();
            openSearch();
          }
          break;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
}
```

### ARIA Labels

```tsx
<aside role="navigation" aria-label="Channel list">
  <ul role="list" aria-label="Channels">
    <li role="listitem">
      <button
        aria-current={isActive ? 'page' : undefined}
        aria-label={`${channel.name}, ${unreadCount} unread messages`}
      >
        #{channel.name}
      </button>
    </li>
  </ul>
</aside>
```

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Zustand over Redux | Less boilerplate, simpler | Less tooling ecosystem |
| Virtualized list | Smooth scrolling, low memory | Complex scroll handling |
| Optimistic updates | Instant feedback | Rollback complexity |
| WebSocket in React | Real-time updates | Reconnection handling |
| Debounced typing | Reduces network traffic | Slight delay in indicator |

## Future Frontend Enhancements

1. **Rich Text Editor**: WYSIWYG with markdown support
2. **Drag & Drop Files**: Upload by dropping anywhere
3. **Emoji Picker**: Searchable emoji selection
4. **Mentions Autocomplete**: @user and #channel suggestions
5. **Dark Mode**: System preference and manual toggle
6. **Mobile Layout**: Collapsible sidebar, swipe gestures
