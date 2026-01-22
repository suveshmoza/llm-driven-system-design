# News Aggregator - Frontend System Design Interview Answer

*A 45-minute system design interview answer focused on UI components, state management, accessibility, and performance optimization.*

---

## Opening Statement

"Today I'll design the frontend for a news aggregator like Google News or Flipboard, focusing on the user interface and experience. The core frontend challenges are: building a responsive feed with virtualized scrolling for thousands of articles, designing intuitive story clustering UI, implementing real-time breaking news alerts, managing complex state across personalization preferences, and optimizing for performance with image lazy loading and skeleton states. I'll walk through the component architecture, state management patterns, and accessibility considerations."

---

## Step 1: Requirements Clarification (3-5 minutes)

### User Personas and Use Cases

**News Reader (Primary User)**
- Browse personalized feed of news stories
- Read articles from multiple sources on same story
- Search for specific topics or keywords
- Customize topic preferences
- Receive breaking news notifications

**Admin User**
- Manage news sources
- Monitor crawl status and errors
- View system statistics
- Moderate content

### Core UI Requirements

1. **Personalized Feed** - Infinite scroll with story cards
2. **Story Detail View** - Multiple sources for same story
3. **Topic Navigation** - Browse by category
4. **Search Interface** - Full-text with filters
5. **Breaking News Banner** - Real-time alerts
6. **Preferences Panel** - Topic and source selection
7. **Reading Progress** - Track what user has read

### Non-Functional Requirements

| Requirement | Target | Frontend Implication |
|-------------|--------|---------------------|
| Initial Load | < 2s | Code splitting, critical CSS |
| Feed Scroll | 60 fps | Virtualized list rendering |
| Image Load | Progressive | Lazy loading, blur-up placeholders |
| Offline | Basic support | Service worker, cached articles |
| Accessibility | WCAG 2.1 AA | Screen reader, keyboard navigation |

---

## Step 2: Component Architecture (10 minutes)

### High-Level Component Tree

