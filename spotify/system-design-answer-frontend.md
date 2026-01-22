# Spotify - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Introduction (2 minutes)

"Thank you. Today I'll design Spotify, a music streaming platform. As a frontend engineer, I'll focus on the core challenges of building an audio player experience, managing complex playback state, and delivering personalized recommendations in an intuitive interface.

The key frontend challenges are:
1. Building a persistent audio player with queue management and shuffle/repeat
2. Designing responsive library and playlist views with virtualized lists
3. Real-time playback state sync across components
4. Offline-first architecture for downloaded content

Let me start by clarifying the requirements."

---

## Requirements Clarification (5 minutes)

### Functional Requirements

"For our core product:

1. **Playback**: Full-featured audio player with queue, shuffle, repeat modes
2. **Library**: Browse saved tracks, albums, artists with search and filtering
3. **Playlists**: Create, edit, reorder tracks with drag-and-drop
4. **Discovery**: Browse personalized recommendations (Discover Weekly, Daily Mixes)
5. **Now Playing**: Immersive full-screen view with album art and lyrics

From a frontend perspective, the player experience and library management are the most interesting challenges."

### Non-Functional Requirements

"For user experience:

- **Playback Start**: Under 200ms perceived latency
- **Smooth Scrolling**: 60 FPS in library views with thousands of tracks
- **Responsive**: Adapt layout from mobile (320px) to desktop (1920px+)
- **Accessibility**: Full keyboard navigation, screen reader support
- **Offline**: Seamless transition between online and downloaded content"

---

## High-Level Design (8 minutes)

### Component Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           App Shell                                  │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                        Header Bar                                ││
│  │   Logo │ Search │ Navigation │ Profile                          ││
│  └─────────────────────────────────────────────────────────────────┘│
│  ┌───────────────┐ ┌───────────────────────────────────────────────┐│
│  │               │ │                                               ││
│  │   Sidebar     │ │              Main Content                     ││
│  │               │ │                                               ││
│  │ - Home        │ │   ┌─────────────────────────────────────────┐ ││
│  │ - Search      │ │   │                                         │ ││
│  │ - Library     │ │   │   Route Content                         │ ││
│  │ ─────────     │ │   │   (Home/Search/Playlist/Album/Artist)   │ ││
│  │ - Playlists   │ │   │                                         │ ││
│  │ - Artists     │ │   │                                         │ ││
│  │ - Albums      │ │   └─────────────────────────────────────────┘ ││
│  │               │ │                                               ││
│  └───────────────┘ └───────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                     Now Playing Bar                              ││
│  │  [Album] Track Info │ Controls │ Progress │ Volume │ Queue      ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

- React 19 with TypeScript
- TanStack Router for file-based routing
- Zustand for global state (player, library, queue)
- @tanstack/react-virtual for virtualized lists
- Tailwind CSS for styling
- Web Audio API for advanced playback features

---

## Deep Dive: Player Store Architecture (12 minutes)

### State Structure

**Track Interface:**
- id, title, duration_ms
- album: { id, title, cover_url }
- artist: { id, name }
- explicit: boolean

**PlayerState:**
- Playback: currentTrack, isPlaying, currentTime, duration, volume, isMuted
- Queue: queue[], queueIndex, originalQueue[] (for shuffle restore)
- Modes: shuffleEnabled, repeatMode ('off' | 'all' | 'one')
- UI: isQueueVisible, isNowPlayingExpanded

**PlayerActions:**
- Playback: play(), pause(), toggle(), seek(), setVolume(), toggleMute()
- Queue: playTrack(), playQueue(), addToQueue(), removeFromQueue(), clearQueue()
- Navigation: skipNext(), skipPrevious()
- Modes: toggleShuffle(), cycleRepeatMode()

**PlayContext:**
- type: 'album' | 'playlist' | 'artist' | 'search' | 'library'
- id, name

### Player Store Implementation

Zustand store with persist middleware:

**Initial State:** currentTrack: null, isPlaying: false, volume: 1, queue: [], repeatMode: 'off'

**Key Behaviors:**

1. **playQueue(tracks, startIndex):**
   - If shuffle enabled: Fisher-Yates shuffle keeping start track first
   - Store original order in originalQueue for restore
   - Set currentTrack to queue[index]

2. **skipNext():**
   - If repeatMode === 'one': reset currentTime to 0
   - If end of queue && repeatMode === 'all': wrap to index 0
   - Else stop playback

