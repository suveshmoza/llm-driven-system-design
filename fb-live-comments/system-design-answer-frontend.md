# Facebook Live Comments - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Introduction

"Today I'll design a real-time commenting system for live video streams, similar to Facebook Live or YouTube Live. The core frontend challenge is rendering thousands of comments per second smoothly while maintaining 60fps, handling WebSocket reconnection gracefully, and creating engaging reaction animations. This involves interesting problems around virtualization, state management, and real-time UI updates."

---

## Step 1: Requirements Clarification

### Functional Requirements

1. **Comment Stream Display**: Real-time scrolling comment feed overlaid on video
2. **Comment Composition**: Input for posting comments with character limits
3. **Floating Reactions**: Animated emoji reactions floating up the screen
4. **Live Viewer Count**: Real-time viewer count display
5. **Moderation UI**: Creator/moderator controls for pinning, hiding, banning
6. **Connection Status**: Visual feedback for WebSocket connection state

### Non-Functional Requirements

| Requirement | Target | Implementation |
|-------------|--------|----------------|
| Performance | 60fps with 10,000+ comments/min | Virtualization, object pooling |
| Responsiveness | Mobile, tablet, desktop | CSS Grid, media queries |
| Accessibility | WCAG 2.1 AA | ARIA labels, keyboard nav |
| Offline Resilience | Queue writes, resend on reconnect | IndexedDB pending queue |
| Bundle Size | < 50KB gzipped | Tree shaking, lazy loading |

---

## Step 2: Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LiveStreamPage                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────┐  ┌────────────────────────────────────┐ │
│  │         VideoPlayer            │  │          CommentPanel              │ │
│  │  ┌──────────────────────────┐  │  │  ┌──────────────────────────────┐  │ │
│  │  │    ReactionsOverlay      │  │  │  │       CommentList            │  │ │
│  │  │  (floating animations)   │  │  │  │  (virtualized scroll)        │  │ │
│  │  └──────────────────────────┘  │  │  │    └── CommentItem           │  │ │
│  │                                │  │  └──────────────────────────────┘  │ │
│  │  ┌──────────────────────────┐  │  │  ┌──────────────────────────────┐  │ │
│  │  │      ViewerCount         │  │  │  │       CommentInput           │  │ │
│  │  └──────────────────────────┘  │  │  │  (compose + submit)          │  │ │
│  └────────────────────────────────┘  │  └──────────────────────────────┘  │ │
│                                       └────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 3: State Management with Zustand

### Live Stream Store Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LiveStreamState                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  Stream Data:                                                                │
│   • streamId: string | null                                                  │
│   • viewerCount: number                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  Comments:                                                                   │
│   • comments: Comment[]              (max 500 for performance)               │
│   • pinnedComment: Comment | null                                            │
│   • pendingComments: Comment[]       (queued while offline)                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  Reactions:                                                                  │
│   • reactionQueue: ReactionBurst[]   (batched for animation)                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  Connection:                                                                 │
│   • status: connecting | connected | disconnected | reconnecting             │
│   • lastConnected: number | null                                             │
│   • reconnectAttempt: number                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  Actions:                                                                    │
│   • setStreamId(id)                                                          │
│   • addCommentBatch(comments)  ─── dedupe + trim to MAX_VISIBLE              │
│   • addPendingComment(comment)                                               │
│   • flushPendingComments()     ─── returns pending, clears queue             │
│   • setPinnedComment(comment)                                                │
│   • addReactionBurst(burst)                                                  │
│   • consumeReactions()         ─── returns queue, clears it                  │
│   • setViewerCount(count)                                                    │
│   • setConnectionStatus(status)                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Types

**Comment:**
- id, userId, username, avatarUrl, content
- isHighlighted, isPinned, createdAt

**ReactionBurst:**
- type: like | love | haha | wow | sad | angry
- count, timestamp

**ConnectionState:**
- status: connecting | connected | disconnected | reconnecting
- lastConnected, reconnectAttempt

### Comment Batch Handling

When adding comments, the store:
1. Deduplicates by ID against existing comments
2. Merges new unique comments to end of array
3. Trims to last 500 comments for performance
4. Returns new immutable state

---

## Step 4: WebSocket Hook