```
┌─────────────────────────────────────────────────────────────────┐
│                              App                                 │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                       AppHeader                           │   │
│  │  ┌────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────┐  │   │
│  │  │  Logo  │ │ SearchBar │ │ TopicNav │ │   UserMenu   │  │   │
│  │  └────────┘ └───────────┘ └──────────┘ │ ┌──────────┐ │  │   │
│  │                                         │ │Notif Bell│ │  │   │
│  │                                         │ ├──────────┤ │  │   │
│  │                                         │ │ Profile  │ │  │   │
│  │                                         │ └──────────┘ │  │   │
│  │                                         └──────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  BreakingNewsBanner                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                     MainContent                           │   │
│  │  ┌────────────────┐ ┌────────────────┐ ┌──────────────┐  │   │
│  │  │   FeedView /   │ │StoryDetailView │ │  TopicView   │  │   │
│  │  │ ┌────────────┐ │ │  /story/:id    │ │ /topic/:topic│  │   │
│  │  │ │ FeedHeader │ │ │ ┌────────────┐ │ │              │  │   │
│  │  │ │ ┌────────┐ │ │ │ │StoryHeader │ │ │  StoryList   │  │   │
│  │  │ │ │Filters │ │ │ │ ├────────────┤ │ │              │  │   │
│  │  │ │ └────────┘ │ │ │ │ SourceList │ │ └──────────────┘  │   │
│  │  │ ├────────────┤ │ │ │ ┌────────┐ │ │                   │   │
│  │  │ │ StoryList  │ │ │ │ │SrcCard │ │ │ ┌──────────────┐  │   │
│  │  │ │ (virtual)  │ │ │ │ └────────┘ │ │ │  SearchView  │  │   │
│  │  │ │ ┌────────┐ │ │ │ ├────────────┤ │ │   /search    │  │   │
│  │  │ │ │StyCard │ │ │ │ │  Related   │ │ │ ┌──────────┐ │  │   │
│  │  │ │ └────────┘ │ │ │ │  Stories   │ │ │ │ Filters  │ │  │   │
│  │  │ ├────────────┤ │ │ └────────────┘ │ │ ├──────────┤ │  │   │
│  │  │ │ LoadSpinner│ │ └────────────────┘ │ │ Results  │ │  │   │
│  │  │ └────────────┘ │                    │ └──────────┘ │  │   │
│  │  └────────────────┘                    └──────────────┘  │   │
│  │  ┌────────────────┐  ┌─────────────────────────────────┐ │   │
│  │  │PreferencesView │  │         AdminPanel /admin        │ │   │
│  │  │  /preferences  │  │ ┌───────────┬───────────┬─────┐ │ │   │
│  │  │ ┌────────────┐ │  │ │SourceMgr │CrawlStatus│Stats│ │ │   │
│  │  │ │TopicSelect │ │  │ └───────────┴───────────┴─────┘ │ │   │
│  │  │ ├────────────┤ │  └─────────────────────────────────┘ │   │
│  │  │ │SourceSelect│ │                                      │   │
│  │  │ └────────────┘ │                                      │   │
│  │  └────────────────┘                                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    ToastContainer                         │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Core Component Interfaces

**StoryCard** - Displays story with image, title, summary, sources, and read status. Uses lazy loading for images, priority loading for first 3 items, and BREAKING badge for urgent news.

**SourceIndicator** - Shows stacked source favicons with count. Displays "N sources" text with "+X more" for overflow.

**VirtualizedStoryList** - Uses @tanstack/react-virtual for efficient scrolling. Implements infinite scroll trigger at 5 items from bottom. Includes role="feed" and aria-busy for accessibility.

---

## Step 3: Deep Dive - Breaking News Banner (8 minutes)

### Breaking News Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    BreakingNewsBanner                           │
│  role="alert" aria-live="assertive"                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ┌─────────┐  ┌──────────────────────┐  ┌────┐ ┌────┐  │    │
│  │  │ PULSING │  │    Story Title       │  │ v  │ │ X  │  │    │
│  │  │   DOT   │  │   (clickable)        │  │exp │ │cls │  │    │
│  │  └─────────┘  └──────────────────────┘  └────┘ └────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Expanded Content (animated)                 │    │
│  │  ┌──────────────────────────────────────────────────┐   │    │
│  │  │  Story Summary                                    │   │    │
│  │  ├──────────────────────────────────────────────────┤   │    │
│  │  │  SourceIndicator  │  TimeAgo                     │   │    │
│  │  └──────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Breaking News Hook Behavior

- Polls `/api/v1/breaking` every 30 seconds
- Tracks dismissed story IDs to avoid re-showing
- Triggers browser Notification API if permission granted
- Returns `{ breakingStory, dismiss }` for component use

---

## Step 4: Deep Dive - Search Interface (8 minutes)

### SearchBar Component Features

```
┌─────────────────────────────────────────────────────────────────┐
│                        SearchBar                                 │
│  role="combobox" aria-expanded aria-autocomplete="list"         │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  [ICON]  Search news...                            [X]  │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Suggestions Dropdown (role="listbox")                   │    │
│  │  ┌─────────────────────────────────────────────────┐    │    │
│  │  │  suggestion 1 (highlighted match)               │    │    │
│  │  ├─────────────────────────────────────────────────┤    │    │
│  │  │  suggestion 2 (highlighted match)               │    │    │
│  │  └─────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

**Key behaviors:**
- 300ms debounced suggestions fetch
- Minimum 2 characters to trigger
- Escape key closes dropdown and blurs input
- HighlightedText component marks matching portions

### SearchFilters Panel

