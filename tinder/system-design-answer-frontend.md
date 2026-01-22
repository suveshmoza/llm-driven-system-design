# Tinder - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## 1. Requirements Clarification (3 minutes)

### Functional Requirements
- **Swipe Interface**: Card-based UI with drag gestures for like/pass
- **Profile Display**: Photos, bio, distance, common interests
- **Match Celebration**: Animated modal when mutual like occurs
- **Chat Interface**: Real-time messaging with matched users
- **Profile Management**: Edit photos, bio, preferences
- **Discovery Settings**: Configure age, distance, gender preferences

### Non-Functional Requirements
- **Smooth Animations**: 60fps swipe gestures and transitions
- **Responsive Design**: Mobile-first with tablet support
- **Accessibility**: Screen reader support, keyboard navigation
- **Performance**: Fast photo loading, minimal layout shifts
- **Offline Resilience**: Queue actions when disconnected

### User Experience Goals
- Addictive, gamified interaction pattern
- Instant feedback on every action
- Clear visual hierarchy prioritizing photos
- Minimal friction to start swiping

---

## 2. Component Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              App Shell                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Navigation Bar                               │   │
│  │  [Logo]    [Discover]    [Matches]    [Messages]    [Profile]       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│           ┌────────────────────────┼────────────────────────┐               │
│           ▼                        ▼                        ▼               │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────┐     │
│  │   Discovery     │    │     Matches     │    │     Messages        │     │
│  │     View        │    │      Grid       │    │       List          │     │
│  │                 │    │                 │    │                     │     │
│  │ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────────┐ │     │
│  │ │  SwipeDeck  │ │    │ │  MatchCard  │ │    │ │ ConversationList│ │     │
│  │ │  └─SwipeCard│ │    │ │  (grid)     │ │    │ │ └─MessageThread │ │     │
│  │ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────────┘ │     │
│  │                 │    │                 │    │                     │     │
│  │ ┌─────────────┐ │    │                 │    │ ┌─────────────────┐ │     │
│  │ │ActionButtons│ │    │                 │    │ │  MessageInput   │ │     │
│  │ └─────────────┘ │    │                 │    │ └─────────────────┘ │     │
│  └─────────────────┘    └─────────────────┘    └─────────────────────┘     │
│                                                                             │
│  Overlays                                                                   │
│  └── MatchModal (animated celebration with confetti)                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Organization

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Component Structure                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  discovery/                                                                 │
│  ├── SwipeDeck.tsx         Card stack container, prefetch logic            │
│  ├── SwipeCard.tsx         Individual card with drag gestures              │
│  ├── CardPhotoGallery.tsx  Photo carousel with tap navigation              │
│  ├── ProfileDetails.tsx    Expanded info section                           │
│  └── ActionButtons.tsx     Like/Pass/SuperLike/Undo/Boost buttons          │
│                                                                             │
│  matches/                                                                   │
│  ├── MatchGrid.tsx         Grid layout of match cards                      │
│  ├── MatchCard.tsx         Individual match with photo and name            │
│  └── MatchModal.tsx        "It's a Match!" celebration animation           │
│                                                                             │
│  messages/                                                                  │
│  ├── ConversationList.tsx  List of active chats                            │
│  ├── ConversationThread.tsx Full chat view with messages                   │
│  ├── MessageBubble.tsx     Individual message with read receipts           │
│  └── MessageInput.tsx      Compose with typing indicator                   │
│                                                                             │
│  profile/                                                                   │
│  ├── ProfileEditor.tsx     Edit bio and details                            │
│  ├── PhotoUploader.tsx     Drag-to-reorder photo management                │
│  └── PreferencesForm.tsx   Age, distance, gender settings                  │
│                                                                             │
│  shared/                                                                    │
│  ├── Avatar.tsx            User avatar with online indicator               │
│  ├── ProceduralAvatar.tsx  ReignsAvatar fallback for missing photos        │
│  └── DistanceBadge.tsx     "5 miles away" display                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. State Management Design (5 minutes)

