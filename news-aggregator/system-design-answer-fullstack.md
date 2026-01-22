# News Aggregator - Full-Stack System Design Interview Answer

*A 45-minute system design interview answer with balanced coverage of frontend, backend, and their integration points.*

---

## Opening Statement

"Today I'll design a news aggregator like Google News or Flipboard, covering both the backend content pipeline and frontend user experience. The core challenges span both layers: on the backend, crawling RSS feeds with rate limiting, deduplicating articles using SimHash, and ranking content with multiple signals; on the frontend, displaying clustered stories with source diversity indicators, implementing breaking news alerts, and tracking reading progress for personalization. I'll focus on how these systems integrate through shared types, real-time updates, and optimistic UI patterns."

---

## Step 1: Requirements Clarification (3-5 minutes)

### Functional Requirements

| Feature | Backend Responsibility | Frontend Responsibility |
|---------|------------------------|------------------------|
| Content Crawling | Fetch RSS feeds, parse articles | Display crawl status in admin |
| Deduplication | SimHash fingerprinting, clustering | Show "X sources" indicator |
| Personalization | Ranking algorithm, user preferences | Topic selector, preference UI |
| Feed Display | API with pagination, caching | Virtualized infinite scroll |
| Search | Elasticsearch query, filtering | Search bar, filters, results |
| Breaking News | Velocity detection, notifications | Alert banner, real-time updates |
| Reading Progress | Store dwell time, history | Track reads, sync periodically |

### Non-Functional Requirements

| Requirement | Target | Implementation |
|-------------|--------|----------------|
| Freshness | Breaking news < 5 min | Priority crawling + push updates |
| Feed Latency | p95 < 200ms | Redis cache + optimistic UI |
| Initial Load | < 2s | Code splitting, skeleton states |
| Offline Support | Read cached articles | Service worker, IndexedDB |

---

## Step 2: High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                        │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐ │
│  │ Feed View │  │ Story     │  │ Search    │  │ Prefs     │  │ Admin     │ │
│  │           │  │ Detail    │  │ View      │  │ Panel     │  │ Dashboard │ │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘ │
│        │              │              │              │              │        │
│  ┌─────▼──────────────▼──────────────▼──────────────▼──────────────▼─────┐  │
│  │                        Zustand Stores                                  │  │
│  │   feedStore  │  preferencesStore  │  readingProgressStore  │  authStore│  │
│  └─────────────────────────────────────┬─────────────────────────────────┘  │
│                                        │                                     │
│  ┌─────────────────────────────────────▼─────────────────────────────────┐  │
│  │                         API Client Layer                               │  │
│  │   Axios instance │ Request interceptors │ Response transformers        │  │
│  └─────────────────────────────────────┬─────────────────────────────────┘  │
└────────────────────────────────────────┼─────────────────────────────────────┘
                                         │ HTTP/WebSocket
                                         │
┌────────────────────────────────────────┼─────────────────────────────────────┐
│                              BACKEND   │                                      │
│  ┌─────────────────────────────────────▼─────────────────────────────────┐  │
│  │                           API Gateway                                  │  │
│  │     Rate Limiting │ Authentication │ Request Validation                │  │
│  └───────────┬───────────────┬───────────────┬───────────────┬───────────┘  │
│              │               │               │               │               │
│  ┌───────────▼───┐  ┌───────▼───────┐  ┌───▼───────────┐  ┌▼───────────┐   │
│  │ Feed Service  │  │ Search Service│  │ User Service  │  │ Admin API  │   │
│  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘  └──────┬─────┘   │
│          │                  │                  │                 │          │
│  ┌───────▼──────────────────▼──────────────────▼─────────────────▼───────┐  │
│  │                         Data Layer                                     │  │
│  │   PostgreSQL │ Redis │ Elasticsearch                                   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Background Services                               │    │
│  │   Crawler │ Deduplicator │ Indexer │ Breaking News Detector         │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 3: Shared Type Definitions (5 minutes)

Shared types ensure frontend and backend stay in sync:

**Core Domain Types:**
- `Source`: id, name, homepage, favicon, category (mainstream/tech/local/opinion), credibilityScore (0.0-1.0)
- `Article`: id, sourceId, storyClusterId, url, title, summary, author, imageUrl, publishedAt, topics[]
- `StoryCluster`: id, title, summary, primaryImageUrl, primaryTopic, topics[], articleCount, sourceCount, sources[], velocity, isBreaking, firstSeenAt, lastUpdatedAt
- `Topic`: id, displayName, keywords[], articleCount

**User Types:**
- `User`: id, email, displayName, role (user/admin), createdAt
- `UserPreferences`: topics[], preferredSources[], excludedSources[]
- `ReadingHistoryEntry`: storyClusterId, readAt, dwellTimeSeconds