```
┌─────────────────────────────────────────────────────────────────┐
│                    SearchFiltersPanel                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  [FILTER ICON] Filters                         (2) [v]  │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Expanded Filters (AnimatePresence)                      │    │
│  │  ┌────────────────┐  ┌────────────────┐                 │    │
│  │  │ Topic [select] │  │ Source [select]│                 │    │
│  │  └────────────────┘  └────────────────┘                 │    │
│  │  ┌────────────────┐  ┌────────────────┐                 │    │
│  │  │ From [date]    │  │ To [date]      │                 │    │
│  │  └────────────────┘  └────────────────┘                 │    │
│  │  [Clear all filters]                                     │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 5: State Management (8 minutes)

### Zustand Store Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      State Management                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   feedStore     │  │preferencesStore │  │readingProgress  │  │
│  ├─────────────────┤  ├─────────────────┤  │     Store       │  │
│  │ - stories[]     │  │ - topics[]      │  ├─────────────────┤  │
│  │ - cursor        │  │ - prefSources[] │  │ - readStories   │  │
│  │ - hasMore       │  │ - exclSources[] │  │   Set<string>   │  │
│  │ - isLoading     │  │ - isLoading     │  │ - readingTime   │  │
│  │ - error         │  │                 │  │   Map<id,secs>  │  │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤  │
│  │ fetchFeed()     │  │ fetchPrefs()    │  │ markAsRead()    │  │
│  │ loadMore()      │  │ updateTopics()  │  │ trackDwell()    │  │
│  │ refreshFeed()   │  │ toggleSource()  │  │ syncToServer()  │  │
│  │                 │  │ excludeSource() │  │                 │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │            │
│           │    Cross-store communication            │            │
│           │    ◄───────────────┼───────────────────►│            │
│           │                    │                    │            │
│           │  updateTopics() triggers refreshFeed()  │            │
│           │                                         │            │
└───────────┼─────────────────────────────────────────┼────────────┘
            │                                         │
            ▼                                         ▼
┌───────────────────────┐               ┌───────────────────────┐
│     API Server        │               │    LocalStorage       │
│   /api/v1/feed        │               │  (persist middleware) │
│   /api/v1/preferences │               │  - readStories        │
│   /api/v1/reading-    │               │  - readingTime        │
│     history           │               │                       │
└───────────────────────┘               └───────────────────────┘
```

### Custom Hooks

**useReadingProgress** - Returns `{ readStories, markAsRead, isRead }` from store.

**useDwellTimeTracker** - Tracks time spent on story detail page. Sends updates every 10 seconds. Tracks remaining time on unmount.

---

## Step 6: Topic Navigation (5 minutes)

### TopicNav Component

```
┌─────────────────────────────────────────────────────────────────┐
│                         TopicNav                                 │
│  nav aria-label="Topic navigation"                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌──┐ ┌──────────────────────────────────────────────────┐ ┌──┐ │
│  │ < │ │ [For You] [Tech] [Sports] [Business] [Health]  │ │ > │ │
│  │   │ │   active   pill   pill      pill       pill    │ │   │ │
│  └──┘ └──────────────────────────────────────────────────┘ └──┘ │
│   ^     role="tablist" with horizontal scroll                ^   │
│   │                                                          │   │
│   └── gradient fade ──────────────────────── gradient fade ──┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Key behaviors:**
- Horizontal scroll with arrow buttons
- Arrow visibility based on scroll position
- role="tab" with aria-selected for each pill
- Article counts shown in parentheses

### TopicSelector for Preferences

```
┌─────────────────────────────────────────────────────────────────┐
│                      TopicSelector                               │
│  role="group" aria-label="Topic selection"                      │
├─────────────────────────────────────────────────────────────────┤
│  Select topics you're interested in...                          │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐    │
│  │ [ICON] Tech     │ │ [ICON] Sports   │ │ [ICON] Business │    │
│  │   Latest news   │ │   Game updates  │ │   Market news   │    │
│  │           [x]   │ │                 │ │           [x]   │    │
│  │   SELECTED      │ │                 │ │   SELECTED      │    │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘    │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐    │
│  │ [ICON] Health   │ │ [ICON] Science  │ │ [ICON] Politics │    │
│  │   Wellness tips │ │   Discoveries   │ │   Policy updates│    │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘    │
│                                                                  │
│  2 topics selected                                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 7: Accessibility (4 minutes)

### Keyboard Navigation Hook

**Supported keys:**
- `j` / `ArrowDown` - Move focus to next story
- `k` / `ArrowUp` - Move focus to previous story
- `Enter` / `o` - Open focused story
- `?` - Show keyboard shortcuts help

**Behavior:** Skips when focus is in input/textarea elements.

### Screen Reader Support