3. **skipPrevious():**
   - If currentTime > 3000ms: restart current track
   - Else go to previous track (wrap to end if at start)

4. **toggleShuffle():**
   - If turning off: restore originalQueue, find current track index
   - If turning on: shuffle remaining tracks after current position

**Persistence:** Only volume, shuffleEnabled, repeatMode persisted to localStorage

### Audio Controller Component

The AudioController manages HTML5 Audio element:

**Track Loading:**
1. Fetch stream URL from `/api/playback/stream/{trackId}`
2. Set audio.src and load()
3. If isPlaying, call audio.play()

**Event Handlers:**
- onTimeUpdate: update store currentTime (converted to ms)
- onEnded: call onTrackEnd() to advance queue
- onPlay/onPause: report analytics events

**Stream Counting:**
- Track 30-second mark (industry standard for royalty counting)
- hasReportedStream ref prevents duplicate reports
- Reset on track change

---

## Deep Dive: Now Playing Bar (8 minutes)

### Layout Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Now Playing Bar                               │
│                                                                      │
│  ┌──────────────┐  ┌────────────────────────────┐  ┌──────────────┐ │
│  │              │  │                            │  │              │ │
│  │  Track Info  │  │     Playback Controls      │  │   Volume &   │ │
│  │  [Album Art] │  │                            │  │    Queue     │ │
│  │  Title       │  │  [Shuffle] [<] [Play] [>]  │  │  [Vol] [Q]   │ │
│  │  Artist      │  │       [Repeat]             │  │              │ │
│  │              │  │                            │  │              │ │
│  │              │  │  0:32 ────●───── 3:45      │  │              │ │
│  │              │  │                            │  │              │ │
│  └──────────────┘  └────────────────────────────┘  └──────────────┘ │
│       w-72                  flex-1                       w-72       │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Features

**Track Info Section (w-72):**
- Album artwork (56x56px rounded)
- Title and artist (truncated)
- Empty state: "Select a track to play"

**Playback Controls (flex-1, centered):**
- Shuffle button (green when enabled, aria-pressed)
- Previous track button
- Play/Pause (larger, white bg, scale on hover)
- Next track button
- Repeat button (cycles: off -> all -> one, shows different icon for 'one')

**Progress Bar:**
- Current time / Duration labels
- ProgressSlider component with hover preview
- Seek on click/drag

**Volume Section (w-72, right-aligned):**
- Mute toggle (different icon when muted)
- VolumeSlider
- Queue toggle button

### Progress Slider Component

Interactive slider with:
- Mouse down to start dragging
- Mouse move to update value (clamped 0-100%)
- Mouse up to stop dragging
- Hover preview showing potential seek position
- ARIA attributes: role="slider", aria-valuemin/max/now
- Visual feedback: green highlight on hover, draggable knob appears

---

## Deep Dive: Virtualized Track List (8 minutes)

