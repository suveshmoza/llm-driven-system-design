# Typeahead - System Design Interview Answer

## Opening Statement (1 minute)

"I'll design a typeahead/autocomplete system that provides instant search suggestions as users type. The core challenge is achieving sub-50ms latency for prefix matching across billions of possible queries while balancing popularity, personalization, and trending topics in the ranking.

This involves three key technical challenges: building a trie data structure with pre-computed top-k suggestions at each node, designing a sharded serving layer that can handle 100k+ QPS, and implementing a real-time data pipeline that surfaces trending queries within minutes."

---

## 📋 Requirements Clarification (3 minutes)

### Functional Requirements
- **Suggest**: Return top suggestions for any prefix
- **Rank**: Order by relevance (popularity, recency, personalization)
- **Personalize**: User-specific suggestion boosting
- **Update**: Reflect trending topics in near real-time
- **Filter**: Remove inappropriate or blocked content

### Non-Functional Requirements
- **Latency**: < 50ms P99
- **Availability**: 99.99%
- **Scale**: 100K+ QPS
- **Freshness**: Trending within 5 minutes

### Scale Estimates
- **Unique queries**: 1 billion
- **QPS at peak**: 100,000+
- **Suggestions per request**: 5-10
- **Index update frequency**: Every minute

### Key Questions I'd Ask
1. How important is personalization vs. global popularity?
2. What's the acceptable staleness for trending boosts?
3. Should we support fuzzy matching (typo correction)?

---

## 🏗️ High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────┐
│                     Client Layer                                │
│              Search Box │ Mobile App │ API                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway                                  │
│               (Load Balancing, Caching)                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Suggestion Service                             │
│         (Prefix Matching, Ranking, Personalization)             │
└─────────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Trie Servers │    │Ranking Service│    │   User Data   │
│               │    │               │    │               │
│ - Prefix match│    │ - Score calc  │    │ - History     │
│ - Sharded     │    │ - Trending    │    │ - Preferences │
└───────────────┘    └───────────────┘    └───────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Aggregation Pipeline                          │
│          Query Logs → Count → Filter → Trie Build               │
└─────────────────────────────────────────────────────────────────┘
```

### Core Components

1. **Trie Servers**: Prefix matching with pre-computed top-k
2. **Suggestion Service**: Orchestrates trie lookup, ranking, personalization
3. **Ranking Service**: Multi-factor scoring (popularity, recency, trending)
4. **Aggregation Pipeline**: Processes query logs, updates trie data

---

## 🔍 Deep Dive: Trie with Pre-computed Top-K (8 minutes)

This is the key data structure enabling sub-50ms latency.

### Trie Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                       Trie Node                                 │
├─────────────────────────────────────────────────────────────────┤
│  children: Map<char, TrieNode>   │ Character to child node      │
│  isEndOfWord: boolean            │ Marks complete phrase        │
│  suggestions: Suggestion[]       │ Pre-computed top-k (10)      │
│  count: number                   │ Frequency count              │
└─────────────────────────────────────────────────────────────────┘
```

**Key operations:**
- **insert(phrase, count)**: Add phrase, update top-k at each prefix node
- **getSuggestions(prefix)**: O(prefix_length) lookup, return pre-computed list
- **updateSuggestions(node)**: Sort by count, keep top-k

### Why Pre-compute Top-K?

| Approach | Query Time | Space | Update Cost |
|----------|------------|-------|-------------|
| Traverse subtree | O(subtree size) | Low | O(1) |
| Pre-computed top-k | O(prefix length) | Higher | O(k log k) |

> "I'm choosing pre-computed top-k because at 100K QPS, we can't traverse subtrees. For prefix 'a', the subtree could have millions of nodes. The memory trade-off is worth it for O(prefix_length) queries."

