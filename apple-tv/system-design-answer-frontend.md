# Apple TV+ - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Problem Statement

Design the frontend application for a premium video streaming service that:
- Provides a cinematic browsing experience across devices
- Delivers smooth video playback with adaptive quality
- Supports cross-device watch progress synchronization
- Offers profile management and personalized recommendations

## Requirements Clarification

### Functional Requirements
1. **Browse**: Discover content through hero banners, rows, and search
2. **Watch**: Full-screen video player with controls and quality selection
3. **Continue**: Resume playback across devices with synced progress
4. **Profiles**: Family sharing with individual profiles
5. **Downloads**: Save content for offline viewing

### Non-Functional Requirements
1. **Performance**: < 2s time to interactive on initial load
2. **Responsiveness**: Support iPhone, iPad, Apple TV, Mac, and web
3. **Accessibility**: VoiceOver support, keyboard navigation, captions
4. **Offline**: Graceful degradation with cached content

### Key User Flows
- Browse home page with featured content
- Select and watch content with adaptive streaming
- Manage watch history and continue watching
- Switch between family member profiles

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        React Application                         │
├─────────────────────────────────────────────────────────────────┤
│  Routes (Tanstack Router)                                        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │  Home   │ │ Content │ │  Watch  │ │ Profile │ │  Admin  │   │
│  │    /    │ │/:id     │ │/:id     │ │/profiles│ │ /admin  │   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  Components                                                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐             │
│  │   Layout     │ │   Content    │ │    Player    │             │
│  │  - Header    │ │  - HeroBanner│ │  - Controls  │             │
│  │  - Sidebar   │ │  - ContentRow│ │  - ProgressBar│            │
│  │  - Footer    │ │  - ContentCard││  - Quality   │             │
│  └──────────────┘ └──────────────┘ └──────────────┘             │
├─────────────────────────────────────────────────────────────────┤
│  State (Zustand)                                                 │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐             │
│  │  authStore   │ │ contentStore │ │ playerStore  │             │
│  │  - user      │ │  - catalog   │ │  - isPlaying │             │
│  │  - profile   │ │  - continue  │ │  - position  │             │
│  │  - session   │ │  - watchlist │ │  - quality   │             │
│  └──────────────┘ └──────────────┘ └──────────────┘             │
├─────────────────────────────────────────────────────────────────┤
│  Services                                                        │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐             │
│  │   API Client │ │  HLS Player  │ │  Progress    │             │
│  │   (fetch)    │ │  (hls.js)    │ │  Sync        │             │
│  └──────────────┘ └──────────────┘ └──────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Deep Dive: Zustand State Management

### Auth Store

| Field | Type | Description |
|-------|------|-------------|
| user | User or null | Authenticated user info |
| profile | Profile or null | Currently selected profile |
| profiles | Profile[] | All profiles for account |
| isAuthenticated | boolean | Auth status flag |

**Actions:**
- `login(username, password)` - Authenticate and fetch profiles
- `logout()` - Clear session and reset state
- `selectProfile(profileId)` - Switch active profile, clear content cache
- `fetchProfiles()` - Load all profiles for account

**Persistence:** Uses Zustand persist middleware to store user, profile, and auth status in localStorage.

### Player Store

| Field | Type | Description |
|-------|------|-------------|
| isPlaying | boolean | Playback state |
| currentTime | number | Current position in seconds |
| duration | number | Total content duration |
| buffered | number | Buffered amount in seconds |
| quality | QualityLevel | Current quality setting |
| availableQualities | QualityLevel[] | Quality options from manifest |
| autoQuality | boolean | Auto quality selection enabled |
| showControls | boolean | Controls overlay visibility |
| isFullscreen | boolean | Fullscreen mode state |
| volume | number | Volume level (0-1) |
| isMuted | boolean | Mute state |
| currentContent | Content or null | Current video metadata |

**Actions:**
- `play()` / `pause()` - Toggle playback
- `seek(time)` - Jump to position
- `setQuality(quality)` - Switch quality level
- `toggleFullscreen()` - Enter/exit fullscreen
- `setVolume(volume)` / `toggleMute()` - Audio controls
- `loadContent(contentId)` - Fetch content details and resume position
- `saveProgress()` - Persist watch progress to server

---

## Deep Dive: Video Player Component

### Main Player Component

**HLS Initialization Flow:**
```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Component    │────>│ Create Hls   │────>│ Load Master  │
│ Mount        │     │ Instance     │     │ Playlist     │
└──────────────┘     └──────────────┘     └──────────────┘
                                                 │
                                                 v
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Store        │<────│ Extract      │<────│ MANIFEST_    │
│ Qualities    │     │ Quality Levels│     │ PARSED Event │
└──────────────┘     └──────────────┘     └──────────────┘
```

**Key Features:**
- HLS.js configuration: worker enabled, 90s back buffer
- Auto-hide controls after 3 seconds of inactivity
- Keyboard shortcuts for playback control
- Progress auto-save every 30 seconds
- Save progress on component unmount

**Keyboard Controls:**
| Key | Action |
|-----|--------|
| Space | Play/Pause |
| Arrow Left | Skip back 10 seconds |
| Arrow Right | Skip forward 30 seconds |
| Arrow Up/Down | Volume control |
| Escape | Exit fullscreen |
| F | Toggle fullscreen |
| M | Toggle mute |

### Progress Bar Component