### useWebSocket Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         useWebSocket(streamId)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  Refs:                                                                       │
│   • wsRef: WebSocket instance                                                │
│   • reconnectTimeoutRef: pending reconnect timer                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  Connection Lifecycle:                                                       │
│                                                                              │
│   connect() ──┬── setConnectionStatus('connecting')                          │
│               ├── new WebSocket(url)                                         │
│               ├── onopen: setConnectionStatus('connected')                   │
│               │            send join_stream message                          │
│               │            flushPendingComments()                            │
│               ├── onmessage: route to handlers                               │
│               ├── onclose: scheduleReconnect() if abnormal                   │
│               └── onerror: setConnectionStatus('reconnecting')               │
├─────────────────────────────────────────────────────────────────────────────┤
│  Reconnection Strategy:                                                      │
│                                                                              │
│   delay = min(1000 * 2^attempt, 30000ms)   (exponential backoff, max 30s)   │
│                                                                              │
│   scheduleReconnect() ─── setTimeout(connect, delay)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  Returns:                                                                    │
│   • sendComment(content)    ─── sends if connected, queues if offline        │
│   • sendReaction(type)      ─── sends reaction event                         │
│   • connectionStatus        ─── current connection state                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Message Types

| Inbound Type | Handler | Action |
|--------------|---------|--------|
| comments_batch | addCommentBatch() | Add comments to store |
| reactions_batch | addReactionBurst() | Queue for animation |
| viewer_count | setViewerCount() | Update viewer count |
| error | console.error() | Log error |

| Outbound Type | Payload |
|---------------|---------|
| join_stream | stream_id |
| post_comment | stream_id, content |
| react | stream_id, reaction_type |

### Offline Queueing

When WebSocket is not connected:
1. Create comment with pending ID: `pending-{timestamp}`
2. Add to pendingComments array in store
3. On reconnect, flush pending and send each via WebSocket

---

## Step 5: Virtualized Comment List

### Why Virtualization?

| Comments | DOM Nodes (No Virtual) | DOM Nodes (Virtualized) |
|----------|------------------------|-------------------------|
| 100 | ~100 | ~15 |
| 500 | ~500 (lag) | ~15 |
| 1,000 | ~1,000 (severe lag) | ~15 |

### CommentList Implementation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CommentList Component                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Pinned Comment (sticky top, z-index 10)                              │  │
│  │   └── CommentItem (isPinned=true)                                     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Scroll Container (ref: parentRef, onScroll: handleScroll)            │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │  Virtual Content (height: getTotalSize())                       │  │  │
│  │  │                                                                 │  │  │
│  │  │   ┌──────────────────────────────────────────────────────────┐  │  │  │
│  │  │   │ Virtual Item (translateY: virtualItem.start)             │  │  │  │
│  │  │   │   └── CommentItem                                        │  │  │  │
│  │  │   ├──────────────────────────────────────────────────────────┤  │  │  │
│  │  │   │ Virtual Item                                             │  │  │  │
│  │  │   │   └── CommentItem                                        │  │  │  │
│  │  │   ├──────────────────────────────────────────────────────────┤  │  │  │
│  │  │   │ ... (only ~15 items rendered at once)                    │  │  │  │
│  │  │   └──────────────────────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  "New comments" button (shown when scrolled up)                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Virtualizer Configuration:**
- estimateSize: 60px per comment
- overscan: 5 items above/below viewport
- getItemKey: returns comment.id for stable keys

**Auto-Scroll Behavior:**
- Track autoScrollRef boolean
- On new comments: scroll to bottom if autoScrollRef is true
- On manual scroll: set autoScrollRef = false if user scrolls up
- Threshold: 100px from bottom to consider "at bottom"

### CommentItem Component

Memoized component displaying:
- Avatar (32x32, lazy loaded)
- Username (bold) + relative timestamp
- Comment text (word-wrapped)
- Pin badge if isPinned
- Highlight styling if isHighlighted

ARIA: `role="listitem"`, `aria-label="Comment by {username}"`

---

## Step 6: Floating Reactions Animation

### ReactionsOverlay Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ReactionsOverlay Component                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  State:                                                                      │
│   • floatingReactions: FloatingReaction[]                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  FloatingReaction:                                                           │
│   • id, type, emoji, x (horizontal %), startTime                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  Animation Constants:                                                        │
│   • ANIMATION_DURATION: 2000ms                                               │
│   • MAX_VISIBLE_REACTIONS: 50                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  Emoji Map:                                                                  │
│   like→👍  love→❤️  haha→😂  wow→😮  sad→😢  angry→😠                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Polling Loop (100ms interval):**
1. Call consumeReactions() to get pending bursts
2. For each burst, sample min(count, 10) reactions
3. Create FloatingReaction with random x position (10-90%)
4. Stagger start times by 50ms each
5. Append to floatingReactions, trim to max 50