### Sharding Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                    Shard by First Character                     │
├─────────────────────────────────────────────────────────────────┤
│  prefix "apple" → shard 'a' → trie-server-01                    │
│  prefix "apple" → "appl" → "app" all hit same shard             │
│  (preserves prefix locality for cache efficiency)               │
└─────────────────────────────────────────────────────────────────┘
```

**Why first character?**
- Queries for "app" and "apple" go to same shard (prefix locality)
- Even distribution across alphabet
- Simple routing logic
- Alternative: Hash-based (loses locality, needs scatter-gather)

**Handling hot spots** (letters 'a', 's', 't' get more traffic):
- Split hot shards into sub-shards using second character
- 'a' routes to a-shard-1, a-shard-2, a-shard-3 based on prefix[1]

---

## 📊 Deep Dive: Multi-Factor Ranking (7 minutes)

Raw popularity isn't enough. We blend multiple signals.

### Ranking Formula

```
┌─────────────────────────────────────────────────────────────────┐
│                    Ranking Weights                              │
├─────────────────────────────────────────────────────────────────┤
│  popularityScore * 0.30   │ log10(count + 1)                    │
│  recencyScore    * 0.15   │ exp(-ageInHours / 168) 1-week decay │
│  personalScore   * 0.25   │ user history match, 30-day decay    │
│  trendingBoost   * 0.20   │ sliding window counters             │
│  matchQuality    * 0.10   │ prefix position quality             │
└─────────────────────────────────────────────────────────────────┘
```

### Match Quality Scoring
- **Exact start match**: 1.0 (phrase starts with prefix)
- **Word boundary match**: 0.8 (prefix matches after space)
- **Substring match**: 0.5 (prefix found anywhere)

### Trending Boost Calculation
- Sliding window counters (5-minute windows)
- Last 12 windows aggregated (1 hour)
- Normalized to 0-1 range via Redis sorted set

---

## 🔍 Deep Dive: Real-Time Aggregation Pipeline (5 minutes)

### Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                   Aggregation Pipeline                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Query Logs (Kafka) ──► Buffer (Map) ──► Filter ──► Trie Update │
│         │                    │              │                   │
│         │                    │              │                   │
│         ▼                    ▼              ▼                   │
│  [ user query ]        [ count++ ]    [ quality ]               │
│  [ timestamp  ]        [ 60s flush]   [ blocked ]               │
│  [ user_id   ]         [ batch    ]   [ content ]               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Quality Filters
- **Too short**: query.length < 2
- **Too long**: query.length > 100
- **Only numbers**: /^\d+$/ pattern
- **Keyboard smash**: /^[asdfghjkl...]{10,}$/i pattern
- **Blocked content**: Inappropriate phrase list

### Trie Rebuild Strategy
- **Incremental updates**: Add delta counts every minute
- **Full rebuild**: Nightly rebuild from aggregated data
- **A/B deployment**: Build new trie, swap atomically

---

## ⚖️ Trade-offs and Alternatives (8 minutes)

### 1. Data Structure Alternatives

| Data Structure | Prefix Lookup | Memory | Update Cost | Best For |
|----------------|---------------|--------|-------------|----------|
| ✅ **Trie** | O(prefix_len) | High | O(k log k) | Exact prefix matching |
| ❌ Radix Trie | O(prefix_len) | Medium | O(k log k) | Memory-constrained |
| ❌ DAWG | O(prefix_len) | Low | Expensive rebuild | Static datasets |
| ❌ Elasticsearch | O(1) | High | Near real-time | Complex queries |
| ❌ BK-Tree | O(n^α) | Medium | O(log n) | Fuzzy/typo correction |

> "I'm choosing Trie with pre-computed top-k because we need exact prefix matching at 100K QPS. Radix Trie saves 40-60% memory but complicates top-k storage. DAWG requires full rebuild on updates. Elasticsearch adds operational complexity and higher latency."

### 2. Pre-computed vs. On-demand Top-K

| Approach | Query Time | Memory | Consistency |
|----------|------------|--------|-------------|
| ✅ **Pre-computed** | O(1) | O(nodes x k) | Eventually consistent |
| ❌ On-demand traversal | O(subtree size) | O(1) extra | Always consistent |
| ❌ Hybrid | O(1) to O(subtree) | O(top_nodes x k) | Mixed |

### 3. Sharding Strategy Alternatives

| Strategy | Locality | Distribution | Hot Spots |
|----------|----------|--------------|-----------|
| ✅ **First character** | Excellent | Uneven | Yes (handled) |
| ❌ Consistent hashing | None | Even | No |
| ❌ Range-based | Good | Configurable | Tunable |

> "I'm choosing first-character sharding because it preserves prefix locality. User typing 'app' → 'appl' → 'apple' hits the same shard, improving cache utilization. Consistent hashing would route each prefix to different shards."

### 4. Ranking Algorithm Alternatives

| Approach | Personalization | Latency | Explainability |
|----------|-----------------|---------|----------------|
| ✅ **Weighted formula** | Basic | <1ms | High |
| ❌ ML model (LTR) | Advanced | 5-20ms | Low |
| ❌ Two-stage ranking | Advanced | 2-10ms | Medium |
| ❌ Contextual bandits | Adaptive | 1-5ms | Medium |

### 5. Real-Time Updates Alternatives

| Approach | Latency to Surface | Complexity |
|----------|-------------------|------------|
| ❌ Batch rebuild | Minutes to hours | Low |
| ❌ Pure streaming | Sub-second | High |
| ✅ **Hybrid hot/cold** | Seconds | Medium |

> "I'm choosing hybrid approach: cold path for nightly full rebuilds, hot path for real-time trending via Redis sliding windows. Pure streaming (Flink) adds operational complexity; for most queries, 1-minute staleness is acceptable."

### 6. Caching Strategy

| Strategy | Hit Rate | Staleness | Complexity |
|----------|----------|-----------|------------|
| ❌ No cache | 0% | None | Lowest |
| ❌ Fixed TTL | 60-80% | TTL seconds | Low |
| ✅ **LRU with TTL** | 70-85% | TTL seconds | Low |
| ❌ Stale-while-revalidate | 95%+ | Seconds | Medium |

---

## 🏗️ Deep Dive: Frontend Architecture (10 minutes)

### Widget Types

```
┌─────────────────────────────────────────────────────────────────┐
│                    Typeahead Widget Types                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. SEARCH BOX          2. COMMAND PALETTE    3. FORM COMPLETE  │
│  ┌────────────────┐     ┌────────────────┐    ┌──────────────┐  │
│  │ 🔍 weat        │     │ ⌘K git sta     │    │ Email: j@g   │  │
│  ├────────────────┤     ├────────────────┤    │ ┌──────────┐ │  │
│  │ weather today  │     │ ⚡ git status  │    │ │gmail.com │ │  │
│  │ weather radar  │     │ ⚙️ git stash   │    │ └──────────┘ │  │
│  │ 🔥 weather[HOT]│     └────────────────┘    └──────────────┘  │
│  └────────────────┘                                             │
│                                                                 │
│  4. RICH SUGGESTIONS    5. MOBILE                               │
│  ┌────────────────┐     ┌────────────────┐                      │
│  │ 🔍 taylor swi  │     │ ┌────────────┐ │                      │
│  ├────────────────┤     │ │ weat    [X]│ │                      │
│  │ 🎤 Taylor Swift│     │ └────────────┘ │                      │
│  │    89M followers│    │ weather today→ │                      │
│  │ 🎵 Anti-Hero   │     │ RECENT         │                      │
│  │    1.2B plays  │     │ weather yday 🕐│                      │
│  └────────────────┘     └────────────────┘                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Request Management

