# Kindle Community Highlights - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Opening Statement (1 minute)

"I'll design a Kindle Community Highlights system - a social reading platform that enables users to highlight passages in books, sync highlights across devices in real-time, and discover popular highlights from the community.

From a frontend perspective, the key challenges are: building an offline-first experience with local storage and sync queue, creating intuitive highlight interactions in a reading interface, and displaying community data with privacy controls while maintaining a responsive UI across devices."

## Requirements Clarification (3 minutes)

### Functional Requirements
- **Highlight Management** - Create, edit, delete highlights with notes and colors
- **Cross-device Sync** - Real-time synchronization across Kindle, iOS, Android, Web
- **Community Discovery** - View popular/trending highlights in any book
- **Social Features** - Follow readers, share highlights, friends-only sharing
- **Export** - Export personal highlights to Markdown, CSV, or PDF

### User Experience Requirements
- **Offline Support** - Full functionality without network connection
- **Instant Feedback** - Optimistic updates for highlight actions
- **Reading Flow** - Non-intrusive highlight creation during reading
- **Discovery** - Easy navigation between personal and community highlights

## High-Level Frontend Architecture (4 minutes)

```
┌─────────────────────────────────────────────────────────────────┐
│                     Web Application                              │
├─────────────────────────────────────────────────────────────────┤
│  Routes                                                          │
│  ┌───────────┬───────────┬───────────┬───────────┬───────────┐ │
│  │  Home     │  Library  │  Book     │  Trending │  Export   │ │
│  │  Page     │  Page     │  Detail   │  Page     │  Page     │ │
│  └───────────┴───────────┴───────────┴───────────┴───────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  Components                                                      │
│  ┌───────────┬───────────┬───────────┬───────────┬───────────┐ │
│  │  Book     │  Highlight│  Popular  │  Color    │  Export   │ │
│  │  Grid     │  Card     │  Passage  │  Picker   │  Preview  │ │
│  └───────────┴───────────┴───────────┴───────────┴───────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  State Management (Zustand)                                      │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  Auth │ Library │ Highlights │ Sync Queue │ UI State     │ │
│  └───────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  Services                                                        │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  API Client │ WebSocket Manager │ LocalStorage │ Exporter │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Technology | Purpose |
|------------|---------|
| **React 19** | UI framework with concurrent features |
| **TypeScript** | Type safety and developer experience |
| **Vite** | Fast development server and build tool |
| **TanStack Router** | Type-safe file-based routing |
| **Zustand** | Lightweight state management |
| **Tailwind CSS** | Utility-first styling |

## Deep Dive: Component Architecture (10 minutes)

### Route Structure

Routes follow TanStack Router file-based convention with pages for landing, authentication, library, book details (with dynamic bookId param), trending, and export functionality.

### RootLayout Component

The root layout provides consistent navigation across all pages. It includes:
- Header with app logo linking to home
- Navigation links for Library, Trending, and Export (authenticated users)
- User email display and logout button
- Login/Register links for unauthenticated users
- Main content outlet for child routes

The layout uses Kindle-inspired cream background and sepia accents for a reading-focused aesthetic.

### Library Page with Book Grid

The library page displays user's books and highlights with:
- Toggle between Books view (grid) and Highlights view (list)
- Search functionality filtering by title, author, or highlight text
- Parallel data loading for books and highlights on mount
- Loading skeleton while data fetches
- Responsive grid layout (2-4 columns based on viewport)

### BookCard Component

Each book card displays:
- Cover image with sepia fallback gradient
- Highlight count badge (amber background)
- Book title and author with truncation
- Hover effects with shadow and color transitions
- Links to book detail page with bookId param

### HighlightCard Component

Highlight cards feature:
- Color-coded left border based on highlight color (yellow, orange, blue, green, pink)
- Book info link when showBookInfo is true
- Quoted highlight text in serif italic
- Editable note with inline editing (textarea, save/cancel buttons)
- Color picker and visibility selector
- Edit note and delete actions
- Timestamp display

**Optimistic Updates Pattern:**
1. Update local store immediately
2. Send API request
3. Revert store on failure

### ColorPicker Component

A row of 5 circular color buttons (yellow, orange, blue, green, pink) with:
- Selected state showing darker border and scale-up
- Hover scale effect
- Aria labels for accessibility

## Deep Dive: Book Detail Page (8 minutes)

### Multi-Tab Layout

The book detail page uses a three-tab navigation pattern:

```
┌─────────────────────────────────────────────────────────────────┐
│  Book Header                                                     │
│  ┌──────────┐                                                   │
│  │  Cover   │  Title                                            │
│  │  Image   │  by Author                                        │
│  │  (32px)  │  X highlights | Y locations                       │
│  └──────────┘                                                   │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────┬─────────────────┬──────────────────┐        │
│  │ My Highlights │ Popular Highl.  │ Friends' Highl.  │        │
│  └───────────────┴─────────────────┴──────────────────┘        │
├─────────────────────────────────────────────────────────────────┤
│  Tab Content (min-height 400px)                                  │
│  - My: Personal highlights with HighlightCard                   │
│  - Popular: Ranked PopularPassage components                    │
│  - Friends: FriendHighlightCard or empty state                  │
└─────────────────────────────────────────────────────────────────┘
```

**Data Loading Strategy:**
- Load book details and user's highlights in parallel on mount
- Load popular/friends highlights lazily when tab is selected

### PopularPassage Component

Displays community-highlighted passages with:
- Rank badge (amber background with #1, #2, etc.)
- Passage text in large serif italic
- Reader count with users icon ("X readers highlighted this")
- Location range display

## Deep Dive: State Management (6 minutes)

### Zustand Store Structure

The store uses Zustand with persist and immer middleware:

```
┌─────────────────────────────────────────────────────────────────┐
│  AppState                                                        │
├────────────────┬────────────────────────────────────────────────┤
│  Authentication│  user, sessionId, isAuthenticated              │
│                │  setUser, setSession, logout                   │
├────────────────┼────────────────────────────────────────────────┤
│  Library       │  books array, setLibrary                       │
├────────────────┼────────────────────────────────────────────────┤
│  Highlights    │  highlights array                              │
│                │  setHighlights, addHighlight, removeHighlight  │
│                │  updateHighlightInStore                        │
├────────────────┼────────────────────────────────────────────────┤
│  Sync Queue    │  syncQueue array (for offline support)         │
│                │  addToSyncQueue, removeFromSyncQueue           │
│                │  clearSyncQueue                                │
├────────────────┼────────────────────────────────────────────────┤
│  UI State      │  searchQuery, selectedBookId                   │
│                │  setSearchQuery, setSelectedBookId             │
└────────────────┴────────────────────────────────────────────────┘
```

**Persistence Configuration:**
- Storage name: 'kindle-highlights-storage'
- Partialize: Only persist user, sessionId, isAuthenticated, and syncQueue
- Library and highlights reload from server on app start

**Immer Integration:**
- Enables direct state mutation syntax
- Simplifies complex update operations (e.g., finding and updating a highlight by ID)

## Deep Dive: WebSocket Sync (5 minutes)

### useWebSocket Hook

Manages real-time synchronization across devices:

```
┌─────────────────────────────────────────────────────────────────┐
│  WebSocket Connection Flow                                       │
├─────────────────────────────────────────────────────────────────┤
│  1. Connect with session ID in query string                     │
│  2. On open: Request sync from lastSyncTimestamp                │
│  3. Process offline queue                                       │
│  4. Handle incoming sync events                                 │
│  5. Auto-reconnect on close (3 second delay)                    │
└─────────────────────────────────────────────────────────────────┘
```

**Sync Event Types:**
- `highlight_sync` - Single highlight create/update/delete
- `sync_response` - Batch merge from server (highlights array + deleted IDs)

**Offline Queue Processing:**
- Iterates through syncQueue items
- Sends each pending action via WebSocket
- Removes from queue on success
- Stops processing on error (preserves order)

**Last Sync Tracking:**
- Stores timestamp in localStorage
- Requests delta updates on reconnection
- Updates after successful sync_response

## Deep Dive: Export Page (4 minutes)

### Export Functionality

The export page provides three output formats:

```
┌─────────────────────────────────────────────────────────────────┐
│  Export Highlights                                               │
├─────────────────────────────────────────────────────────────────┤
│  Choose Format                                                   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │  Markdown   │ │    CSV      │ │    JSON     │               │
│  │  Note apps  │ │ Spreadsheet │ │ Developers  │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
├─────────────────────────────────────────────────────────────────┤
│  Options                                                         │
│  [x] Include notes                                              │
│  [ ] Include dates                                              │
├─────────────────────────────────────────────────────────────────┤
│  [ Preview ]  [ Download ]                                      │
├─────────────────────────────────────────────────────────────────┤
│  Preview (if generated)                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  <pre> formatted output </pre>                          │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Download Flow:**
1. Call exportHighlights API with format and options
2. Create Blob with appropriate MIME type
3. Generate object URL and trigger download via anchor click
4. Revoke URL after download