**API Request/Response Types:**
- `FeedRequest`: cursor?, limit?, topic?
- `FeedResponse`: stories[], nextCursor, hasMore
- `SearchRequest`: query, topic?, source?, dateFrom?, dateTo?, limit?
- `SearchResponse`: hits[], total (with article, highlights, score)

**WebSocket Event Types:**
- `WSBreakingNewsEvent`: type='breaking_news', story
- `WSFeedUpdateEvent`: type='feed_update', newStories count

---

## Step 4: Deep Dive - Content Pipeline (8 minutes)

### Backend: Crawl and Deduplication Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CRAWL PIPELINE                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │ Rate Limiter │───►│ RSS Fetcher  │───►│ XML Parser   │                   │
│  │ (per domain) │    │              │    │              │                   │
│  └──────────────┘    └──────────────┘    └──────┬───────┘                   │
│                                                  │                           │
│                                                  ▼                           │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     FOR EACH ARTICLE                                  │   │
│  │  ┌────────────────┐                                                   │   │
│  │  │ Check Exists   │──► If exists by source_id + external_id: SKIP    │   │
│  │  └───────┬────────┘                                                   │   │
│  │          │ New article                                                │   │
│  │          ▼                                                            │   │
│  │  ┌────────────────┐                                                   │   │
│  │  │ SimHash        │──► Compute 64-bit fingerprint from title+summary │   │
│  │  │ Fingerprint    │                                                   │   │
│  │  └───────┬────────┘                                                   │   │
│  │          │                                                            │   │
│  │          ▼                                                            │   │
│  │  ┌────────────────┐    ┌─────────────────────────────────────────┐   │   │
│  │  │ Find Cluster   │───►│ Query: Hamming distance <= 3            │   │   │
│  │  │                │    │ Within 48 hours, ORDER BY last_updated  │   │   │
│  │  └───────┬────────┘    └─────────────────────────────────────────┘   │   │
│  │          │                                                            │   │
│  │          ├──► Match found: UPDATE cluster stats (article_count++)    │   │
│  │          │                                                            │   │
│  │          └──► No match: CREATE new story_cluster                     │   │
│  │                                                                       │   │
│  │  ┌────────────────┐                                                   │   │
│  │  │ Insert Article │──► Store with fingerprint, topics, cluster_id    │   │
│  │  └───────┬────────┘                                                   │   │
│  │          │                                                            │   │
│  │          ▼                                                            │   │
│  │  ┌────────────────┐                                                   │   │
│  │  │ Queue Indexing │──► Redis RPUSH to index:queue for Elasticsearch  │   │
│  │  └────────────────┘                                                   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌────────────────┐                                                         │
│  │ Check Breaking │──► Evaluate velocity for affected clusters              │
│  └────────────────┘                                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Frontend: Displaying Source Diversity

**StoryCard Component Structure:**

```
┌─────────────────────────────────────────────────────────────┐
│ [Breaking Badge - if story.isBreaking]                       │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌────────────────────────────────────────┐   │
│  │          │  │ [TopicBadges - first 2 topics]          │   │
│  │  Image   │  │ Story Title (linked to /story/:id)      │   │
│  │  (lazy)  │  │ Summary (line-clamp-2)                  │   │
│  └──────────┘  └────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│ Source Diversity Section (expandable)                        │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ [SourceStack: favicon icons -space-x-1]  X sources ▼   │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  [Expanded: AnimatePresence]                                │
│  ├─ Source 1: [favicon] Name [CredibilityBadge]             │
│  ├─ Source 2: [favicon] Name [CredibilityBadge]             │
│  └─ Source N: [favicon] Name [CredibilityBadge]             │
└─────────────────────────────────────────────────────────────┘
```

**SourceStack Visual:** Overlapping favicon circles with +N remaining indicator

---

## Step 5: Deep Dive - Feed Ranking and Display (8 minutes)

### Backend: Multi-Signal Ranking

**Ranking Weights:**
| Signal | Weight | Description |
|--------|--------|-------------|
| Relevance | 35% | Topic match with user interests |
| Freshness | 25% | Exponential decay, 6-hour half-life |
| Quality | 20% | Source diversity + avg credibility |
| Diversity | 10% | Penalize repeated topics in feed |
| Trending | 10% | Story velocity (capped at 1.0) |