### Zustand Stores Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         discoveryStore                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  State                                                                      │
│  ├── deck: ProfileCard[]          Array of profiles to show                │
│  ├── deckIndex: number            Current position in deck                 │
│  ├── isLoading: boolean           Fetching more profiles                   │
│  ├── currentSwipe: { direction, progress } | null                          │
│  └── pendingSwipes: SwipeAction[] Queued for offline resilience            │
│                                                                             │
│  Actions                                                                    │
│  ├── loadDeck()                   Fetch profiles with current location     │
│  ├── swipe(userId, direction)     Optimistic update + API call + rollback  │
│  ├── undoSwipe()                  Decrement deckIndex, call API            │
│  └── setSwipeProgress(dir, pct)   Update visual feedback during drag       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                          matchStore                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  State                                                                      │
│  ├── matches: Match[]             All matched users                        │
│  ├── newMatchCount: number        Unread match count for badge             │
│  └── showMatchModal: MatchModalData | null                                 │
│                                                                             │
│  Actions                                                                    │
│  ├── loadMatches()                Fetch from API                           │
│  ├── handleNewMatch(match)        Add to list, show modal, increment count │
│  └── dismissMatchModal()          Close celebration modal                  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         messageStore                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  State                                                                      │
│  ├── conversations: Map<matchId, Conversation>                             │
│  ├── activeConversationId: string | null                                   │
│  └── typingUsers: Map<matchId, boolean>                                    │
│                                                                             │
│  Actions                                                                    │
│  ├── loadConversation(matchId)    Fetch message history                    │
│  ├── sendMessage(matchId, content) Optimistic add + API call               │
│  ├── handleIncomingMessage(msg)   Add to conversation from WebSocket       │
│  └── setTyping(matchId, isTyping) Update typing indicator                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### WebSocket Integration

The `useWebSocket` hook manages real-time events:

**Connection:**
- Connect to `/events` WebSocket endpoint on mount
- Exponential backoff reconnect (1s, 2s, 4s, ... up to 30s max)
- Reset attempts on successful connection

**Event handling:**
- `match`: Call `handleNewMatch()` to show celebration modal
- `new_message`: Call `handleIncomingMessage()` to update conversation
- `typing`: Call `setTyping()` to show/hide typing indicator

**Outgoing events:**
- `sendTypingIndicator(matchId, isTyping)`: Notify when user is typing

---

## 4. Deep Dive: Swipe Card UI (10 minutes)

### Gesture-Based Swipe Card

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SwipeCard Anatomy                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  [═══════════════════════════════════════════════════════════]      │   │
│  │   ▲ Photo indicators (white bars, active = solid, others = 40%)    │   │
│  │                                                                      │   │
│  │                                                                      │   │
│  │  ┌───────────┐                              ┌───────────┐           │   │
│  │  │   NOPE    │                              │   LIKE    │           │   │
│  │  │  (red)    │     PROFILE PHOTO            │  (green)  │           │   │
│  │  │ rotate 12°│                              │rotate -12°│           │   │
│  │  └───────────┘                              └───────────┘           │   │
│  │       ▲ Opacity increases as card moves left/right                  │   │
│  │                                                                      │   │
│  │  ┌──────────────────────┐ ┌──────────────────────┐                  │   │
│  │  │    Tap left zone     │ │   Tap right zone     │                  │   │
│  │  │    (prev photo)      │ │   (next photo)       │                  │   │
│  │  └──────────────────────┘ └──────────────────────┘                  │   │
│  │                                                                      │   │
│  │  ░░░░░░░░░░░░░░░░░░ Gradient overlay ░░░░░░░░░░░░░░░░░░             │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  Alice, 28                                                   │   │   │
│  │  │  5 miles away                                                │   │   │
│  │  │  "Coffee enthusiast and weekend hiker..."                   │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Swipe Gesture Mechanics

