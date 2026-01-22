# Twitch - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## 1. Requirements Clarification (3 minutes)

### Functional Requirements
- **Live video player** with HLS playback, quality switching, low-latency mode
- **Real-time chat** with WebSocket, emotes, badges, moderation indicators
- **Channel browsing** with categories, live status, viewer counts
- **Creator dashboard** for stream management, analytics, chat settings
- **Follow/subscribe UI** with real-time status updates

### Non-Functional Requirements
- **Low-latency playback**: 2-5 second glass-to-glass latency
- **Chat responsiveness**: Messages appear within 100ms of send
- **Smooth video**: No buffering on stable connections
- **Accessibility**: Screen reader support, keyboard navigation
- **Mobile-responsive**: Full functionality on mobile devices

### UI/UX Priorities
1. Video player dominates viewport with theater/fullscreen modes
2. Chat is always visible but resizable/collapsible
3. Emotes render inline with text seamlessly
4. Live indicators pulse to show active streams

---

## 2. High-Level Architecture (5 minutes)

### Component Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                            App                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Header                                                   │    │
│  │ ┌──────┐ ┌───────────────┐ ┌───────────┐ ┌──────────┐  │    │
│  │ │ Logo │ │  SearchBar    │ │CategoryNav│ │ UserMenu │  │    │
│  │ └──────┘ │(autocomplete) │ └───────────┘ └──────────┘  │    │
│  │          └───────────────┘                              │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Routes                                                   │    │
│  │ ┌─────────────────────────────────────────────────────┐ │    │
│  │ │ BrowsePage                                          │ │    │
│  │ │ ├── CategoryGrid                                    │ │    │
│  │ │ └── StreamCard (virtualized list)                   │ │    │
│  │ ├─────────────────────────────────────────────────────┤ │    │
│  │ │ ChannelPage                                         │ │    │
│  │ │ ├── VideoPlayer                                     │ │    │
│  │ │ ├── ChatPanel                                       │ │    │
│  │ │ ├── ChannelInfo                                     │ │    │
│  │ │ └── StreamActions (follow/subscribe)                │ │    │
│  │ ├─────────────────────────────────────────────────────┤ │    │
│  │ │ DashboardPage                                       │ │    │
│  │ │ ├── StreamControls                                  │ │    │
│  │ │ ├── ChatSettings                                    │ │    │
│  │ │ └── StreamKeyManager                                │ │    │
│  │ └─────────────────────────────────────────────────────┘ │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ GlobalModals                                             │    │
│  │ ├── SubscribeModal                                       │    │
│  │ ├── EmotePickerModal                                     │    │
│  │ └── SettingsModal                                        │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### State Management Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Zustand Stores                             │
├────────────────────┬────────────────────┬───────────────────────┤
│     AuthStore      │     ChatStore      │     PlayerStore       │
├────────────────────┼────────────────────┼───────────────────────┤
│ - user             │ - messages[]       │ - quality             │
│ - session          │ - emotes           │ - volume              │
│ - follows          │ - badges           │ - latency             │
│ - subscriptions    │ - slowMode         │ - isPlaying           │
└────────────────────┴────────────────────┴───────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      WebSocket Layer                             │
├─────────────────────────────────────────────────────────────────┤
│ - Chat connection per channel                                    │
│ - Reconnection with exponential backoff                         │
│ - Message queuing during disconnection                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Video Player Component (10 minutes)

### HLS.js Integration

The VideoPlayer component wraps an HTML5 video element with HLS.js for cross-browser streaming support.

**Props:** streamUrl (HLS manifest), channelId, isLive

**Key Configuration (Low-Latency HLS):**
- enableWorker: true
- lowLatencyMode: configurable
- liveSyncDuration: 2s (low-latency) or 4s (normal)
- liveMaxLatencyDuration: 5s (low-latency) or 10s (normal)
- liveDurationInfinity: true

**Event Handlers:**
- MANIFEST_PARSED: Extract quality levels, start playback
- LEVEL_SWITCHED: Update current quality in store
- FRAG_BUFFERED: Calculate live edge latency

**Safari Fallback:** Native HLS via video.src assignment

### Player Controls