**Visual Layers:**
```
┌────────────────────────────────────────────────────────┐
│ Background (white/30)                                   │
│ ┌─────────────────────────────────────────┐            │
│ │ Buffered progress (white/50)            │            │
│ │ ┌────────────────────────────┐          │            │
│ │ │ Current progress (white)   │ [Handle] │            │
│ │ └────────────────────────────┘          │            │
│ └─────────────────────────────────────────┘            │
└────────────────────────────────────────────────────────┘
          ↑
    [Time Tooltip]
```

**Interactions:**
- Click anywhere to seek to that position
- Drag handle for scrubbing
- Hover shows time tooltip
- Bar expands on hover for easier targeting
- Time display shows current/duration below bar

**Time Formatting:**
- Under 1 hour: `M:SS` (e.g., "45:32")
- Over 1 hour: `H:MM:SS` (e.g., "1:45:32")

### Quality Selection Component

**Quality Label Mapping:**
| Height | Label |
|--------|-------|
| >= 2160 | 4K |
| >= 1080 | HD |
| >= 720 | HD |
| < 720 | SD |

**Display Format:** `{height}p {label}` with bitrate in Mbps (e.g., "1080p HD 5.8 Mbps")

**Auto Quality:**
- Default selection
- Adapts based on network conditions
- Shown as "Auto" in menu

---

## Deep Dive: Content Browsing Experience

### Hero Banner Component

**Layout Structure:**
```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  [Background Image with Parallax Effect]                       │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Gradient: from-gray-900 via-transparent to-transparent   │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Gradient: from-gray-900/80 via-transparent to-transparent │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌─────────────────────────────────────┐                       │
│  │ [Logo or Title]                     │                       │
│  │                                     │                       │
│  │ 2023 | PG-13 | 2h 15m | [4K] [HDR]  │                       │
│  │                                     │                       │
│  │ Description text (3 lines max)...   │                       │
│  │                                     │                       │
│  │ [Play Button] [More Info Button]    │                       │
│  └─────────────────────────────────────┘                       │
└────────────────────────────────────────────────────────────────┘
```

**Animations:**
- Background scales from 1.1 to 1 over 1.5 seconds (parallax)
- Content fades in and slides up with 0.3s delay

### Content Row Component

**Scroll Behavior:**
```
┌──────────────────────────────────────────────────────────────┐
│ Section Title                                                 │
├──────────────────────────────────────────────────────────────┤
│ [<]                                                     [>]  │
│      ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐        │
│      │Card │ │Card │ │Card │ │Card │ │Card │ │Card │ ...    │
│      └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Features:**
- CSS scroll snap for smooth navigation
- Arrow buttons appear on hover
- Scrolls 80% of container width per click
- Left arrow hidden at start, right arrow hidden at end
- Gradient overlays on edges indicate scrollability

### Content Card Component

**Card Sizes:**
| Size | Width | Aspect Ratio |
|------|-------|--------------|
| normal | 160-200px | 2:3 (poster) |
| large | 280-350px | 16:9 (thumbnail) |

**States:**
- Default: Show thumbnail/poster
- Hovered: Scale to 1.05, show play icon overlay
- With progress: Red progress bar at bottom

---

## Deep Dive: Custom Hooks

### useAutoHideControls

**Behavior:**
1. Show controls on mouse move, click, or keypress
2. Start hide timer (default: 3 seconds)
3. Hide controls when timer expires (only if playing)
4. Reset timer on any activity

### useKeyboardControls

**Input Filtering:**
- Ignores keypresses when typing in input/textarea
- Prevents default for navigation keys
- Maps keys to player actions

### useProgressAutoSave

**Save Triggers:**
1. Every 30 seconds during playback
2. When tab becomes hidden (visibilitychange)
3. Before page unload (beforeunload)
4. On component unmount

---

## Accessibility Implementation

**ARIA Attributes:**
- `role="application"` on player container
- `aria-label` for all buttons
- `aria-pressed` for toggle buttons
- `aria-valuetext` for seek slider
- `aria-live="polite"` for status announcements

**Screen Reader Announcements:**
- Playback state changes (Playing/Paused)
- Current time and duration
- Quality changes

**Keyboard Navigation:**
- Full keyboard control for all player functions
- Focus management for modal overlays
- Skip to content links

---

## Performance Optimizations

### Image Loading Strategy

**Progressive Loading:**
```
┌────────────────────────────────────────┐
│ 1. Load low-res thumbnail (blurred)    │
│    └── Visible immediately             │
│                                        │
│ 2. Load full-res image in background   │
│    └── Lazy loaded                     │
│                                        │
│ 3. Fade in full image, fade out blur   │
│    └── 300ms transition                │
└────────────────────────────────────────┘
```

### Content Prefetching

**Hover Prefetch Strategy:**
- Track prefetched content IDs to avoid duplicates
- On card hover: fetch content details via API
- Preload poster image
- Cache in content store for instant navigation

---

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Zustand over Redux | Simpler API, less boilerplate | Smaller ecosystem |
| hls.js | Wide browser support, feature-rich | Bundle size (~80KB) |
| CSS scroll snap | Native feel, performant | Limited customization |
| Framer Motion | Declarative animations | Additional bundle size |
| Local storage persist | Offline session support | Storage limits |
| Lazy image loading | Faster initial load | Content shifts |

---

## Future Frontend Enhancements

1. **Picture-in-Picture**: Mini player while browsing
2. **Offline Downloads**: Service Worker caching
3. **TV Navigation**: D-pad focus management for Apple TV
4. **Immersive Sound**: Spatial audio visualization
5. **Gesture Controls**: Swipe to seek on touch devices
6. **AI Search**: Natural language content search