**Thresholds:**
- SWIPE_THRESHOLD = 150px (horizontal for like/pass)
- SUPER_LIKE_THRESHOLD = 100px (vertical up)
- ROTATION_FACTOR = 0.1 (card rotates as it moves)

**Drag handling:**
1. Track pointer position from start
2. Calculate deltaX, deltaY from start position
3. Apply rotation: `rotate = deltaX * 0.1`
4. Update transform: `translate(${deltaX}px, ${deltaY}px) rotate(${rotate}deg)`
5. Update store with swipe direction and progress for visual feedback

**Drag end logic:**
- If `x > 150`: Animate out right, call `onSwipe('like')`
- If `x < -150`: Animate out left, call `onSwipe('pass')`
- If `y < -100`: Animate out up, call `onSwipe('super_like')`
- Otherwise: Spring back to center with bouncy easing

**Animations:**
- Exit animation: 300ms ease-out to off-screen (1.5x window width/height)
- Spring back: 400ms cubic-bezier(0.34, 1.56, 0.64, 1) for bouncy effect

### Swipe Indicators

Overlay labels that fade in as card moves:
- **LIKE** (green): Top-left, rotated -12°, opacity = x / threshold
- **NOPE** (red): Top-right, rotated 12°, opacity = -x / threshold
- **SUPER LIKE** (blue): Top-center, opacity = -y / threshold

### Action Buttons

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Action Button Row                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│      [Undo]    [Pass]    [Super]    [Like]    [Boost]                      │
│       (sm)     (lg)      (sm)       (lg)      (sm)                         │
│      yellow    red       blue       green     purple                        │
│       12x12    16x16     12x12      16x16     12x12                        │
│                                                                             │
│  All buttons: white bg, shadow-lg, hover:scale-110, active:scale-95       │
│  Undo disabled when deckIndex = 0                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Swipe Deck Container

**Behaviors:**
- Load deck on mount with current geolocation
- Prefetch more profiles when `deck.length - deckIndex < 5`
- Render only top 2 cards (current + background)
- Background card: scale-95, translate-y-2, opacity-80
- Show MatchModal when swipe result includes match
- Empty state with refresh button when deck exhausted

---

## 5. Deep Dive: Match Celebration Modal (8 minutes)

### Animated Match Modal

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Match Modal Layout                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ╔═════════════════════════════════════════════════════════════════════╗   │
│  ║     *** CONFETTI PARTICLES FALLING ***                              ║   │
│  ║                                                                      ║   │
│  ║               Gradient background (animated)                         ║   │
│  ║               #ff6b6b → #feca57 → #48dbfb → #ff9ff3                 ║   │
│  ║               background-size: 400% 400%                             ║   │
│  ║               animation: shift 3s ease infinite                      ║   │
│  ║                                                                      ║   │
│  ║      ┌────────────┐    ┌────┐    ┌────────────┐                     ║   │
│  ║      │            │    │ ♥  │    │            │                     ║   │
│  ║      │  Your      │◄───│puls│───►│  Their     │                     ║   │
│  ║      │  Photo     │    │ing │    │  Photo     │                     ║   │
│  ║      │            │    └────┘    │            │                     ║   │
│  ║      └────────────┘              └────────────┘                     ║   │
│  ║         132x132 circles, 4px white border, overlap by -8            ║   │
│  ║                                                                      ║   │
│  ║                    ✨ It's a Match! ✨                               ║   │
│  ║                      (cursive font)                                  ║   │
│  ║                                                                      ║   │
│  ║              You and Alice liked each other                         ║   │
│  ║                                                                      ║   │
│  ║      ┌─────────────────────────────────────────────┐                ║   │
│  ║      │           Send a Message                    │ ◄── Primary   ║   │
│  ║      └─────────────────────────────────────────────┘                ║   │
│  ║      ┌─────────────────────────────────────────────┐                ║   │
│  ║      │            Keep Swiping                     │ ◄── Secondary ║   │
│  ║      └─────────────────────────────────────────────┘                ║   │
│  ║                                                                      ║   │
│  ╚═════════════════════════════════════════════════════════════════════╝   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Animation Sequence