**Animation Loop (requestAnimationFrame):**
1. Filter out reactions where elapsed > ANIMATION_DURATION
2. Render remaining with computed position:
   - bottom = progress * 100%
   - opacity = 1 - progress
   - scale = 1 + progress * 0.5

**Styling:**
- Positioned absolute, right side of video
- pointer-events: none (decorative)
- aria-hidden="true"

---

## Step 7: Comment Input with Rate Limiting

### CommentInput Component

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CommentInput Component                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  Constants:                                                                  │
│   • MAX_COMMENT_LENGTH: 200 characters                                       │
│   • RATE_LIMIT_COOLDOWN: 6000ms between comments                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  State:                                                                      │
│   • content: string                                                          │
│   • isSubmitting: boolean                                                    │
│   • cooldownRemaining: number (ms)                                           │
│   • lastSubmitRef: timestamp of last submit                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  Submit Flow:                                                                │
│   1. Check time since last submit                                            │
│   2. If < RATE_LIMIT_COOLDOWN: show countdown, return                        │
│   3. Validate content (non-empty, within length)                             │
│   4. Call sendComment()                                                      │
│   5. Clear input, update lastSubmitRef                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  UI Elements:                                                                │
│   • Textarea with placeholder (changes when disconnected)                    │
│   • Character counter: {length}/200                                          │
│   • Submit button: "Send" or "Wait Xs"                                       │
│   • Connection warning when reconnecting                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Disabled States:**
- Connection not 'connected'
- Currently submitting
- Cooldown remaining > 0

---

## Step 8: Connection Status Indicator

