# System Design: Video Conferencing (Frontend Focus)

## 1. Requirements Clarification

> "I'll design the frontend for a Zoom-like video conferencing application. The key frontend challenges are: dynamic video grid layout, WebRTC media management, device selection UX, real-time state synchronization, and screen sharing."

**Functional Requirements:**
- Meeting lobby with camera/mic preview and device selection
- Dynamic video grid adapting to participant count (1 to 25+)
- Screen sharing with presenter layout
- Control bar (mute, camera, screen share, hand raise, chat, participants)
- In-call chat with DM support
- Breakout room management UI (host)
- Meeting scheduling and joining by code

**Non-Functional Requirements:**
- 60 FPS video rendering with 25 participants
- Sub-100ms UI response to control toggles
- Graceful handling of device permission denials
- Responsive layout (desktop focus, basic tablet support)

---

## 2. Component Architecture

```
┌─────────────────────────────────────────────┐
│                 App Shell                    │
│  ┌───────────────────────────────────────┐  │
│  │              Router                   │  │
│  │  ┌─────────┬──────────┬───────────┐   │  │
│  │  │Dashboard│ Schedule │  Meeting   │   │  │
│  │  │         │          │  Room      │   │  │
│  │  └─────────┴──────────┴───────────┘   │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  State Layer:                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ AuthStore│ │MeetingStr│ │MediaStore│    │
│  │ (Zustand)│ │ (Zustand)│ │ (Zustand)│    │
│  └──────────┘ └──────────┘ └──────────┘    │
│                                             │
│  Service Layer:                             │
│  ┌──────────────┐  ┌───────────────┐       │
│  │  API Client   │  │  WS Client   │       │
│  │  (REST/fetch) │  │  (signaling) │       │
│  └──────────────┘  └───────────────┘       │
└─────────────────────────────────────────────┘
```

---

## 3. Video Grid Layout Deep Dive

> "The video grid is the most performance-critical component. It must dynamically resize and reorganize as participants join, leave, toggle video, or share screens."

### Grid Layout Algorithm

| Participants | Grid | Layout |
|-------------|------|--------|
| 1 | 1x1 | Full screen |
| 2 | 1x2 | Side by side |
| 3-4 | 2x2 | 2 columns, 2 rows |
| 5-6 | 3x2 | 3 columns, 2 rows |
| 7-9 | 3x3 | 3 columns, 3 rows |
| 10-16 | 4x4 | 4 columns, 4 rows |
| 17-25 | 5x5 | 5 columns, scrollable |

```
┌──────────────────────────────────────────┐
│  2x2 Grid (4 participants)               │
│  ┌──────────────┬──────────────┐         │
│  │   Alice (You)│    Bob       │         │
│  │   [video]    │   [video]    │         │
│  │   [mic icon] │   [mic icon] │         │
│  ├──────────────┼──────────────┤         │
│  │   Charlie    │    Diana     │         │
│  │   [avatar]   │   [video]    │         │
│  │   [muted]    │   [mic icon] │         │
│  └──────────────┴──────────────┘         │
└──────────────────────────────────────────┘
```

### Screen Share Layout

> "When someone shares their screen, the layout shifts fundamentally. The shared content takes 75% of the viewport, with participants in a vertical strip on the right."

```
┌──────────────────────────────┬──────────┐
│                              │  Alice   │
│                              │  [video] │
│    Screen Share Content      ├──────────┤
│    (75% width)               │  Bob     │
│                              │  [video] │
│    ┌──────────────────┐      ├──────────┤
│    │  Presenter's     │      │  Charlie │
│    │  desktop/app     │      │  [avatar]│
│    └──────────────────┘      ├──────────┤
│                              │  Diana   │
│                              │  [video] │
└──────────────────────────────┴──────────┘
```

> "The trade-off with screen sharing layout is between screen content visibility and participant awareness. Zoom uses 75/25 split, Google Meet uses 80/20. I chose 75/25 because seeing participant reactions during presentations (nodding, hand raises) is critical for engagement. The strip is scrollable for meetings with many participants."

---

## 4. Meeting Lobby

> "The lobby is where users configure their media devices before joining. This is crucial UX — a bad first impression (wrong camera, no mic) ruins the meeting experience."

### Lobby Flow