**Phase transitions (controlled by useEffect):**
1. `photos` (0ms): Initial state, photos off-screen
2. `text` (500ms delay): Photos slide in from sides
3. `buttons` (1300ms delay): Text fades up, buttons appear

**Photo animations:**
- Your photo: Start at translateX(-20px) opacity 0
- Their photo: Start at translateX(20px) opacity 0
- Heart icon: Start at scale(0), animate to scale(1) with 200ms delay

**Text animations:**
- "It's a Match!": translateY(4px) → translateY(0) with 300ms delay
- Subtitle: Fade in with 400ms delay

**Buttons:**
- Container: translateY(4px) → translateY(0) with 500ms delay
- Primary button: White bg, pink text, shadow
- Secondary button: White/20 bg, white text

### Confetti Effect

**Canvas-based particle system:**
- Create 100 particles on mount
- Each particle has: x, y, size, color, velocity, rotation, rotationSpeed
- Colors: #ff6b6b, #feca57, #48dbfb, #ff9ff3, #1dd1a1
- Physics: Apply gravity (0.1 per frame), update position
- Remove particles when they fall below canvas
- Clean up on unmount (cancelAnimationFrame, remove canvas)

---

## 6. Deep Dive: Chat Interface (7 minutes)

### Conversation Thread Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     ConversationThread Component                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  [<]  ┌────┐  Alice                                      [•••]     │   │
│  │       │ Av │  Typing...                                            │   │
│  │       └────┘                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Messages area (flex-1, overflow-y-auto, bg-gray-50)                │   │
│  │                                                                      │   │
│  │  ┌────┐  ┌──────────────────────────────────┐                       │   │
│  │  │ Av │  │ Hey! How's it going?             │                       │   │
│  │  └────┘  │ 2:30 PM                          │ ◄── Their message     │   │
│  │          └──────────────────────────────────┘     (white bg,        │   │
│  │                                                    rounded-bl-md)   │   │
│  │                                                                      │   │
│  │               ┌──────────────────────────────────┐  ┌────┐          │   │
│  │               │ Pretty good! Want to grab        │  │ ✓✓ │          │   │
│  │               │ coffee sometime?                 │  └────┘          │   │
│  │               │ 2:32 PM                          │  ◄── Read receipt│   │
│  │               └──────────────────────────────────┘                   │   │
│  │                     ▲ Your message (pink gradient, rounded-br-md)   │   │
│  │                                                                      │   │
│  │  ┌────┐  ┌────────────────┐                                         │   │
│  │  │ Av │  │  ● ● ●         │ ◄── Typing indicator (bouncing dots)   │   │
│  │  └────┘  └────────────────┘                                         │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  [GIF]  [Type a message...                           ]  [Send]     │   │
│  │         └── Input with rounded-full, focus:ring-pink               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Message Behaviors

**Auto-scroll:**
- useRef for messagesEnd div
- scrollIntoView({ behavior: 'smooth' }) on new messages

**Typing indicator:**
- Debounced: Send `typing: true` on input change
- 2-second timeout to send `typing: false`
- Clear timeout on unmount or send

**Message grouping:**
- Show avatar only for first message in consecutive sequence from same sender
- 8px width spacer for alignment when avatar hidden

### Message Bubble Styling

**Their messages (isOwn = false):**
- bg-white, text-gray-900
- rounded-2xl with rounded-bl-md (flat bottom-left)
- shadow-sm

**Your messages (isOwn = true):**
- bg-gradient-to-r from-pink-500 to-rose-500
- text-white
- rounded-2xl with rounded-br-md (flat bottom-right)
- Read receipt checkmark when message.read_at exists

### Typing Indicator Component