### ConnectionStatus Component

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Connection Status Display                               │
├─────────────────────┬───────────────────────┬───────────────────────────────┤
│       Status        │         Icon          │            Color              │
├─────────────────────┼───────────────────────┼───────────────────────────────┤
│ connecting          │ ⟳                     │ warning (yellow)              │
│ connected           │ ● (filled)            │ success (green)               │
│ disconnected        │ ○ (hollow)            │ error (red)                   │
│ reconnecting        │ ⟳ + attempt count     │ warning (yellow)              │
└─────────────────────┴───────────────────────┴───────────────────────────────┘
```

ARIA: `role="status"`, `aria-live="polite"`

---

## Step 9: Reaction Picker

### ReactionPicker Component

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ReactionPicker                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  Available Reactions:                                                        │
│   👍 Like  │  ❤️ Love  │  😂 Haha  │  😮 Wow  │  😢 Sad  │  😠 Angry          │
├─────────────────────────────────────────────────────────────────────────────┤
│  State:                                                                      │
│   • isOpen: boolean                                                          │
│   • lastReaction: timestamp                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  Rate Limiting: 1 reaction per second                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  ARIA:                                                                       │
│   • Button: aria-expanded, aria-haspopup, aria-label="Add reaction"          │
│   • Menu: role="menu", aria-label="Reactions"                                │
│   • Items: role="menuitem", aria-label={reaction.label}                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 10: CSS Styling

### Comment List Styling

| Element | Key Styles |
|---------|------------|
| Container | flex column, 100% height, rgba(0,0,0,0.6) background |
| Scroll container | flex: 1, overflow-y: auto, thin scrollbar |
| Comment item | flex row, 8px gap, 8-12px padding, slideIn animation |
| Highlighted | gold gradient background, left border |
| Pinned | blue background, left border |
| Avatar | 32x32, rounded, flex-shrink: 0 |
| Username | bold, 13px, margin-right 8px |
| Timestamp | 11px, 60% white opacity |
| Comment text | 14px, 1.4 line-height, word-wrap |

### Floating Reactions Styling

| Element | Key Styles |
|---------|------------|
| Overlay | absolute, bottom: 0, right: 0, 100px width, 100% height, pointer-events: none |
| Reaction | absolute, 24px font, will-change: transform/opacity/bottom |
| Animation | 2s ease-out, float upward with fade and scale |
| Wobble | odd children get slight horizontal movement |

### Animations

**slideIn:** opacity 0→1, translateY 10px→0, 0.2s ease-out

**float:**
- 0%: opacity 1, scale 0.5, translateY 0
- 50%: opacity 0.8, scale 1.2, translateY -50vh
- 100%: opacity 0, scale 1.5, translateY -100vh

---

## Step 11: Responsive Design

### Layout Breakpoints

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Mobile (< 768px)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                        Video Player                                   │  │
│  │                                                                       │  │
│  │                                                                       │  │
│  ├───────────────────────────────────────────────────────────────────────┤  │
│  │  Comment Panel (overlay, 40% height)                                  │  │
│  │  • Gradient background (black→transparent)                            │  │
│  │  • CommentInput: 16px font (prevents iOS zoom)                        │  │
│  │  • ReactionPicker: fixed bottom-right                                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                          Desktop (≥ 769px)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐  ┌───────────────────────────┐ │
│  │             Video Player                │  │     Comment Panel         │ │
│  │                                         │  │     (350px width)         │ │
│  │                                         │  │     border-left           │ │
│  │                                         │  │                           │ │
│  │                                         │  │                           │ │
│  └─────────────────────────────────────────┘  └───────────────────────────┘ │
│            grid-template-columns: 1fr 350px                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 12: Performance Optimizations

### Debounced Updates

**useVisibleComments Hook:**
- Memoizes last 100 comments from store
- Prevents unnecessary re-renders when comments array reference changes
- Returns computed subset for rendering

### Object Pool for Reactions

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      ReactionElementPool                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  Purpose: Reuse DOM elements to avoid creation/destruction overhead          │
├─────────────────────────────────────────────────────────────────────────────┤
│  Properties:                                                                 │
│   • pool: HTMLElement[]        (available elements)                          │
│   • container: HTMLElement     (parent container)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  Methods:                                                                    │
│   • constructor(container, initialSize=50)                                   │
│       └── Pre-creates 50 hidden span elements                                │
│   • acquire() ─── returns element from pool or creates new                   │
│   • release(el) ─── hides element and returns to pool                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  Benefits:                                                                   │
│   • Eliminates DOM thrashing during high reaction volume                     │
│   • Maintains consistent memory footprint                                    │
│   • Reduces GC pressure                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 13: Accessibility

### Screen Reader Announcements

**CommentAnnouncer Component:**
- Hidden div with `role="status"`, `aria-live="polite"`, `aria-atomic="true"`
- Tracks last announced comment ID
- On new comment: updates textContent to "New comment from {username}: {content}"
- Class: sr-only (visually hidden but available to screen readers)

### Key Accessibility Features

| Feature | Implementation |
|---------|----------------|
| Comment list | role="log" with listitem children |
| New comment announcements | Live region with polite priority |
| Keyboard navigation | Tab through input, buttons, picker |
| Focus management | Focus input after successful submit |
| Status indicators | aria-label on tick marks and badges |
| Decorative elements | aria-hidden on floating reactions |

---

## Step 14: Trade-offs and Alternatives

| Decision | Chosen | Alternative | Reasoning |
|----------|--------|-------------|-----------|
| State Management | Zustand | Redux | Simpler API, less boilerplate for real-time state |
| Virtualization | @tanstack/react-virtual | react-window | Better dynamic height support, newer API |
| WebSocket Reconnection | Custom hook | socket.io-client | Lower bundle size, more control |
| Reaction Animations | CSS + JS hybrid | Lottie/Canvas | Lighter weight for simple emoji animations |
| Comment Rendering | CSS transforms | Canvas | DOM accessibility, easier styling |

---

## Summary

"To summarize the frontend architecture for Facebook Live Comments:

1. **State Management**: Zustand store for comments, reactions, and connection state with deduplication and trimming to 500 max comments

2. **WebSocket Hook**: Custom hook with exponential backoff reconnection (max 30s delay) and offline queueing of pending comments

3. **Virtualized List**: TanStack Virtual rendering only ~15 DOM nodes regardless of comment count, with auto-scroll pause when user scrolls up

4. **Floating Reactions**: CSS animations with 100ms polling, reaction sampling for performance, and object pooling to avoid DOM thrashing

5. **Rate Limiting**: Client-side 6-second cooldown between comments with visual countdown, providing instant feedback before server rejection

6. **Responsive Design**: Overlay on mobile (40% height with gradient), side panel on desktop (350px fixed width)

7. **Accessibility**: ARIA labels, screen reader announcements via live region, keyboard navigation

The key frontend insights are:
- Virtualization is critical for smooth scrolling at high comment volumes
- Client-side rate limiting provides instant feedback before server rejection
- Connection state must be visible so users know when comments will actually send
- Reaction animations need object pooling to avoid DOM thrashing
- Auto-scroll should pause when user scrolls up to read older comments

What aspects would you like me to elaborate on?"
