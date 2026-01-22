# Facebook Post Search - System Design Answer (Full-Stack Focus)

## 45-minute system design interview format - Full-Stack Engineer Position

### 1. Requirements Clarification (3 minutes)

**Functional Requirements:**
- Full-text search across posts with privacy enforcement
- Real-time typeahead suggestions
- Personalized ranking based on social graph
- Filters for date range, post type, author
- Search history and saved searches

**Non-Functional Requirements:**
- End-to-end latency: P99 < 300ms
- Typeahead: < 100ms perceived latency
- Zero privacy violations (unauthorized content never shown)
- Graceful degradation on backend failures

**Full-Stack Focus Areas:**
- API contract design and type sharing
- Optimistic UI updates with error handling
- Real-time suggestion streaming
- Caching strategy across layers
- End-to-end testing approach

---

### 2. High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Full-Stack View                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                            Frontend                                     │ │
│  │  SearchBar → useSearchStore (Zustand) → SearchAPI → SearchResults     │ │
│  │      ↓              ↓                       ↓              ↓          │ │
│  │  Debounce    Local Cache              HTTP/fetch     Virtualization   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                           HTTP/REST API                                      │
│                                    ↓                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                            Backend                                      │ │
│  │  Express Router → SearchService → Elasticsearch → Response Builder    │ │
│  │       ↓               ↓                ↓                ↓             │ │
│  │  Auth Middleware  Visibility     Query Builder    Highlighting       │ │
│  │       ↓               ↓                                               │ │
│  │  Rate Limiter    Redis Cache ←────── PostgreSQL (Social Graph)       │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         Shared Package                                  │ │
│  │  @fb-search/shared-types: API types, validation schemas, constants   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Integration Points:**
1. **Search API**: Query → Results with highlighting
2. **Suggestions API**: Partial query → Typeahead options
3. **Visibility System**: User ID → Authorized fingerprints
4. **Caching**: Multi-layer (browser, CDN, Redis, ES query cache)

---

### 3. Full-Stack Deep-Dives

#### Deep-Dive A: Shared Types Package (6 minutes)

**Search Request/Response Types:**

SearchRequest contains query (string), optional filters (dateRange with ISO 8601 start/end, postType as 'text' | 'photo' | 'video' | 'link', authorId), optional cursor for pagination, and optional limit.

SearchResponse includes results array, total count, has_more boolean, next_cursor (string or null), took_ms for timing, and query_id for analytics.

SearchResult contains id, author object (id, display_name, avatar_url, is_verified), content string, highlights array with start/end/field, post_type, created_at, engagement stats (like_count, comment_count, share_count), optional media array, and relevance_score.

Highlight specifies start and end positions with field type ('content' | 'hashtag' | 'author').

**Suggestions Types:**

SuggestionRequest has query string and optional limit. SuggestionResponse contains suggestions array. Each Suggestion has type ('query' | 'hashtag' | 'person' | 'history'), text, and optional metadata (personId, avatarUrl, postCount).

**Error Types:**

ApiError contains code string, message, and optional details record. ErrorCodes defines constants: INVALID_QUERY, RATE_LIMITED, UNAUTHORIZED, INTERNAL_ERROR, TIMEOUT.

**Zod Validation Schemas:**

searchRequestSchema validates: query (1-500 chars), filters object with optional dateRange (datetime strings), postType enum, authorId (uuid), optional cursor, and limit (1-100, default 20).

suggestionRequestSchema validates: query (1-100 chars), limit (1-10, default 5).

Type inference using z.infer creates ValidatedSearchRequest and ValidatedSuggestionRequest types.

**Using Shared Types:**

Backend imports types and schemas from @fb-search/shared-types, uses safeParse for validation, returns ApiError on failure with ErrorCodes.INVALID_QUERY.

Frontend imports same types, builds URLSearchParams from request, throws SearchError on non-OK response.

---

#### Deep-Dive B: API Design and Implementation (8 minutes)

**Express Router Endpoints:**

`GET /search` - Authenticated, rate limited (100/min), validates with searchRequestSchema against query params. Executes search via searchService, adds X-Response-Time header, sets Cache-Control: private, max-age=60 with Vary: Authorization.

`GET /suggestions` - Authenticated, rate limited (300/min), validates with suggestionRequestSchema. Returns suggestions with short cache (10 seconds).

`GET /search/history` - Returns 20 most recent searches for authenticated user.

`DELETE /search/history` - Clears user's search history, returns 204 No Content.

**Validation Middleware:**

Generic validateRequest function accepts Zod schema and request part ('body' | 'query' | 'params'). Calls safeParse, returns 400 with ApiError on failure including flattened error details. Attaches validated data to req.validated.