```
┌─────────────────────────────────────────────────────────────────┐
│                Request Manager Flow                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User Types ──► Debounce Timer (150ms) ──► Check Cache          │
│       │                                        │                │
│       │                                   ┌────┴────┐           │
│       ▼                                   ▼         ▼           │
│  [Clear previous timer]              [HIT]      [MISS]          │
│  [Cancel pending request]              │           │            │
│                                        │           ▼            │
│                                        │    [AbortController]   │
│                                        │    [Fetch API]         │
│                                        │           │            │
│                                        ▼           ▼            │
│                                   [Return suggestions]          │
│                                   [Merge with local sources]    │
│                                   [Rank and limit]              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key behaviors:**
- Debounce: 150ms for API, 50ms for local data
- AbortController cancels in-flight requests on new keystroke
- Merge recent searches + API results + static suggestions
- Fallback to stale cache on network error

### Multi-Layer Caching Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                 Frontend Caching Layers                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Layer 1: In-Memory Cache (0ms)                                 │
│  ├─ Map<prefix, {suggestions, timestamp}>                       │
│  ├─ TTL: 60 seconds, Size: ~500 entries                         │
│  └─ Prefix substring caching enabled                            │
│                         ↓ miss                                  │
│  Layer 2: Service Worker Cache (1-5ms)                          │
│  ├─ Cache API with stale-while-revalidate                       │
│  ├─ TTL: 5 min (popular), 1 min (long-tail)                     │
│  └─ Survives page refresh, offline fallback                     │
│                         ↓ miss                                  │
│  Layer 3: IndexedDB (5-20ms)                                    │
│  ├─ User history (unlimited)                                    │
│  ├─ Popular queries dataset (preloaded)                         │
│  └─ Offline trie for offline support                            │
│                         ↓ miss                                  │
│  Layer 4: CDN Edge Cache (10-50ms)                              │
│  ├─ Edge nodes cache popular prefixes                           │
│  ├─ Cache-Control: public, max-age=60, stale-while-revalidate   │
│  └─ Vary: Accept-Encoding (not cookies for anonymous)           │
│                         ↓ miss                                  │
│  Layer 5: Origin Server (50-200ms)                              │
│  ├─ Redis cache (60s TTL)                                       │
│  └─ Trie in-memory lookup                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Service Worker Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│              Service Worker Cache Strategy                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Popular prefixes (a, the, how, what, why, best, top):          │
│  └─ Stale-while-revalidate, 5 min cache, 1 hour stale OK        │
│                                                                 │
│  Long-tail queries:                                             │
│  └─ Network-first with 3s timeout, 1 min cache fallback         │
│                                                                 │
│  X-Cache-Timestamp header added for cache validation            │
│  Automatic background refresh for stale entries                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Prefetching Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                   Prefetching Triggers                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  On Focus:                                                      │
│  └─ Prefetch all single-character prefixes (a-z)                │
│                                                                 │
│  On Keystroke:                                                  │
│  └─ Prefetch adjacent keyboard keys (q,w,s,z for 'a')           │
│  └─ Prefetch common suffixes (ing, tion, ness, ment)            │
│                                                                 │
│  Uses requestIdleCallback for non-blocking prefetch             │
│  Tracks prefetched prefixes to avoid duplicates                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Offline Support (IndexedDB)

```
┌─────────────────────────────────────────────────────────────────┐
│                   IndexedDB Schema                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  popularQueries:                                                │
│  ├─ key: prefix                                                 │
│  └─ value: {suggestions[], lastUpdated}                         │
│                                                                 │
│  userHistory:                                                   │
│  ├─ key: phrase                                                 │
│  ├─ indexes: lastUsed, count                                    │
│  └─ value: {phrase, count, lastUsed}                            │
│                                                                 │
│  offlineTrie:                                                   │
│  ├─ key: 'trie'                                                 │
│  └─ value: serialized trie for offline prefix matching          │
│                                                                 │
│  Periodic sync with server for popular queries and trie data    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Accessibility (ARIA)