```
┌─────────────────────────────────────────┐
│         Meeting Lobby                    │
│                                          │
│  ┌──────────────────────────────────┐   │
│  │                                  │   │
│  │     Camera Preview               │   │
│  │     (local video, mirrored)      │   │
│  │                                  │   │
│  │     ┌─────┐ ┌─────┐             │   │
│  │     │ Mic │ │ Cam │             │   │
│  │     │ On  │ │ On  │             │   │
│  │     └─────┘ └─────┘             │   │
│  └──────────────────────────────────┘   │
│                                          │
│  Camera:  [Built-in FaceTime ▼]         │
│  Mic:     [Built-in Microphone ▼]       │
│                                          │
│  Display Name: [Alice Johnson    ]       │
│                                          │
│  ┌──────────────────────────────────┐   │
│  │         Join Meeting              │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### useMediaDevices Hook

> "I encapsulate all WebRTC device logic in a custom hook. This keeps components clean and handles the complex device permission flow."

**Hook responsibilities:**
1. Enumerate devices via `navigator.mediaDevices.enumerateDevices()`
2. Request media stream via `navigator.mediaDevices.getUserMedia()`
3. Handle device change events (plug/unplug)
4. Manage mute/unmute by toggling track.enabled
5. Switch cameras/mics by creating new stream with device constraints

**Permission handling flow:**
```
User opens lobby
      │
      ▼
Request getUserMedia({video: true, audio: true})
      │
      ├── Granted ──▶ Show preview, enumerate labeled devices
      │
      ├── Denied ──▶ Show error message, allow joining audio-only
      │
      └── Dismissed ──▶ Show prompt explaining why permissions needed
```

> "A key UX decision: we mirror the local video (CSS `scaleX(-1)`) because users expect to see themselves as in a mirror. Remote participants see un-mirrored video. This seems trivial but getting it wrong makes users feel disoriented — they wave their right hand and see the left hand move."

---

## 5. State Management

> "Video conferencing has three distinct state domains that update at different frequencies."

### State Domains

| Store | Update Frequency | Contents |
|-------|-----------------|----------|
| **AuthStore** | Rarely (login/logout) | Current user, loading state |
| **MeetingStore** | Frequently (per participant action) | Meeting info, participants, chat messages, breakout rooms, panel visibility |
| **MediaStore** | Often (toggle controls) | Local stream, mute/video/screen/hand state, device selection |

### Why Zustand over Redux

| Approach | Pros | Cons |
|----------|------|------|
| **Zustand** | Minimal boilerplate, no providers, selective subscriptions | Less opinionated |
| **Redux** | Time-travel debugging, middleware ecosystem | Verbose for real-time state |

> "I chose Zustand because video conferencing state changes are frequent and fine-grained. When one participant mutes, I only want to re-render their VideoTile, not the entire grid. Zustand's selector-based subscriptions give me this for free. Redux would require careful memoization or normalized state to avoid cascading re-renders when participant state updates at 10+ times per second."

---

## 6. WebSocket Signaling Client

### Connection Lifecycle

```
┌──────┐    ┌─────────┐    ┌───────────┐    ┌──────────┐
│Login │───▶│ Connect  │───▶│Join Meeting│───▶│In Meeting│
│      │    │WebSocket │    │(signaling) │    │(media)   │
└──────┘    └────┬─────┘    └───────────┘    └────┬─────┘
                 │                                │
                 │  on close (unexpected)          │
                 │◀───────────────────────────────│
                 │                                │
                 ▼                                │
          ┌──────────────┐                        │
          │  Reconnect   │──(rejoin meeting)──────▶│
          │  (exp backoff)│                        │
          └──────────────┘