Express Request type is extended globally to include validated and userId properties.

**Frontend API Client:**

SearchApiClient class with private abortController for cancellation.

search() method cancels in-flight requests, builds URLSearchParams, fetches with credentials: 'include'. Throws SearchApiError on non-OK, handles AbortError specially.

getSuggestions() builds params, fetches, returns empty array on error (fail silently).

getHistory() and clearHistory() for search history management.

buildSearchParams() private method converts SearchRequest to URLSearchParams, handling filters.dateRange, postType, authorId.

Custom errors: SearchApiError extends Error with apiError and status, SearchAbortedError for cancelled requests.

---

#### Deep-Dive C: Multi-Layer Caching Strategy (8 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Caching Layers                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Layer 1: Browser Cache (SessionStorage)                                    │
│  ├─ Recent search results (per query hash)                                  │
│  ├─ TTL: Session duration                                                   │
│  └─ Size: 50 most recent queries                                            │
│                                                                              │
│  Layer 2: Service Worker Cache                                              │
│  ├─ API responses for offline support                                       │
│  ├─ TTL: 1 hour (stale-while-revalidate)                                   │
│  └─ Size: 10MB limit                                                        │
│                                                                              │
│  Layer 3: Redis (Server-side)                                               │
│  ├─ Visibility sets per user                                                │
│  │   └─ Key: visibility:{userId}, TTL: 5 min                               │
│  ├─ Popular queries                                                         │
│  │   └─ Key: search:{queryHash}:{visibilityHash}, TTL: 1 min              │
│  └─ Suggestion results                                                      │
│      └─ Key: suggest:{prefix}, TTL: 10 min                                 │
│                                                                              │
│  Layer 4: Elasticsearch Query Cache                                         │
│  ├─ Built-in query result caching                                          │
│  ├─ Invalidated on index refresh                                           │
│  └─ Size: 10% of heap                                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Frontend Cache Implementation:**

SearchCache class with MAX_ENTRIES=50, TTL_MS=60000 (1 min), STORAGE_KEY='search_cache'.

get(request) generates cache key, checks entry existence and expiration, deletes expired entries.

set(request, response) evicts oldest entry if at capacity, stores with timestamp, persists to sessionStorage.

invalidate(pattern) clears all or matching keys.

getCacheKey() builds key from query, filters.postType, dateRange.start/end, authorId, cursor joined with pipes.

loadFromStorage/saveToStorage handle sessionStorage with try/catch for unavailability.

**Backend Cache Service:**

CacheService class with Redis client.

**Visibility Cache:**
- getVisibilitySet(userId) returns smembers or null if empty
- setVisibilitySet(userId, fingerprints) uses pipeline: del, sadd, expire(300)
- invalidateVisibility(userId) deletes key

**Search Results Cache:**
- getSearchResults(request, visibilityHash) returns parsed JSON or null
- setSearchResults() increments request count, only caches if "popular" (5+ requests/hour), TTL 60s

**Suggestions Cache:**
- getSuggestions(prefix) returns lrange 0-9 or null
- setSuggestions(prefix, suggestions) uses pipeline with TTL 600s

**Helpers:**
- getSearchCacheKey() combines request hash and visibility hash
- hashRequest() normalizes and MD5 hashes to 12 chars
- hashQuery() MD5 hashes lowercase trimmed query to 8 chars
- hashVisibilitySet() sorts fingerprints, joins, MD5 hashes to 12 chars

---

#### Deep-Dive D: End-to-End Search Flow (8 minutes)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Search Request Flow                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  1. User types "vacation photos" in SearchBar                                │
│     │                                                                         │
│  2. Frontend: Debounce (150ms) → Check session cache                         │
│     │                                                                         │
│  3. Cache MISS → Send GET /api/v1/search?query=vacation+photos               │
│     │                                                                         │
│  4. Backend: Auth middleware validates session cookie                         │
│     │                                                                         │
│  5. Backend: Validate request with Zod schema                                │
│     │                                                                         │
│  6. Backend: Check visibility cache (Redis)                                  │
│     │                                                                         │
│  7. Visibility cache MISS → Compute from PostgreSQL                          │
│     │                                                                         │
│  8. Backend: Build Elasticsearch query with privacy filter                   │
│     │                                                                         │
│  9. Elasticsearch: Execute query, return 500 candidates                      │
│     │                                                                         │
│ 10. Backend: Re-rank with social proximity                                   │
│     │                                                                         │
│ 11. Backend: Extract highlights, build response                              │
│     │                                                                         │
│ 12. Backend: Cache visibility set for 5 min                                  │
│     │                                                                         │
│ 13. Response → Frontend                                                       │
│     │                                                                         │
│ 14. Frontend: Update Zustand store, cache results                            │
│     │                                                                         │
│ 15. Frontend: Render virtualized results with highlights                     │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Search Service Implementation:**