**Format Options:**
- FormatOption component shows icon, label, description
- Selected state with visual highlighting

## Tailwind Configuration (2 minutes)

Custom theme extends default Tailwind with:

| Token | Value | Purpose |
|-------|-------|---------|
| kindle.cream | #faf8f5 | Background |
| kindle.sepia | #f4ecd8 | Accents, fallbacks |
| kindle.yellow | #fff59d | Highlight color |
| kindle.orange | #ffab91 | Highlight color |
| kindle.blue | #90caf9 | Highlight color |
| kindle.green | #a5d6a7 | Highlight color |
| kindle.pink | #f48fb1 | Highlight color |
| fontFamily.serif | Georgia, Cambria | Reading typography |

## Trade-offs and Alternatives (2 minutes)

| Decision | Chosen | Alternative | Reason |
|----------|--------|-------------|--------|
| State Management | Zustand | Redux Toolkit | Simpler API, less boilerplate |
| Routing | TanStack Router | React Router | Type-safe params and search |
| Offline Storage | localStorage + Zustand persist | IndexedDB | Simpler for highlight data |
| Styling | Tailwind CSS | CSS Modules | Faster iteration, consistent design |
| Sync | WebSocket | Polling | Real-time updates, lower latency |

## Closing Summary (1 minute)

"The Kindle Community Highlights frontend is built around three pillars:

1. **Offline-first design** using Zustand with persistence and a sync queue for operations made without connectivity
2. **Component composition** with reusable HighlightCard, ColorPicker, and TabButton components that maintain consistent UX
3. **Real-time sync** via WebSocket with automatic reconnection and conflict merging

Key patterns include optimistic updates for instant feedback, multi-tab navigation for switching between personal/popular/friends highlights, and a clean export flow with format preview. The Kindle-inspired color palette and serif typography create a reading-focused aesthetic."