Three dots with staggered bounce animation:
- Each dot: w-2 h-2, bg-gray-400, rounded-full
- Animation delay: 0ms, 150ms, 300ms
- Container: white bg, rounded-2xl, rounded-bl-md, shadow-sm

---

## 7. Procedural Avatar System (5 minutes)

### ReignsAvatar Component

Deterministic SVG avatar generation from user ID seed.

**Feature arrays:**
- FACE_SHAPES: round, oval, square, heart
- SKIN_TONES: 5 options from light to dark
- HAIR_STYLES: short, long, curly, bald, ponytail
- HAIR_COLORS: 6 options including natural and fun colors
- EYE_COLORS: blue, green, brown, gray
- ACCESSORIES: none, glasses, earrings, hat

**Hash function:**
- Convert seed string to integer using character codes
- `seededRandom(hash, index)` returns 0-1 float for consistent selection

**SVG structure (100x100 viewBox):**
1. Background circle (r=48, fill=#f0f0f0)
2. Face shape (path varies by shape type)
3. Hair behind (for long styles)
4. Eyes (ellipse white, circle colored, highlight dot)
5. Nose (curved path, slightly darker than skin)
6. Mouth (smile curve)
7. Hair in front (for short styles)
8. Accessories (glasses/earrings if selected)

**Size variants:**
- sm: 32px
- md: 48px
- lg: 96px

---

## 8. Accessibility & Performance (3 minutes)

### Accessibility Features

**Keyboard navigation for swipe deck:**
- ArrowLeft: Pass
- ArrowRight: Like
- ArrowUp: Super Like
- Hook captures keydown events, calls onSwipe handler

**Screen reader announcements:**
- Create temporary div with role="status" and aria-live="polite"
- Set textContent to action message
- Remove after 1 second
- Use sr-only class for visual hiding

### Performance Optimizations

**Image preloading:**
- When deck loads, preload photos for next 3 profiles
- Create Image objects and set src
- Runs in useEffect when deckIndex changes

**Debounced location updates:**
- Use navigator.geolocation.watchPosition
- Debounce API calls to max once per 30 seconds
- High accuracy disabled, max age 60 seconds
- Clean up watch on unmount

**Render optimization:**
- Only render top 2 cards in deck
- Background card has reduced opacity and scale
- Match modal uses CSS animations (GPU-accelerated)
- Confetti uses canvas (off main thread)

---

## 9. Trade-offs Summary

| Decision | Chosen | Alternative | Reasoning |
|----------|--------|-------------|-----------|
| Gesture library | Native pointer events | React Spring/Gesture | Smaller bundle, full control |
| Match animation | CSS + Canvas confetti | Lottie animation | No additional dependency |
| Avatar fallback | Procedural SVG | Default placeholder | Unique, memorable, lightweight |
| Message state | Zustand Map | Normalized Redux | Simpler for conversation-based access |
| Typing indicator | WebSocket | Polling | Real-time, lower latency |
| Photo preload | 3 ahead | Lazy only | Balance memory vs smoothness |

---

## 10. Summary

This frontend architecture delivers Tinder's core experience:

1. **Swipe Interface**: Gesture-based cards with 60fps animations and visual feedback via pointer events and CSS transforms
2. **Match Celebration**: Multi-phase animated modal with gradient background and canvas confetti effects
3. **Real-time Chat**: WebSocket-powered messaging with typing indicators and debounced updates
4. **Procedural Avatars**: ReignsAvatar system for consistent, unique fallback avatars from user ID
5. **State Management**: Zustand stores with optimistic updates for instant feedback and offline queuing
6. **Accessibility**: Keyboard navigation for swipe actions and screen reader announcements
7. **Performance**: Image preloading for smooth transitions, debounced location updates, minimal re-renders

The mobile-first design prioritizes the core swiping experience while maintaining smooth performance across devices. The gamified interaction patterns (swipe physics, celebration animations, instant feedback) are optimized for engagement while keeping the bundle size manageable through native APIs over heavy dependencies.