**Additional Modifiers:**
- Breaking news: +30% boost
- Already read: 90% penalty

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FEED GENERATION FLOW                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. CHECK CACHE                                                              │
│     └─► Key: feed:user:{userId}:{cursor}:{limit}                            │
│     └─► If hit: return cached response                                       │
│                                                                              │
│  2. LOAD USER CONTEXT (parallel)                                             │
│     ├─► UserPreferences: topics[], preferredSources[], excludedSources[]    │
│     └─► ReadHistory: Set<storyClusterId> (last 100)                         │
│                                                                              │
│  3. GET CANDIDATES                                                           │
│     └─► Query story_clusters WHERE last_updated_at > NOW() - 48h            │
│     └─► LIMIT 500, ORDER BY last_updated_at DESC                            │
│                                                                              │
│  4. SCORE EACH STORY                                                         │
│     ┌──────────────────────────────────────────────────────────────────┐    │
│     │ score = relevance * 0.35 + freshness * 0.25 + quality * 0.20     │    │
│     │       + diversity * 0.10 + trending * 0.10                        │    │
│     │ if (isBreaking) score *= 1.3                                      │    │
│     │ Update context.topicsInFeed for diversity tracking                │    │
│     └──────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  5. SORT BY SCORE, PAGINATE                                                  │
│     └─► Slice [cursor, cursor+limit]                                        │
│                                                                              │
│  6. CACHE RESULT                                                             │
│     └─► Redis SETEX with 60s TTL                                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Signal Computation Details:**
- `relevance`: +0.3 per matching topic, +0.2 for preferred source, *0.1 if already read
- `freshness`: exp(-ageHours * ln(2) / 6) - exponential decay
- `quality`: 0.6 * min(sourceCount/5, 1) + 0.4 * avgCredibility
- `diversity`: max(0, 1 - topicCountInFeed * 0.2)

### Frontend: Virtualized Feed with Skeleton States

**FeedPage Structure:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FEED PAGE                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ BreakingNewsBanner (if breakingStory && !dismissed)                   │  │
│  │   [Pulsing dot] BREAKING: {title}  [SourceStack] [X dismiss]          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ TopicNav - horizontal scroll topic filters                            │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ PullToRefresh (mobile)                                                │  │
│  │   ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │   │ VirtualizedStoryList                                            │ │  │
│  │   │   ├─ StoryCard (visible)                                        │ │  │
│  │   │   ├─ StoryCard (visible)                                        │ │  │
│  │   │   ├─ StoryCard (visible)                                        │ │  │
│  │   │   └─ [Load more trigger - onLoadMore when in view]              │ │  │
│  │   └─────────────────────────────────────────────────────────────────┘ │  │
│  │                                                                       │  │
│  │   OR if loading && empty:                                             │  │
│  │   ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │   │ FeedSkeleton (count=5) - animated placeholders                  │ │  │
│  │   └─────────────────────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Zustand Feed Store State:**
- `stories[]`, `cursor`, `hasMore`, `isLoading`
- `loadFeed(reset?)`: Fetches from API, appends or replaces
- `loadMore()`: Calls loadFeed(false)
- `refresh()`: Calls loadFeed(true)

---

## Step 6: Deep Dive - Breaking News System (8 minutes)

### Backend: Velocity Detection and Notifications

**Detection Thresholds:**
| Metric | Threshold | Window |
|--------|-----------|--------|
| Velocity | > 2 articles/minute | 30 minutes |
| Sources | >= 5 unique sources | 30 minutes |

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     BREAKING NEWS DETECTION FLOW                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────┐                                                      │
│  │ checkCluster(id)   │ ◄── Called after new article added to cluster       │
│  └─────────┬──────────┘                                                      │
│            │                                                                 │
│            ▼                                                                 │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ Query: COUNT articles, COUNT DISTINCT sources WHERE cluster_id = ?     │ │
│  │        AND created_at > NOW() - 30 minutes                             │ │
│  └─────────┬──────────────────────────────────────────────────────────────┘ │
│            │                                                                 │
│            ▼                                                                 │
│  ┌────────────────────┐                                                      │
│  │ velocity = count/30│                                                      │
│  │ UPDATE velocity    │                                                      │
│  └─────────┬──────────┘                                                      │
│            │                                                                 │
│            ▼                                                                 │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ IF velocity > 2 AND sources >= 5:                                      │ │
│  │   ┌──────────────────────────────────────────────────────────────────┐ │ │
│  │   │ UPDATE story_clusters SET is_breaking=true, breaking_started_at  │ │ │
│  │   │ WHERE id = ? AND is_breaking = false  -- Idempotent               │ │ │
│  │   └──────────────────────────────────────────────────────────────────┘ │ │
│  │                                                                        │ │
│  │   IF row updated (newly breaking):                                     │ │
│  │     ├─► Redis PUBLISH 'breaking-news' channel (for all API servers)   │ │
│  │     └─► Queue push notifications for interested users                  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  Push Notification Query:                                                    │
│  SELECT users WHERE push_enabled = true AND preferences.topics ?| story.topics│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Frontend: Real-time Breaking News UI