```
┌─────────────────────────────────────────────────────────────────┐
│                      LiveRegion                                  │
│  role="status" aria-live="polite" aria-atomic="true"            │
│  class="sr-only"                                                │
├─────────────────────────────────────────────────────────────────┤
│  Announces dynamic changes:                                      │
│  - "Loaded 20 new stories"                                       │
│  - "Breaking news: [headline]"                                   │
│  - "Search results: 15 stories found"                           │
│                                                                  │
│  Uses CustomEvent 'announce' for global announcements           │
│  Clears after 1000ms to allow repeated announcements            │
└─────────────────────────────────────────────────────────────────┘
```

### Skip Links

```
┌─────────────────────────────────────────────────────────────────┐
│  SkipLinks (sr-only, visible on focus)                          │
├─────────────────────────────────────────────────────────────────┤
│  [Skip to main content]     → #main-content                     │
│  [Skip to topic navigation] → #topic-nav                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 8: Performance Optimizations (3 minutes)

### Image Loading Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                   ProgressiveImage                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Initial State         Loading              Loaded               │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐    │
│  │               │    │   BLURRED     │    │               │    │
│  │  THUMBNAIL    │ ─► │   THUMBNAIL   │ ─► │  FULL IMAGE   │    │
│  │  (blur-sm)    │    │   (loading)   │    │  (sharp)      │    │
│  │               │    │               │    │               │    │
│  └───────────────┘    └───────────────┘    └───────────────┘    │
│                                                                  │
│  - Priority items load eagerly                                   │
│  - Non-priority use loading="lazy"                               │
│  - Preloads full image in background                             │
│  - 300ms opacity transition on swap                              │
└─────────────────────────────────────────────────────────────────┘
```

### Skeleton Loading

```
┌─────────────────────────────────────────────────────────────────┐
│                    StoryCardSkeleton                             │
│  animate-pulse                                                   │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────────────────────────────────┐ │
│  │              │  │ ████████  ██████   (topic badges)        │ │
│  │    IMAGE     │  │                                          │ │
│  │  PLACEHOLDER │  │ █████████████████████████████ (title)    │ │
│  │              │  │ ██████████████████████                   │ │
│  │              │  │                                          │ │
│  └──────────────┘  │ ███████████████████████████ (summary)    │ │
│                    │                                          │ │
│                    │ ████████  ██████ (meta)                  │ │
│                    └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Trade-offs Summary

| Decision | Chosen Approach | Alternative | Trade-off |
|----------|-----------------|-------------|-----------|
| List rendering | Virtualized scroll | Pagination | Infinite scroll UX vs higher memory for page buttons |
| State management | Zustand stores | React Query | Simpler mental model vs built-in caching |
| Breaking news | Polling (30s) | WebSocket | Lower complexity vs real-time delivery |
| Image loading | Progressive blur-up | Lazy only | Better perceived performance vs more network requests |
| Keyboard nav | Custom hook | Focus trap library | Full control vs battle-tested accessibility |
| Reading progress | LocalStorage + sync | Server only | Offline support vs data consistency |

---

## Future Enhancements

1. **PWA with Offline Mode** - Service worker for cached articles
2. **WebSocket for Real-time** - Instant breaking news without polling
3. **Dark Mode** - System preference detection and manual toggle
4. **Text-to-Speech** - Accessibility feature for article reading
5. **Swipe Gestures** - Mobile-optimized story navigation
6. **Customizable Layout** - Grid vs list view, card density options

---

## Closing Summary

"I've designed a frontend architecture for a news aggregator with:

1. **Virtualized Story Feed** - Smooth scrolling through thousands of stories using @tanstack/react-virtual
2. **Breaking News System** - Real-time banner with dismiss functionality and notifications
3. **Search with Filters** - Autocomplete suggestions, topic/source/date filtering
4. **Zustand State Management** - Separate stores for feed, preferences, and reading progress
5. **Full Accessibility** - Keyboard navigation, screen reader support, skip links

The component architecture separates concerns clearly, with StoryCard handling display, StoryList managing virtualization, and dedicated hooks for reading progress and dwell time tracking. Performance is optimized through lazy loading, progressive images, and skeleton states. Happy to dive deeper into any component."