SearchService constructor takes ElasticsearchClient, VisibilityService, RankingService, HighlightService, CacheService, SearchHistoryRepository.

**search(request, userId) workflow:**
1. Generate queryId with crypto.randomUUID()
2. Get user's visibility fingerprints (check cache, compute if miss)
3. Hash visibility set for cache key
4. Check search results cache (increment metrics on hit/miss)
5. Build Elasticsearch query with privacy filter
6. Execute against posts-* index
7. Re-rank with social signals via rankingService
8. Build response with highlights
9. Construct SearchResponse with results, total, has_more, next_cursor, took_ms, query_id
10. Async cache and record history (don't await)
11. Observe latency metric, return response

**getVisibilitySet(userId):**
Checks cache first, computes via visibilityService if miss, caches result.

**buildQuery(request, visibilitySet):**
Creates bool query with multi_match (content^2, hashtags^1.5, author_name) with fuzziness AUTO.

Filter includes terms query on visibility_fingerprints for privacy.

Highlight configuration with pre_tags/post_tags for <mark>.

Applies optional filters: dateRange (range query), postType (term), authorId (term).

Handles cursor-based pagination with search_after.

**buildResults(hits, query):**
Maps ES hits to SearchResult objects with author info, highlights, engagement stats.

**Cursor encoding:**
buildCursor() base64 encodes { score, created_at, id }.
decodeCursor() parses base64 back to object.

**Frontend Integration:**

executeSearch action in Zustand store:
1. Gets current query and filters from state
2. Sets isLoading, clears error
3. Checks local cache first
4. Fetches from API if cache miss
5. Caches successful response
6. Updates results, hasMore, nextCursor, loading state
7. Adds to searchHistory (max 50 entries)
8. Handles SearchAbortedError (ignores), other errors set error state

---

### 4. Integration Testing Strategy

**Backend Integration Tests (Vitest + Supertest):**

Setup: setupTestDb(), seedTestData(), login to get sessionCookie.

**GET /api/v1/search tests:**
- Returns matching posts with highlights, took_ms < 500
- Respects privacy - only shows authorized posts (no friends-only from non-friends)
- Filters by post type correctly
- Validates query parameters (empty query returns 400 with INVALID_QUERY)
- Requires authentication (401 without session)

**GET /api/v1/suggestions tests:**
- Returns typeahead suggestions as array

**E2E Tests (Playwright):**

beforeEach logs in via form submission, waits for redirect.

**Full search flow test:**
- Fill search bar with "vacation"
- Wait for suggestions listbox and first option
- Press Enter to search
- Wait for feed and first article
- Verify mark.search-highlight contains query

**Filter test:**
- Search, open filters, select photo radio
- Apply, verify URL contains postType=photo
- Verify first result is visible

---

### 5. Trade-offs Analysis

| Decision | Pros | Cons |
|----------|------|------|
| Shared types package | Type safety across stack, single source of truth | Build complexity, version sync |
| Session-based caching | Per-user cache isolation, privacy safe | No cross-user cache sharing |
| Cursor pagination | Stable results, handles concurrent updates | Can't jump to specific page |
| Over-fetch for re-ranking (500 candidates) | Better relevance with social signals | Higher latency, more ES load |
| Client-side highlighting fallback | Works if server omits highlights | Less accurate than ES highlighting |
| Multi-layer cache invalidation | Fresh data when relationships change | Complex invalidation logic |

---

### 6. Observability

**Backend Metrics (Prometheus):**

search_latency_ms histogram with cache_hit label, buckets [10, 50, 100, 200, 500, 1000].

cache_hits_total counter with type and layer labels.

search_errors_total counter with error_code label.

**Frontend Metrics (Analytics):**

trackSearchMetrics sends: query_id, result_count, latency_ms, has_filters, is_cached.

trackSearchInteraction sends event with data, timestamp, session_id.

Usage example: result_clicked event with query, result_position, result_id.

---

### 7. Future Enhancements

1. **Real-time Updates**: WebSocket for new matching posts while viewing results
2. **Federated Search**: Extend to photos, events, groups with unified ranking
3. **Query Rewriting**: ML-based query expansion and correction
4. **Personalized Suggestions**: User-specific typeahead based on history and graph
5. **Offline Search**: Service worker caching for recent queries
6. **A/B Testing Framework**: Compare ranking algorithms with holdout groups
7. **Search Analytics Dashboard**: Query trends, zero-result analysis, CTR by position