```
┌─────────────────────────────────────────────────────────────────┐
│                      Player Controls Bar                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────┐  ┌────────────────────────┐   │
│  │       Controls Left         │  │     Controls Right     │   │
│  ├─────────────────────────────┤  ├────────────────────────┤   │
│  │ [Play/Pause]                │  │ [Settings] ──▶ QualityMenu│
│  │ [Volume Slider]             │  │ [Fullscreen Toggle]    │   │
│  │ [LIVE indicator]            │  │                        │   │
│  │   - Red dot + "LIVE"        │  │                        │   │
│  │   - Gray + "Xs behind"      │  │                        │   │
│  └─────────────────────────────┘  └────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**LIVE Indicator States:**
- currentLatency <= 5s: Red background, pulsing dot, "LIVE" text
- currentLatency > 5s: Gray background, clickable "Xs behind" to jump to live

**Quality Menu:** Lists available resolutions with bitrate, allows manual selection or "Auto"

### Player Layout CSS

```
┌─────────────────────────────────────────────────────────────────┐
│                       Channel Page Grid                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Normal Mode:          grid-template-columns: 1fr 340px         │
│  ┌───────────────────────────────┬────────────┐                 │
│  │                               │            │                 │
│  │         Video Player          │    Chat    │                 │
│  │         (16:9 aspect)         │   Panel    │                 │
│  │                               │            │                 │
│  └───────────────────────────────┴────────────┘                 │
│                                                                  │
│  Theater Mode:         grid-template-rows: 1fr auto             │
│  ┌────────────────────────────────────────────┐                 │
│  │              Video Player                  │                 │
│  ├────────────────────────────────────────────┤                 │
│  │              Chat (collapsed)              │                 │
│  └────────────────────────────────────────────┘                 │
│                                                                  │
│  Fullscreen:           grid-template-columns: 1fr               │
│  ┌────────────────────────────────────────────┐                 │
│  │              Video Player Only             │                 │
│  └────────────────────────────────────────────┘                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Chat Component System (10 minutes)

### WebSocket Chat Connection

**Hook: useChatWebSocket(channelId)**

```
┌─────────────────────────────────────────────────────────────────┐
│                   WebSocket Lifecycle                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Connect ───▶ onopen ───▶ Join channel room                     │
│                   │                                              │
│                   ▼                                              │
│              setConnectionStatus('connected')                    │
│              reconnectAttempts = 0                               │
│                                                                  │
│  Receive ───▶ onmessage ───▶ Parse JSON                         │
│                   │                                              │
│                   ├── type: 'message' ──▶ addMessage()          │
│                   ├── type: 'user_banned' ──▶ Hide messages     │
│                   ├── type: 'clear_chat' ──▶ clearMessages()    │
│                   └── type: 'slow_mode' ──▶ setSlowMode()       │
│                                                                  │
│  Disconnect ─▶ onclose ───▶ Exponential backoff reconnect       │
│                   │         delay = min(1000 * 2^attempts, 30s) │
│                   │         attempts++                           │
│                   └────────▶ setTimeout(connect, delay)          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Chat Message List with Virtualization

Uses @tanstack/react-virtual for efficient rendering of high-volume chat.

**Configuration:**
- estimateSize: 28px per message
- overscan: 20 extra messages for smooth scrolling

**Auto-scroll Logic:**
- Track isAutoScroll state (default: true)
- On new messages: scroll to bottom if isAutoScroll
- On manual scroll: detect if user is at bottom (within 50px)
- Show "More messages below" button when not at bottom

### Emote Rendering System

**ChatMessage Component:**

1. Parse message content for emote positions
2. Sort emotes by start position
3. Build parts array: text segments + emote images
4. Render badges before username

**Emote Image:** Fetched from global or channel emote store, rendered inline with text

**Badge Icons:**
- broadcaster: microphone
- moderator: sword
- vip: diamond
- subscriber: star (with tier variants)

### Chat Input with Emote Picker

```
┌─────────────────────────────────────────────────────────────────┐
│                       Chat Input Form                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────────────────────────────┬──────────┐           │
│  │  Input Field                          │  Emote   │           │
│  │  - placeholder: "Send a message"      │  Picker  │           │
│  │  - disabled during cooldown           │  Button  │           │
│  │  - maxLength: 500                     │          │           │
│  └───────────────────────────────────────┴──────────┘           │
│                                                                  │
│  ┌───────────────────────────────────────────────────┐          │
│  │ Footer                                            │          │
│  │ [Slow mode: 30s indicator]        [Chat] button   │          │
│  └───────────────────────────────────────────────────┘          │
│                                                                  │
│  Emote Picker (when open):                                       │
│  ┌───────────────────────────────────────────────────┐          │
│  │ Grid of emotes from global + channel sets         │          │
│  │ Click inserts emote name into input               │          │
│  └───────────────────────────────────────────────────┘          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Slow Mode:** Shows countdown when user is in cooldown, disables input

---

## 5. Browse Page with Stream Cards (5 minutes)

### Virtualized Stream Grid

Uses row-based virtualization for responsive grid layouts.

**Responsive Column Count:**
- < 640px: 1 column
- < 1024px: 2 columns
- < 1280px: 3 columns
- >= 1280px: 4 columns

**Virtualization Config:**
- Count: Math.ceil(streams.length / columns)
- estimateSize: 280px (card height + gap)
- overscan: 2 rows

**Row Rendering:** Each virtual row renders columns number of StreamCard components