**useBreakingNews Hook:**
- WebSocket connection to receive `breaking_news` events
- Tracks `dismissedIds` to avoid re-showing dismissed stories
- Falls back to polling /api/v1/breaking every 30s when WS disconnected
- Triggers browser Notification API (if permitted)
- Plays notification sound on new breaking story

**BreakingNewsBanner Component:**
- Fixed position at top (z-50)
- Red background with pulsing dot indicator
- Displays story title (clickable to navigate)
- Shows SourceStack (max 3 favicons)
- X button to dismiss (adds to dismissedIds)
- Role="alert" with aria-live="assertive" for accessibility

---

## Step 7: Deep Dive - Reading Progress Sync (5 minutes)

### Backend: Reading History API

**Batch Upsert Strategy:**
- POST /api/v1/reading-history with array of entries
- ON CONFLICT: accumulate dwell_time, keep latest read_at
- After upsert: invalidate user's feed cache (redis.del feed:user:*:*)

### Frontend: Dwell Time Tracking and Sync

**readingProgressStore (Zustand + persist):**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    READING PROGRESS ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  State:                                                                      │
│  ├─ readStories: Set<storyId>                                               │
│  └─ pendingEntries: Array<{storyClusterId, readAt, dwellTimeSeconds}>       │
│                                                                              │
│  Actions:                                                                    │
│  ├─ markAsRead(storyId) → Add to readStories, create pending entry          │
│  ├─ trackDwellTime(storyId, seconds) → Update/create pending entry          │
│  └─ syncToServer() → POST entries to API, clear pendingEntries on success   │
│                                                                              │
│  Persistence: localStorage via zustand/middleware/persist                   │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  useReadingHistorySync Hook:                                                 │
│  ├─ setInterval(syncToServer, 30000) - sync every 30s                       │
│  └─ addEventListener('beforeunload', syncToServer) - sync on page leave     │
│                                                                              │
│  useDwellTimeTracker(storyId) Hook:                                          │
│  ├─ startTime ref = Date.now()                                               │
│  ├─ setInterval every 10s: trackDwellTime(storyId, elapsed)                 │
│  └─ On unmount: track remaining time                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 8: Error Handling Strategy (3 minutes)

### Backend: Centralized Error Handling

**Error Classes:**
- `AppError(message, statusCode, code)` - base class
- `NotFoundError(resource)` - 404
- `ValidationError(message)` - 400

**Error Middleware:**
- Logs error with path, method, stack
- If AppError: return structured { error: { code, message } }
- Unknown errors: return 500 with generic message

### Frontend: Error Boundary and Toast

**ErrorBoundary Component:**
- Catches React rendering errors
- Displays "Something went wrong" with error message
- Provides "Refresh page" button

**API Interceptor:**
- Response error handler extracts message from response.data.error.message
- Shows toast.error(message)
- 401 errors trigger useAuthStore.logout()

---

## Trade-offs Summary

| Decision | Chosen Approach | Alternative | Trade-off |
|----------|-----------------|-------------|-----------|
| Breaking news delivery | WebSocket + polling fallback | Server-Sent Events | Bi-directional capability vs simpler protocol |
| Feed caching | 60s Redis TTL | Real-time generation | Fast response vs always-fresh |
| Reading history sync | Periodic batch (30s) | Real-time per-read | Lower API calls vs immediate personalization |
| Deduplication | SimHash 64-bit | Semantic embeddings | Fast O(1) compare vs better paraphrase detection |
| State management | Zustand | React Query | Simpler model vs built-in caching |
| Source diversity UI | Expandable list | Always visible grid | Cleaner initial view vs immediate visibility |

---

## Future Enhancements

1. **Collaborative Filtering** - "Users like you read..." recommendations
2. **ML Topic Extraction** - Replace keyword matching with trained classifier
3. **Semantic Search** - Vector similarity for concept-based queries
4. **Offline Mode PWA** - Service worker for cached article reading
5. **Source Credibility ML** - Automated scoring based on accuracy history
6. **A/B Testing Framework** - Compare ranking algorithm variants

---

## Closing Summary

"I've designed a full-stack news aggregator with:

1. **Content Pipeline** - RSS crawling with rate limiting, SimHash deduplication, and story clustering
2. **Multi-signal Ranking** - Combining relevance, freshness, quality, diversity, and trending signals
3. **Breaking News System** - Velocity detection on backend, WebSocket push to frontend
4. **Source Diversity UI** - Showing multiple perspectives with credibility indicators
5. **Reading Progress Sync** - Frontend dwell time tracking with periodic backend sync

The key integration points are: shared TypeScript types for API contracts, WebSocket for real-time breaking news, and periodic sync for reading history. The backend focuses on data processing and caching, while the frontend handles virtualized rendering and optimistic updates. Happy to dive deeper into any layer."