```

### Event-Driven Architecture

The WebSocket client uses an event emitter pattern:

```
wsClient.on('participant-joined', handler)
wsClient.on('participant-left', handler)
wsClient.on('participant-update', handler)
wsClient.on('chat-message', handler)
wsClient.on('new-producer', handler)
wsClient.on('producer-closed', handler)
```

> "The event-driven pattern decouples the WebSocket transport from the UI. The MeetingPage component registers handlers that update Zustand stores, and individual components subscribe to just the state slices they need. This prevents the classic problem of video conferencing apps: updating the chat panel causing the entire video grid to re-render."

---

## 7. Control Bar

```
┌────────────────────────────────────────────────────────────┐
│  abc-defg-hij    [Mic] [Cam] [Screen] [Hand] │ [Chat] [PPL] [Leave] │
│                   ┴     ┴      ┴       ┴     │   ┴     ┴           │
│                  red  red/  green/   yellow/  │ blue/ blue/   red   │
│                 =muted  off   on      on      │  on    on           │
└────────────────────────────────────────────────────────────┘
```

### Control States

| Control | Active Color | Inactive Color | Action |
|---------|-------------|----------------|--------|
| Mic | Dark gray | Red | Toggle audio track.enabled |
| Camera | Dark gray | Red | Toggle video track.enabled |
| Screen Share | Green | Dark gray | getDisplayMedia / stop track |
| Hand Raise | Yellow | Dark gray | Send WS message |
| Chat | Blue | Dark gray | Toggle chat panel |
| Participants | Blue | Dark gray | Toggle participant list |
| Leave | Red always | - | Disconnect + navigate home |

> "Each toggle has both a local effect (immediately toggle UI state for responsive feel) and a remote effect (send WebSocket message to sync with other participants). The local effect happens synchronously; the remote effect is fire-and-forget. If the WebSocket message fails, the next participant-update from the server will correct the state. This optimistic approach makes controls feel instant."

---

## 8. Video Tile Component

### Tile Anatomy

```
┌────────────────────────────┐
│                            │
│     Video / Avatar         │  ◄── video element or initials circle
│                            │
│                            │
│  ┌─┐                  ┌─┐ │
│  │🔇│  Alice (You)    │✋│ │  ◄── bottom bar with status
│  └─┘                  └─┘ │
└────────────────────────────┘
```

**Rendering conditions:**
- Video ON + stream: Render `<video>` element with srcObject
- Video OFF or no stream: Render avatar circle with initials
- Local user: Mirror video (`scaleX(-1)`), mute audio (`muted` attribute)
- Hand raised: Bouncing hand icon in top-right corner
- Muted: Red mic-off icon in bottom-left

### Performance Considerations

> "Video elements are expensive. With 25 participants, that's 25 simultaneous video decodes. Key optimizations:"

1. **Use `playsInline` attribute** — Prevents mobile browsers from going fullscreen
2. **Set `autoPlay` + `muted` for local** — Chrome requires muted for autoplay
3. **Avoid re-mounting video elements** — Keep them in DOM, just swap srcObject
4. **Use CSS Grid, not Flexbox** — CSS Grid handles the dynamic layout without JS calculations
5. **Debounce grid layout changes** — When participants join/leave rapidly, batch grid recalculations

---

## 9. Chat Panel

### Chat UX Decisions

```
┌──────────────────────────┐
│ Chat                     │
├──────────────────────────┤
│                          │
│ Alice  10:32 AM          │
│ ┌─────────────────────┐  │
│ │ Welcome everyone!   │  │
│ └─────────────────────┘  │
│                          │
│            You  10:33 AM │
│  ┌─────────────────────┐ │
│  │ Thanks! Ready to go │ │
│  └─────────────────────┘ │
│                          │
│ Bob (DM)  10:34 AM       │
│ ┌─────────────────────┐  │
│ │ Can you share that?  │  │
│ └─────────────────────┘  │
│                          │
├──────────────────────────┤
│ To: [Everyone      ▼]   │
│ ┌────────────────┐ ┌──┐ │
│ │ Type message...│ │▶ │ │
│ └────────────────┘ └──┘ │
└──────────────────────────┘
```

- **Recipient selector**: Dropdown with "Everyone" and individual participant names for DMs
- **Auto-scroll**: New messages scroll into view with smooth animation
- **DM indicator**: Orange "(DM)" label on private messages
- **Fixed width**: 288px (w-72) sidebar, consistent with Participant List panel

---

## 10. Responsive Design Strategy

| Viewport | Grid Max | Side Panel | Control Bar |
|----------|----------|------------|-------------|
| Desktop (1200px+) | 5x5 | 288px sidebar | Full controls |
| Tablet (768-1199px) | 3x3 | Overlay modal | Compact icons |
| Mobile (< 768px) | 2x2 | Full screen overlay | Bottom sheet |

> "Video conferencing is fundamentally a desktop-first experience — you need screen real estate for multiple video tiles. Mobile support is secondary but important for joining meetings on the go. On mobile, I'd use a swipeable carousel of video tiles instead of a grid, showing 1-2 tiles at a time."

---

## 11. Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Grid layout | CSS Grid | Flexbox / JS layout | Native responsive without JS calculations |
| State management | Zustand | Redux / Context | Selector subscriptions prevent cascade re-renders |
| Video mirroring | CSS scaleX(-1) local only | No mirroring | Natural mirror experience for self-view |
| Chat panel | Fixed sidebar | Overlay popup | Always visible without covering video |
| Device handling | Custom hook | Library (react-media-devices) | Full control over permission flow |
| Routing | TanStack Router | React Router | Type-safe params, built-in code splitting |
| Side panel exclusivity | One panel at a time | Multiple panels | Preserves video grid space |

---

## 12. Accessibility Considerations

- **Keyboard navigation**: Tab through control bar, Enter to toggle
- **ARIA labels**: All icon-only buttons have descriptive labels
- **Focus management**: When chat panel opens, focus moves to message input
- **Color contrast**: White text on dark backgrounds exceeds WCAG AA ratio
- **Screen reader**: Participant state changes announced as live regions
- **Reduced motion**: Disable hand-raise bounce animation when prefers-reduced-motion