### Virtual Scrolling Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Virtualized Track List                            │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ # │ Title                    │ Album     │ Added   │ Duration  ││
│  ├─────────────────────────────────────────────────────────────────┤│
│  │   │        ▲ Overscan (3)    │           │         │           ││
│  ├───┼─────────────────────────────────────────────────────────────┤│
│  │ 1 │ [img] Track Title        │ Album 1   │ 2d ago  │    3:45   ││ ◄─ Visible
│  │ 2 │ [img] Another Track      │ Album 2   │ 3d ago  │    4:12   ││
│  │ 3 │ [img] More Music         │ Album 3   │ 5d ago  │    2:58   ││
│  │ 4 │ [img] Great Song         │ Album 4   │ 1w ago  │    3:33   ││
│  ├───┼─────────────────────────────────────────────────────────────┤│
│  │   │        ▼ Overscan (3)    │           │         │           ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│     Total: 5000 tracks (only ~10-20 rendered at a time)             │
└─────────────────────────────────────────────────────────────────────┘
```

### TrackList Implementation

Uses @tanstack/react-virtual:
- estimateSize: 56px per row
- overscan: 10 items above/below viewport
- Absolute positioning with translateY

**Columns (grid layout):**
- # (16px) - track number or playing indicator
- Title (4fr) - artwork, title, explicit badge, artist
- Album (2fr)
- Date Added (1fr)
- Duration (60px, right-aligned)

**Row Features:**
- Current track highlighted with bg-neutral-800/30
- Playing indicator: equalizer icon (animated)
- Hover: show play icon instead of number
- Click/Enter: play from this position
- Lazy-loaded album art with placeholder

### Performance Optimizations

1. **Memoized Row Components:**
   - Compare by track.id, isCurrentTrack, isPlaying, index
   - Prevents re-renders when other tracks update

2. **Lazy Image Loading:**
   - IntersectionObserver with 100px rootMargin
   - Placeholder with pulse animation
   - Only load src when entering viewport

---

## Deep Dive: Responsive Layout (5 minutes)

### Breakpoint Strategy

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Responsive Breakpoints                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Mobile (<640px)     Tablet (768px+)      Desktop (1024px+)         │
│                                                                      │
│  ┌───────────────┐   ┌──────┬────────┐   ┌──────┬───────────────┐  │
│  │               │   │      │        │   │      │               │  │
│  │    Content    │   │ Side │Content │   │ Side │    Content    │  │
│  │               │   │  bar │        │   │  bar │               │  │
│  │               │   │      │        │   │ 72px │               │  │
│  │               │   │ 60px │        │   │      │               │  │
│  └───────────────┘   └──────┴────────┘   └──────┴───────────────┘  │
│  ┌───────────────┐                                                  │
│  │ Bottom Tabs   │   (Sidebar visible)   (Sidebar wider: lg:w-72)   │
│  │ Home|Srch|Lib │                                                  │
│  └───────────────┘                                                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### AppLayout Structure

- Sidebar: hidden on mobile, md:w-60, lg:w-72
- Main content: pb-20 (mobile) or pb-24 (desktop) for now playing bar
- Mobile nav: fixed bottom tabs (Home, Search, Library)
- Now Playing Bar: compact on mobile (smaller controls)

### Responsive Card Grid

Album/Playlist cards grid:
- grid-cols-2 (mobile)
- sm:grid-cols-3
- md:grid-cols-4
- lg:grid-cols-5
- xl:grid-cols-6

**Card Features:**
- Aspect-square image container
- Artist cards: rounded-full image
- Hover: play button appears with slide-up animation
- Title and subtitle (truncated)

---

## Accessibility Considerations

### Keyboard Navigation

Global shortcuts (when not typing in input):
- Space: toggle play/pause
- Shift+ArrowRight: skip next
- Shift+ArrowLeft: skip previous
- M: toggle mute

### Screen Reader Announcements

Track change announcer:
- role="status", aria-live="polite", aria-atomic="true"
- Visually hidden (sr-only)
- Announces: "Now playing: {title} by {artist}"

---

## Trade-offs and Alternatives

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| State Management | Zustand | Redux Toolkit | Simpler API, built-in persistence, smaller bundle |
| List Virtualization | @tanstack/react-virtual | react-window | More flexible, better dynamic sizing |
| Audio API | Native HTML5 Audio | Web Audio API | Simpler; Web Audio for future equalizer |
| Styling | Tailwind CSS | CSS-in-JS (styled-components) | Better performance, smaller bundle |
| Queue in Store | Single queue array | Separate upcoming/history | Simpler state, easier shuffle/repeat |
| Progress Updates | timeupdate event | requestAnimationFrame | Native event sufficient, less CPU usage |

---

## Future Enhancements (Frontend Focus)

1. **Crossfade**: Use Web Audio API to blend track endings/beginnings
2. **Equalizer**: Audio visualization and EQ controls
3. **Drag-and-Drop Reordering**: In playlists and queue
4. **Offline Mode**: IndexedDB for downloaded tracks with service worker
5. **Spotify Connect**: WebSocket sync for cross-device control
6. **Lyrics Sync**: Scrolling lyrics synchronized with playback position
7. **Picture-in-Picture**: Mini player for multitasking

---

## Summary

"To summarize the frontend architecture:

1. **Zustand player store** managing playback state, queue, shuffle/repeat with localStorage persistence
2. **Audio controller component** coordinating HTML5 Audio with stream URL fetching and analytics reporting
3. **Virtualized track lists** using @tanstack/react-virtual for smooth scrolling through large libraries
4. **Responsive layout** with mobile-first design, collapsible sidebar, and bottom navigation
5. **Accessible controls** with full keyboard support and ARIA attributes

The architecture prioritizes a fluid playback experience with efficient rendering for large music libraries.

What aspects would you like to explore further?"