**Required ARIA attributes:**
- `role="combobox"` on input
- `aria-expanded` tied to dropdown visibility
- `aria-controls` pointing to listbox ID
- `aria-activedescendant` for keyboard navigation
- `role="listbox"` on suggestions container
- `role="option"` with `aria-selected` on each suggestion
- Live region for screen reader announcements

**Keyboard navigation:**
- ArrowDown/Up: Navigate suggestions
- Enter: Select current suggestion
- Escape: Close dropdown
- Tab: Close and move focus

### Frontend Trade-offs Summary

| Decision | Chosen | Alternative | Reason |
|----------|--------|-------------|--------|
| Debounce timing | 150ms | 50ms / 300ms | Balance responsiveness vs. request volume |
| Cache strategy | Multi-layer | Single memory | Offline support + persistence |
| Prefetching | Idle-time adjacent | Aggressive all | Respect bandwidth, avoid cache pollution |
| CDN caching | Public for anonymous | Per-user everywhere | High hit rate on common prefixes |
| Offline storage | IndexedDB + Trie | LocalStorage | Larger storage, complex queries |
| Request cancellation | AbortController | No cancellation | Avoid stale responses overwriting fresh |

---

## 🚀 Closing Summary (1 minute)

"The typeahead system is built around four key innovations:

1. **Trie with pre-computed top-k** - By storing the top 10 suggestions at every prefix node, we achieve O(prefix_length) query time instead of traversing the subtree. This is essential for sub-50ms latency at 100K QPS.

2. **Multi-factor ranking** - We blend popularity (30%), personalization (25%), trending (20%), recency (15%), and match quality (10%) to surface the most relevant suggestions. Weights are tuned via A/B testing.

3. **Real-time aggregation pipeline** - Query logs flow through Kafka, get filtered for quality, and update both the trie (every minute) and sliding window trending counters (continuously).

4. **Multi-layer frontend caching** - From a frontend perspective, we implement five caching layers: in-memory cache (0ms), Service Worker cache (1-5ms), IndexedDB (5-20ms), CDN edge (10-50ms), and origin server (50-200ms). This enables offline support, reduces server load by 80%+, and ensures users see suggestions before their next keystroke.

The main trade-off is memory vs. latency. We use more memory for pre-computed suggestions because at 100K QPS, even milliseconds matter. On the frontend, the trade-off is complexity vs. resilience--multiple caching layers add implementation overhead but provide graceful degradation and offline capability. Future improvements would include fuzzy matching for typo correction, phrase-level embeddings for semantic similarity, and WebSocket streaming for instant trending updates."