### Stream Card with Live Preview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Stream Card                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────────────────────────────────────────┐          │
│  │ Thumbnail Container                               │          │
│  │                                                   │          │
│  │  [Static Thumbnail Image]                         │          │
│  │                                                   │          │
│  │  On Hover: [Preview Video overlay]               │          │
│  │            autoPlay, muted, loop                 │          │
│  │            Fades in when loaded                  │          │
│  │                                                   │          │
│  │  ┌─────────────────┐                             │          │
│  │  │ [*] 12.5K       │  <- Viewer count badge      │          │
│  │  └─────────────────┘                             │          │
│  └───────────────────────────────────────────────────┘          │
│                                                                  │
│  ┌───────────────────────────────────────────────────┐          │
│  │ Stream Info                                       │          │
│  │ ┌────────┐ ┌──────────────────────────────────┐  │          │
│  │ │ Avatar │ │ Stream Title (truncated)         │  │          │
│  │ │        │ │ Channel Name                     │  │          │
│  │ │        │ │ Category                         │  │          │
│  │ └────────┘ └──────────────────────────────────┘  │          │
│  └───────────────────────────────────────────────────┘          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Viewer Count Formatting:**
- >= 1M: "1.2M"
- >= 1K: "12.5K"
- < 1K: raw number

---

## 6. Creator Dashboard (5 minutes)

### Stream Management Controls

```
┌─────────────────────────────────────────────────────────────────┐
│                      Creator Dashboard                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Stream Settings Section                                  │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │                                                          │    │
│  │  Stream Key:                                             │    │
│  │  ┌────────────────────────────┬────────┬────────┐       │    │
│  │  │ ************************** │ Show   │ Copy   │       │    │
│  │  └────────────────────────────┴────────┴────────┘       │    │
│  │  [Regenerate Key] button                                 │    │
│  │  Warning: Regenerating will invalidate current key       │    │
│  │                                                          │    │
│  │  Stream Status:                                          │    │
│  │  [●] Currently Live  |  1,234 viewers                   │    │
│  │  or                                                      │    │
│  │  [○] Offline         [Start Stream (Simulated)]         │    │
│  │                                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Chat Settings Section                                    │    │
│  │ (ChatModerationSettings component)                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Chat Moderation Settings

| Setting | Options | Description |
|---------|---------|-------------|
| Slow Mode | Off, 5s, 10s, 30s, 60s, 120s | Limit message frequency |
| Subscriber-Only | Toggle | Only subscribers can chat |
| Follower-Only | Toggle + duration | Require follow time before chatting |
| Follower Min Time | 0, 10min, 30min, 1hr, 1day, 1week | How long user must be following |

---

## 7. Accessibility and Performance (4 minutes)

### Accessibility Features

**Chat Panel:**
- role="complementary" with aria-label="Stream chat"
- Chat messages area: role="log", aria-live="polite", aria-atomic="false"

**Live Announcements:**
- Screen reader status div: role="status", aria-live="polite", sr-only class
- Announces events like new subscribers

**Keyboard Navigation:**
- All interactive elements are focusable
- Tab navigation through controls
- Escape to close modals/menus

### Performance Optimizations

| Technique | Application |
|-----------|-------------|
| Lazy loading | VideoPlayer component loaded on demand |
| Memoization | ChatMessage wrapped in React.memo, keyed by message.id |
| Debouncing | Viewer count updates every 30 seconds |
| Virtualization | Chat messages and stream grid use @tanstack/react-virtual |

---

## 8. Summary (3 minutes)

### Key Frontend Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Video Player | HLS.js | Cross-browser HLS support, low-latency mode |
| Chat Virtualization | @tanstack/react-virtual | Handle 100K+ messages efficiently |
| State Management | Zustand | Simple, performant, TypeScript-friendly |
| WebSocket | Native + reconnection logic | Real-time chat with reliability |
| Emote Rendering | Inline parsing | Seamless emote/text mixing |

### Performance Metrics

- **First Contentful Paint**: < 1.5s
- **Time to Interactive**: < 3s
- **Video Start**: < 2s from click
- **Chat Message Latency**: < 100ms end-to-end

### Trade-offs Made

1. **HLS over WebRTC**: Higher latency (2-5s) but better scalability and CDN compatibility
2. **Virtualized chat**: More complex implementation but handles massive chat volumes
3. **Emote caching**: Pre-load emotes vs. lazy load - chose pre-load for instant rendering

### What Would Be Different at Scale

1. **Video Preview**: Hover previews via separate low-bitrate streams
2. **Emote CDN**: Third-party emote providers (BTTV, FFZ, 7TV) integration
3. **Chat Sharding**: Connect to regional chat servers for lower latency
4. **Clip Creation**: Client-side segment stitching with canvas recording
