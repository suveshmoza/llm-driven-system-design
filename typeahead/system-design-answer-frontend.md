# Typeahead - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Problem Statement

Design the frontend architecture for a typeahead/autocomplete system that:
- Delivers suggestions before users finish typing (sub-50ms perceived latency)
- Implements multi-layer caching across browser memory, Service Worker, and IndexedDB
- Supports multiple widget types (search box, command palette, rich suggestions, mobile)
- Provides offline capability and graceful degradation
- Meets accessibility standards (WCAG 2.1 AA)

## Requirements Clarification

### Functional Requirements
1. **Instant Suggestions**: Show results as user types each character
2. **Multiple Widget Types**: Search box, command palette, form autocomplete, rich suggestions
3. **History Integration**: Merge user history with API suggestions
4. **Offline Support**: Work without network using cached data
5. **Keyboard Navigation**: Full keyboard accessibility

### Non-Functional Requirements
1. **Perceived Latency**: < 50ms from keypress to suggestions visible
2. **Cache Hit Rate**: > 80% to reduce server load
3. **Bundle Size**: < 5KB gzipped for core typeahead module
4. **Accessibility**: WCAG 2.1 AA compliant
5. **Offline**: Functional with stale data when offline

### Scale Estimates (Frontend)
- Keystrokes per session: 50-100
- API calls per session: 10-20 (with caching)
- Memory cache size: ~500 entries
- IndexedDB storage: ~5MB for offline trie

## High-Level Architecture

```
+-----------------------------------------------------------------------+
|                         Browser Environment                            |
+-----------------------------------------------------------------------+
|                                                                        |
|  +-------------------+    +-------------------+    +------------------+ |
|  |  Search Box       |    |  Command Palette  |    |  Rich Typeahead  | |
|  |  Widget           |    |  Widget           |    |  Widget          | |
|  +--------+----------+    +--------+----------+    +--------+---------+ |
|           |                        |                        |          |
|           +------------------------+------------------------+          |
|                                    |                                   |
|                                    v                                   |
|  +-------------------------------------------------------------------+ |
|  |                    Typeahead Core Module                           | |
|  |  - Request Manager (debounce, cancel, retry)                       | |
|  |  - Cache Coordinator (memory -> SW -> IDB -> CDN -> origin)        | |
|  |  - Source Merger (API + local + history)                           | |
|  |  - Ranking Engine (client-side re-ranking)                         | |
|  +-------------------------------------------------------------------+ |
|                                    |                                   |
|           +------------------------+------------------------+          |
|           |                        |                        |          |
|           v                        v                        v          |
|  +----------------+    +-------------------+    +-------------------+  |
|  | Memory Cache   |    | Service Worker    |    | IndexedDB         |  |
|  | (0ms, 500 items)|   | (1-5ms, stale-WR) |    | (5-20ms, offline) |  |
|  +----------------+    +-------------------+    +-------------------+  |
|                                    |                                   |
+-----------------------------------------------------------------------+
                                     |
                                     v
+-----------------------------------------------------------------------+
|                          Network Layer                                 |
+-----------------------------------------------------------------------+
|  CDN Edge Cache (10-50ms) -> Origin API (50-200ms)                    |
+-----------------------------------------------------------------------+
```

## Deep Dive: Widget Architecture

Modern applications require multiple typeahead implementations with different behaviors.

### Widget Type Configurations

```typescript
// Widget configuration interface
interface TypeaheadWidgetConfig {
  id: string
  type: 'search' | 'form' | 'command' | 'rich' | 'mobile'

  // Data sources (can combine multiple)
  sources: {
    api?: { endpoint: string; minChars: number }
    local?: { data: string[]; fuzzy: boolean }
    recent?: { storageKey: string; maxItems: number }
    static?: string[]  // Always show (e.g., popular searches)
  }

  // Behavior
  debounceMs: number
  minQueryLength: number
  maxSuggestions: number
  highlightMatches: boolean

  // Caching
  cacheStrategy: 'none' | 'memory' | 'session' | 'persistent'
  cacheTTLSeconds: number

  // Ranking
  rankingWeights: {
    relevance: number
    recency: number
    frequency: number
    personalization: number
  }
}

// Search box configuration
const searchBoxConfig: TypeaheadWidgetConfig = {
  id: 'main-search',
  type: 'search',
  sources: {
    api: { endpoint: '/api/v1/suggestions', minChars: 1 },
    recent: { storageKey: 'recent-searches', maxItems: 5 }
  },
  debounceMs: 150,
  minQueryLength: 1,
  maxSuggestions: 8,
  highlightMatches: true,
  cacheStrategy: 'memory',
  cacheTTLSeconds: 60,
  rankingWeights: {
    relevance: 0.4,
    recency: 0.2,
    frequency: 0.3,
    personalization: 0.1
  }
}

// Command palette (local-first, faster debounce)
const commandPaletteConfig: TypeaheadWidgetConfig = {
  id: 'command-palette',
  type: 'command',
  sources: {
    local: { data: registeredCommands, fuzzy: true },
    recent: { storageKey: 'recent-commands', maxItems: 3 }
  },
  debounceMs: 50,  // Faster for local data
  minQueryLength: 0,  // Show all commands initially
  maxSuggestions: 10,
  highlightMatches: true,
  cacheStrategy: 'session',
  cacheTTLSeconds: 3600,
  rankingWeights: {
    relevance: 0.5,
    recency: 0.3,
    frequency: 0.2,
    personalization: 0
  }
}
```

### Visual Widget Types

```
+-----------------------------------------------------------------------------+
|                        Typeahead Widget Types                                |
+-----------------------------------------------------------------------------+
|                                                                              |
|  1. SEARCH BOX (Primary)              2. INLINE FORM COMPLETION              |
|  +---------------------------+        +-------------------------------+      |
|  | [magnifier] weat          |        | Email: john@gma               |      |
|  +---------------------------+        |        +-------------------+  |      |
|  | weather forecast          |        |        | gmail.com         |  |      |
|  | weather today             |        |        | googlemail.com    |  |      |
|  | weather radar             |        |        +-------------------+  |      |
|  | [fire] weather alert      |        +-------------------------------+      |
|  | [pin] weather seattle     |                                               |
|  +---------------------------+        3. COMMAND PALETTE                     |
|                                       +-------------------------------+      |
|  4. RICH SUGGESTIONS                  | [cmd]K  git sta               |      |
|  +---------------------------+        +-------------------------------+      |
|  | [magnifier] taylor swi    |        | [bolt] git status             |      |
|  +---------------------------+        | [gear] git stash              |      |
|  | [mic] Taylor Swift        |        | [doc] git stage all           |      |
|  |    Artist - 89M followers |        +-------------------------------+      |
|  | [note] Anti-Hero          |                                               |
|  |    Song - 1.2B plays      |        5. MOBILE TYPEAHEAD                    |
|  | [news] Taylor Swift news  |        +-------------------------------+      |
|  |    Category               |        | | weat               [X] |    |      |
|  +---------------------------+        | weather forecast     ->  |    |      |
|                                       | weather today        ->  |    |      |
|                                       | ----------------------   |    |      |
|                                       | RECENT SEARCHES          |    |      |
|                                       | weather yesterday [clock]|    |      |
|                                       +-------------------------------+      |
+-----------------------------------------------------------------------------+
```

## Deep Dive: Request Management

The request manager handles debouncing, cancellation, and caching coordination.

### Request Manager Implementation

```typescript
class TypeaheadRequestManager {
  private pendingRequest: AbortController | null = null
  private debounceTimer: number | null = null
  private cache: Map<string, { data: Suggestion[]; timestamp: number }> = new Map()

  constructor(
    private config: TypeaheadWidgetConfig,
    private onSuggestions: (suggestions: Suggestion[]) => void,
    private onLoading: (loading: boolean) => void,
    private onError: (error: Error) => void
  ) {}

  async query(prefix: string): Promise<void> {
    // Clear previous debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    // Minimum query length check
    if (prefix.length < this.config.minQueryLength) {
      this.onSuggestions([])
      return
    }

    // Check memory cache first (instant response)
    const cached = this.checkCache(prefix)
    if (cached) {
      this.onSuggestions(cached)
      return
    }

    // Debounce the request
    this.debounceTimer = window.setTimeout(async () => {
      await this.executeQuery(prefix)
    }, this.config.debounceMs)
  }

  private async executeQuery(prefix: string): Promise<void> {
    // Cancel any pending request (prevents stale responses)
    if (this.pendingRequest) {
      this.pendingRequest.abort()
    }

    this.pendingRequest = new AbortController()
    this.onLoading(true)

    try {
      const response = await fetch(
        `${this.config.sources.api!.endpoint}?q=${encodeURIComponent(prefix)}`,
        {
          signal: this.pendingRequest.signal,
          headers: {
            'Accept': 'application/json',
            'X-Client-Version': '1.0.0'
          }
        }
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()

      // Merge with local sources
      const merged = this.mergeWithLocalSources(prefix, data.suggestions)

      // Update cache
      this.setCache(prefix, merged)

      // Deliver results
      this.onSuggestions(merged)
      this.onLoading(false)

    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // Request was cancelled, ignore
        return
      }
      this.onError(error as Error)
      this.onLoading(false)

      // Fallback to stale cache
      const stale = this.checkCache(prefix, { ignoreExpiry: true })
      if (stale) {
        this.onSuggestions(stale)
      }
    }
  }

  private checkCache(
    prefix: string,
    options: { ignoreExpiry?: boolean } = {}
  ): Suggestion[] | null {
    const entry = this.cache.get(prefix)
    if (!entry) return null

    const age = Date.now() - entry.timestamp
    const expired = age > this.config.cacheTTLSeconds * 1000

    if (expired && !options.ignoreExpiry) {
      return null
    }

    return entry.data
  }

  private setCache(prefix: string, data: Suggestion[]): void {
    this.cache.set(prefix, { data, timestamp: Date.now() })

    // Also cache prefix substrings for faster backspace
    // e.g., "weather" caches "weathe", "weath", "weat" with subset
    for (let i = prefix.length - 1; i >= this.config.minQueryLength; i--) {
      const subPrefix = prefix.substring(0, i)
      if (!this.cache.has(subPrefix)) {
        const subData = data.filter(s =>
          s.phrase.toLowerCase().startsWith(subPrefix.toLowerCase())
        )
        this.cache.set(subPrefix, { data: subData, timestamp: Date.now() })
      }
    }
  }

  private mergeWithLocalSources(prefix: string, apiResults: Suggestion[]): Suggestion[] {
    const merged: Suggestion[] = []
    const seen = new Set<string>()

    // Add recent searches first (if matching)
    if (this.config.sources.recent) {
      const recent = this.getRecentSearches(prefix)
      for (const item of recent) {
        if (!seen.has(item.phrase)) {
          merged.push({ ...item, source: 'recent' })
          seen.add(item.phrase)
        }
      }
    }

    // Add API results
    for (const item of apiResults) {
      if (!seen.has(item.phrase)) {
        merged.push({ ...item, source: 'api' })
        seen.add(item.phrase)
      }
    }

    // Apply ranking and limit
    return this.rankAndLimit(merged)
  }

  private rankAndLimit(suggestions: Suggestion[]): Suggestion[] {
    const weights = this.config.rankingWeights

    const scored = suggestions.map(s => ({
      ...s,
      score:
        (s.relevanceScore || 0) * weights.relevance +
        (s.recencyScore || 0) * weights.recency +
        (s.frequencyScore || 0) * weights.frequency +
        (s.personalizationScore || 0) * weights.personalization
    }))

    scored.sort((a, b) => b.score - a.score)

    return scored.slice(0, this.config.maxSuggestions)
  }
}
```

### Debounce vs Throttle Decision

```
User typing "weather":
Timeline (ms):   0    50   100  150  200  250  300  350  400  450
Keypress:        w    e    a    t    h    e    r
                 |    |    |    |    |    |    |
Debounce 150ms:  [----wait----] [----wait----] [----wait----][fire]
                                               Only fires for "weather"

Throttle 150ms:  [fire] [----] [fire] [----] [fire] [----] [fire]
                   w             eat           eather       weather
                 Fires at 0, 150, 300, 450 regardless
```

**Decision**: Use debounce because:
- Fewer API requests (1 vs 4 for "weather")
- User typically wants final prefix, not intermediate
- 150ms feels responsive but avoids request spam

## Deep Dive: Multi-Layer Caching Architecture

```
+-----------------------------------------------------------------------------+
|                     Frontend Caching Layers                                  |
+-----------------------------------------------------------------------------+
|                                                                              |
|  Layer 1: In-Memory Cache (Fastest - 0ms)                                   |
|  +-----------------------------------------------------------------------+  |
|  |  Map<prefix, { suggestions, timestamp }>                               |  |
|  |  - Survives during session                                             |  |
|  |  - TTL: 60 seconds                                                     |  |
|  |  - Size: ~500 entries (LRU eviction)                                   |  |
|  |  - Prefix substring caching for backspace                              |  |
|  +-----------------------------------------------------------------------+  |
|                              | miss                                          |
|                              v                                               |
|  Layer 2: Service Worker Cache (Fast - 1-5ms)                               |
|  +-----------------------------------------------------------------------+  |
|  |  Cache API with stale-while-revalidate                                 |  |
|  |  - Survives page refresh                                               |  |
|  |  - TTL: 5 minutes (popular), 1 minute (long-tail)                      |  |
|  |  - Offline fallback                                                    |  |
|  |  - Automatic background refresh                                        |  |
|  +-----------------------------------------------------------------------+  |
|                              | miss                                          |
|                              v                                               |
|  Layer 3: IndexedDB (Medium - 5-20ms)                                       |
|  +-----------------------------------------------------------------------+  |
|  |  Larger dataset storage                                                |  |
|  |  - User history (unlimited retention)                                  |  |
|  |  - Popular queries dataset (preloaded)                                 |  |
|  |  - Fuzzy matching trie (for offline)                                   |  |
|  |  - Persists across sessions                                            |  |
|  +-----------------------------------------------------------------------+  |
|                              | miss                                          |
|                              v                                               |
|  Layer 4: CDN Edge Cache (Fast - 10-50ms)                                   |
|  +-----------------------------------------------------------------------+  |
|  |  Edge nodes cache popular prefixes                                     |  |
|  |  - Geographic proximity                                                |  |
|  |  - TTL: 60 seconds + stale-while-revalidate                           |  |
|  |  - Cache key: /api/v1/suggestions?q={prefix}                          |  |
|  +-----------------------------------------------------------------------+  |
|                              | miss                                          |
|                              v                                               |
|  Layer 5: Origin Server (Slowest - 50-200ms)                                |
|  +-----------------------------------------------------------------------+  |
|  |  Trie lookup + ranking + personalization                               |  |
|  +-----------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------+
```

### Service Worker Implementation

```typescript
// service-worker.ts
const CACHE_NAME = 'typeahead-cache-v1'
const SUGGESTIONS_PATTERN = /\/api\/v1\/suggestions\?q=/

// Cache strategies by prefix popularity
const POPULAR_PREFIXES = new Set(['a', 'the', 'how', 'what', 'why', 'best', 'top'])

self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url)

  if (SUGGESTIONS_PATTERN.test(url.pathname + url.search)) {
    event.respondWith(handleSuggestionRequest(event.request, url))
  }
})

async function handleSuggestionRequest(request: Request, url: URL): Promise<Response> {
  const prefix = url.searchParams.get('q') || ''
  const isPopular = POPULAR_PREFIXES.has(prefix.charAt(0).toLowerCase()) &&
                    prefix.length <= 3

  // Stale-while-revalidate for popular prefixes
  if (isPopular) {
    return staleWhileRevalidate(request, {
      cacheName: CACHE_NAME,
      maxAge: 300,  // 5 minutes
      staleMaxAge: 3600  // 1 hour stale OK
    })
  }

  // Network-first for long-tail queries
  return networkFirst(request, {
    cacheName: CACHE_NAME,
    maxAge: 60,  // 1 minute
    timeout: 3000  // 3 second network timeout
  })
}

async function staleWhileRevalidate(
  request: Request,
  options: { cacheName: string; maxAge: number; staleMaxAge: number }
): Promise<Response> {
  const cache = await caches.open(options.cacheName)
  const cached = await cache.match(request)

  // Start network fetch in background
  const networkPromise = fetch(request).then(async (response) => {
    if (response.ok) {
      const clone = response.clone()
      const headers = new Headers(clone.headers)
      headers.set('X-Cache-Timestamp', Date.now().toString())

      const timedResponse = new Response(await clone.blob(), {
        status: clone.status,
        statusText: clone.statusText,
        headers
      })

      await cache.put(request, timedResponse)
    }
    return response
  })

  if (cached) {
    const timestamp = parseInt(cached.headers.get('X-Cache-Timestamp') || '0')
    const age = Date.now() - timestamp

    if (age < options.maxAge * 1000) {
      // Fresh cache, return immediately
      return cached
    }

    if (age < options.staleMaxAge * 1000) {
      // Stale but acceptable, return cached and revalidate
      networkPromise.catch(() => {}) // Ignore revalidation errors
      return cached
    }
  }

  // Cache miss or too stale, wait for network
  return networkPromise
}

async function networkFirst(
  request: Request,
  options: { cacheName: string; maxAge: number; timeout: number }
): Promise<Response> {
  const cache = await caches.open(options.cacheName)

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), options.timeout)

    const response = await fetch(request, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (response.ok) {
      const headers = new Headers(response.headers)
      headers.set('X-Cache-Timestamp', Date.now().toString())

      const timedResponse = new Response(await response.clone().blob(), {
        status: response.status,
        statusText: response.statusText,
        headers
      })

      await cache.put(request, timedResponse)
    }

    return response
  } catch (error) {
    // Network failed, try cache
    const cached = await cache.match(request)
    if (cached) {
      return cached
    }
    throw error
  }
}
```

### IndexedDB for Offline Support

```typescript
// IndexedDB schema for offline typeahead
interface TypeaheadDB {
  popularQueries: {
    key: string  // prefix
    value: {
      suggestions: Suggestion[]
      lastUpdated: number
    }
  }
  userHistory: {
    key: string  // phrase
    value: {
      phrase: string
      count: number
      lastUsed: number
    }
  }
  offlineTrie: {
    key: 'trie'
    value: SerializedTrie
  }
}

class OfflineTypeahead {
  private db: IDBDatabase | null = null
  private trie: Trie | null = null

  async initialize(): Promise<void> {
    this.db = await this.openDatabase()
    await this.loadTrie()
  }

  private async openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('typeahead', 1)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Popular queries store
        const popularStore = db.createObjectStore('popularQueries', { keyPath: 'prefix' })
        popularStore.createIndex('lastUpdated', 'lastUpdated')

        // User history store
        const historyStore = db.createObjectStore('userHistory', { keyPath: 'phrase' })
        historyStore.createIndex('lastUsed', 'lastUsed')
        historyStore.createIndex('count', 'count')

        // Offline trie store
        db.createObjectStore('offlineTrie', { keyPath: 'id' })
      }

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async getSuggestions(prefix: string): Promise<Suggestion[]> {
    // Try in-memory trie first
    if (this.trie) {
      const trieSuggestions = this.trie.getSuggestions(prefix)
      const historySuggestions = await this.getHistorySuggestions(prefix)
      return this.mergeAndRank(trieSuggestions, historySuggestions)
    }

    // Fallback to IndexedDB lookup
    return this.getStoredSuggestions(prefix)
  }

  private async getHistorySuggestions(prefix: string): Promise<Suggestion[]> {
    if (!this.db) return []

    return new Promise((resolve) => {
      const tx = this.db!.transaction('userHistory', 'readonly')
      const store = tx.objectStore('userHistory')
      const suggestions: Suggestion[] = []

      store.openCursor().onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          const value = cursor.value
          if (value.phrase.toLowerCase().startsWith(prefix.toLowerCase())) {
            suggestions.push({
              phrase: value.phrase,
              count: value.count,
              source: 'history',
              recencyScore: this.calculateRecency(value.lastUsed)
            })
          }
          cursor.continue()
        } else {
          resolve(suggestions)
        }
      }
    })
  }

  async recordSearch(phrase: string): Promise<void> {
    if (!this.db) return

    const tx = this.db.transaction('userHistory', 'readwrite')
    const store = tx.objectStore('userHistory')

    const existing = await this.getFromStore(store, phrase)

    if (existing) {
      store.put({
        phrase,
        count: existing.count + 1,
        lastUsed: Date.now()
      })
    } else {
      store.add({
        phrase,
        count: 1,
        lastUsed: Date.now()
      })
    }
  }

  // Periodic sync with server
  async syncWithServer(): Promise<void> {
    try {
      const response = await fetch('/api/v1/suggestions/popular-data')
      const data = await response.json()

      // Update IndexedDB with popular queries
      const tx = this.db!.transaction('popularQueries', 'readwrite')
      const store = tx.objectStore('popularQueries')

      for (const [prefix, suggestions] of Object.entries(data.prefixes)) {
        store.put({ prefix, suggestions, lastUpdated: Date.now() })
      }

      // Update offline trie
      if (data.trie) {
        const trieStore = this.db!.transaction('offlineTrie', 'readwrite')
          .objectStore('offlineTrie')
        trieStore.put({ id: 'main', data: data.trie, lastUpdated: Date.now() })
        this.trie = Trie.deserialize(data.trie)
      }
    } catch (error) {
      console.warn('Failed to sync typeahead data:', error)
    }
  }
}
```

## Deep Dive: Prefetching Strategy

```typescript
class TypeaheadPrefetcher {
  private prefetchQueue: Set<string> = new Set()
  private prefetchedPrefixes: Set<string> = new Set()

  constructor(private cache: TypeaheadCache) {}

  // Called on input focus
  async prefetchPopular(): Promise<void> {
    const popularPrefixes = [
      'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i',
      'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r',
      's', 't', 'u', 'v', 'w', 'x', 'y', 'z'
    ]

    // Prefetch single-character suggestions
    for (const prefix of popularPrefixes) {
      this.queuePrefetch(prefix)
    }
  }

  // Called when user types
  async prefetchAdjacent(currentPrefix: string): Promise<void> {
    if (currentPrefix.length < 2) return

    // Prefetch likely next characters based on keyboard layout
    const lastChar = currentPrefix.slice(-1).toLowerCase()
    const adjacentChars = this.getAdjacentKeys(lastChar)

    for (const char of adjacentChars) {
      this.queuePrefetch(currentPrefix + char)
    }

    // Also prefetch likely word completions
    const commonSuffixes = ['ing', 'tion', 'ness', 'ment', 'able', 'ful']
    for (const suffix of commonSuffixes) {
      if (suffix.startsWith(currentPrefix.slice(-1))) {
        this.queuePrefetch(currentPrefix + suffix.slice(1))
      }
    }
  }

  private getAdjacentKeys(char: string): string[] {
    const keyboardLayout: Record<string, string[]> = {
      'a': ['q', 'w', 's', 'z'],
      'b': ['v', 'g', 'h', 'n'],
      'c': ['x', 'd', 'f', 'v'],
      'd': ['s', 'e', 'r', 'f', 'c', 'x'],
      'e': ['w', 's', 'd', 'r'],
      'f': ['d', 'r', 't', 'g', 'v', 'c'],
      'g': ['f', 't', 'y', 'h', 'b', 'v'],
      // ... full keyboard adjacency map
    }
    return keyboardLayout[char] || []
  }

  private queuePrefetch(prefix: string): void {
    if (this.prefetchedPrefixes.has(prefix)) return
    if (this.cache.has(prefix)) return

    this.prefetchQueue.add(prefix)
    this.processPrefetchQueue()
  }

  private async processPrefetchQueue(): Promise<void> {
    if (this.prefetchQueue.size === 0) return

    // Use requestIdleCallback for non-blocking prefetch
    requestIdleCallback(async (deadline) => {
      while (deadline.timeRemaining() > 0 && this.prefetchQueue.size > 0) {
        const prefix = this.prefetchQueue.values().next().value
        this.prefetchQueue.delete(prefix)

        try {
          await this.cache.prefetch(prefix)
          this.prefetchedPrefixes.add(prefix)
        } catch {
          // Ignore prefetch failures
        }
      }

      // Continue processing if more items remain
      if (this.prefetchQueue.size > 0) {
        this.processPrefetchQueue()
      }
    })
  }
}
```

## Deep Dive: Accessibility Implementation

Full WCAG 2.1 AA compliance is essential for typeahead components.

### Accessible Typeahead Component

```tsx
function AccessibleTypeahead({
  id,
  label,
  suggestions,
  onSelect
}: TypeaheadProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const handleKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex(prev =>
          prev < suggestions.length - 1 ? prev + 1 : prev
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex(prev => prev > 0 ? prev - 1 : -1)
        break
      case 'Enter':
        if (activeIndex >= 0 && suggestions[activeIndex]) {
          onSelect(suggestions[activeIndex])
          setIsOpen(false)
        }
        break
      case 'Escape':
        setIsOpen(false)
        setActiveIndex(-1)
        inputRef.current?.focus()
        break
      case 'Tab':
        setIsOpen(false)
        break
    }
  }

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const activeElement = listRef.current.children[activeIndex] as HTMLElement
      activeElement?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  return (
    <div className="typeahead-container">
      <label
        id={`${id}-label`}
        htmlFor={id}
        className="sr-only"
      >
        {label}
      </label>

      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-expanded={isOpen}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={
          activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined
        }
        aria-autocomplete="list"
        aria-haspopup="listbox"
        autoComplete="off"
        onKeyDown={handleKeyDown}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 200)}
      />

      {isOpen && suggestions.length > 0 && (
        <ul
          ref={listRef}
          id={`${id}-listbox`}
          role="listbox"
          aria-labelledby={`${id}-label`}
          className="suggestions-list"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.phrase}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'active' : ''}
              onClick={() => onSelect(suggestion)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <HighlightedMatch
                text={suggestion.phrase}
                query={inputRef.current?.value || ''}
              />
              {suggestion.source === 'history' && (
                <span className="sr-only">(from your search history)</span>
              )}
              {suggestion.trending && (
                <span aria-label="trending" className="trending-badge">
                  Trending
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {isOpen && suggestions.length > 0 && (
          `${suggestions.length} suggestions available. Use up and down arrows to navigate.`
        )}
        {isOpen && suggestions.length === 0 && (
          'No suggestions available.'
        )}
      </div>
    </div>
  )
}
```

### CSS for Accessibility

```css
/* Screen reader only class */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Focus visible for keyboard users */
.typeahead-container input:focus-visible {
  outline: 2px solid #0066cc;
  outline-offset: 2px;
}

/* High contrast mode support */
@media (prefers-contrast: high) {
  .suggestions-list li.active {
    outline: 2px solid currentColor;
    background: Highlight;
    color: HighlightText;
  }
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .suggestions-list {
    transition: none;
  }
  .suggestions-list li {
    transition: none;
  }
}

/* Touch target size (44x44 minimum) */
.suggestions-list li {
  min-height: 44px;
  padding: 10px 16px;
  display: flex;
  align-items: center;
}

/* Color contrast (4.5:1 ratio) */
.suggestions-list li {
  background: #ffffff;
  color: #333333; /* 12.6:1 contrast ratio */
}

.suggestions-list li.active {
  background: #0066cc;
  color: #ffffff; /* 8.6:1 contrast ratio */
}
```

### ARIA Pattern Reference

| ARIA Attribute | Purpose | Value |
|---------------|---------|-------|
| `role="combobox"` | Identifies input as combobox | On input element |
| `aria-expanded` | Dropdown open state | `true` or `false` |
| `aria-controls` | Links input to listbox | ID of listbox |
| `aria-activedescendant` | Current active option | ID of active li |
| `aria-autocomplete="list"` | Suggestions type | Always "list" |
| `aria-haspopup="listbox"` | Popup type | Always "listbox" |
| `role="listbox"` | Identifies suggestions container | On ul element |
| `role="option"` | Identifies each suggestion | On li elements |
| `aria-selected` | Active/selected state | `true` on active |
| `aria-live="polite"` | Announce changes | On status element |

## Deep Dive: State Management

### Zustand Store for Typeahead

```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface TypeaheadState {
  // Input state
  query: string
  setQuery: (query: string) => void

  // Suggestions state
  suggestions: Suggestion[]
  isLoading: boolean
  error: Error | null

  // UI state
  isOpen: boolean
  activeIndex: number
  setIsOpen: (open: boolean) => void
  setActiveIndex: (index: number) => void

  // History (persisted)
  recentSearches: string[]
  addRecentSearch: (phrase: string) => void
  clearRecentSearches: () => void

  // Actions
  fetchSuggestions: (query: string) => Promise<void>
  selectSuggestion: (suggestion: Suggestion) => void
  reset: () => void
}

export const useTypeaheadStore = create<TypeaheadState>()(
  persist(
    (set, get) => ({
      // Initial state
      query: '',
      suggestions: [],
      isLoading: false,
      error: null,
      isOpen: false,
      activeIndex: -1,
      recentSearches: [],

      // Setters
      setQuery: (query) => set({ query }),
      setIsOpen: (isOpen) => set({ isOpen, activeIndex: isOpen ? -1 : get().activeIndex }),
      setActiveIndex: (activeIndex) => set({ activeIndex }),

      // Fetch suggestions
      fetchSuggestions: async (query) => {
        if (query.length < 1) {
          set({ suggestions: [], isLoading: false })
          return
        }

        set({ isLoading: true, error: null })

        try {
          const response = await fetch(
            `/api/v1/suggestions?q=${encodeURIComponent(query)}`
          )

          if (!response.ok) throw new Error('Failed to fetch')

          const data = await response.json()

          // Merge with recent searches
          const recentMatches = get().recentSearches
            .filter(s => s.toLowerCase().startsWith(query.toLowerCase()))
            .slice(0, 3)
            .map(phrase => ({
              phrase,
              source: 'recent' as const,
              score: 0
            }))

          const merged = [...recentMatches, ...data.suggestions]
            .filter((s, i, arr) =>
              arr.findIndex(x => x.phrase === s.phrase) === i
            )
            .slice(0, 8)

          set({
            suggestions: merged,
            isLoading: false,
            isOpen: true
          })
        } catch (error) {
          set({
            error: error as Error,
            isLoading: false
          })
        }
      },

      // Select suggestion
      selectSuggestion: (suggestion) => {
        const { addRecentSearch } = get()
        addRecentSearch(suggestion.phrase)
        set({
          query: suggestion.phrase,
          isOpen: false,
          activeIndex: -1
        })
      },

      // History management
      addRecentSearch: (phrase) => {
        const { recentSearches } = get()
        const filtered = recentSearches.filter(s => s !== phrase)
        set({
          recentSearches: [phrase, ...filtered].slice(0, 10)
        })
      },

      clearRecentSearches: () => set({ recentSearches: [] }),

      // Reset
      reset: () => set({
        query: '',
        suggestions: [],
        isLoading: false,
        error: null,
        isOpen: false,
        activeIndex: -1
      })
    }),
    {
      name: 'typeahead-storage',
      partialize: (state) => ({
        recentSearches: state.recentSearches
      })
    }
  )
)
```

### Using the Store in Components

```tsx
function SearchBox() {
  const {
    query,
    setQuery,
    suggestions,
    isLoading,
    isOpen,
    activeIndex,
    setIsOpen,
    setActiveIndex,
    fetchSuggestions,
    selectSuggestion
  } = useTypeaheadStore()

  // Debounced fetch
  const debouncedFetch = useMemo(
    () => debounce((q: string) => fetchSuggestions(q), 150),
    [fetchSuggestions]
  )

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setQuery(value)
    debouncedFetch(value)
  }

  return (
    <AccessibleTypeahead
      id="main-search"
      label="Search"
      value={query}
      onChange={handleChange}
      suggestions={suggestions}
      isLoading={isLoading}
      isOpen={isOpen}
      activeIndex={activeIndex}
      onOpenChange={setIsOpen}
      onActiveIndexChange={setActiveIndex}
      onSelect={selectSuggestion}
    />
  )
}
```

## Deep Dive: Performance Optimization

### Performance Metrics Tracking

```typescript
class TypeaheadMetrics {
  private observer: PerformanceObserver | null = null

  constructor() {
    this.initObserver()
  }

  private initObserver(): void {
    if (!window.PerformanceObserver) return

    this.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name.includes('/api/v1/suggestions')) {
          this.recordMetric('suggestion_request', {
            duration: entry.duration,
            size: (entry as PerformanceResourceTiming).transferSize,
            cached: (entry as PerformanceResourceTiming).transferSize === 0
          })
        }
      }
    })

    this.observer.observe({ entryTypes: ['resource'] })
  }

  recordMetric(name: string, data: Record<string, unknown>): void {
    // Send to analytics (non-blocking)
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/v1/metrics', JSON.stringify({
        name,
        ...data,
        timestamp: Date.now(),
        userAgent: navigator.userAgent,
        connection: (navigator as any).connection?.effectiveType
      }))
    }
  }

  // Track time from keypress to suggestions visible
  trackTimeToSuggestion(prefix: string): () => void {
    const start = performance.now()

    return () => {
      const duration = performance.now() - start
      this.recordMetric('time_to_suggestion', {
        prefixLength: prefix.length,
        duration,
        wasBlocking: duration > 200  // INP threshold
      })
    }
  }
}
```

### Bundle Size Optimization

```typescript
// Lazy load heavy components
const RichSuggestionItem = lazy(() => import('./RichSuggestionItem'))

// Tree-shake utilities
import { debounce } from 'lodash-es/debounce'  // Not full lodash

// Inline critical CSS, defer rest
// <link rel="preload" href="/typeahead.css" as="style" onload="this.rel='stylesheet'">
```

### Render Optimization

```tsx
// Memoize suggestion items
const SuggestionItem = memo(function SuggestionItem({
  suggestion,
  isActive,
  onSelect,
  onHover,
  query
}: SuggestionItemProps) {
  return (
    <li
      role="option"
      aria-selected={isActive}
      className={isActive ? 'active' : ''}
      onClick={() => onSelect(suggestion)}
      onMouseEnter={onHover}
    >
      <HighlightedMatch text={suggestion.phrase} query={query} />
    </li>
  )
})

// Virtualize for many suggestions
function VirtualizedSuggestions({ suggestions }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: suggestions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 3
  })

  return (
    <div ref={parentRef} style={{ maxHeight: 300, overflow: 'auto' }}>
      <ul
        role="listbox"
        style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <SuggestionItem
            key={suggestions[virtualItem.index].phrase}
            suggestion={suggestions[virtualItem.index]}
            style={{
              position: 'absolute',
              top: virtualItem.start,
              height: virtualItem.size
            }}
          />
        ))}
      </ul>
    </div>
  )
}
```

## Mobile Considerations

### Touch-Optimized Typeahead

```tsx
function MobileTypeahead() {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className={`mobile-typeahead ${isExpanded ? 'expanded' : ''}`}>
      {/* Full-screen overlay when expanded */}
      {isExpanded && (
        <div className="overlay" onClick={() => setIsExpanded(false)} />
      )}

      <div className="search-container">
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onFocus={() => setIsExpanded(true)}
        />

        {isExpanded && (
          <button
            className="cancel-btn"
            onClick={() => setIsExpanded(false)}
          >
            Cancel
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="suggestions-fullscreen">
          {/* Larger touch targets (48px min) */}
          {suggestions.map(s => (
            <button
              key={s.phrase}
              className="suggestion-row"
              onClick={() => selectSuggestion(s)}
            >
              {s.phrase}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

### Mobile CSS

```css
.mobile-typeahead.expanded {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: white;
  z-index: 1000;
}

.suggestion-row {
  min-height: 48px;  /* Touch target */
  width: 100%;
  padding: 12px 16px;
  text-align: left;
  border: none;
  border-bottom: 1px solid #e5e5e5;
  background: white;
  font-size: 16px;  /* Prevent iOS zoom */
}

/* Safe area insets for notch/home indicator */
.suggestions-fullscreen {
  padding-bottom: env(safe-area-inset-bottom);
}

.search-container {
  padding-top: env(safe-area-inset-top);
}
```

## Trade-offs Summary

| Decision | Chosen | Alternative | Reason |
|----------|--------|-------------|--------|
| Debounce timing | 150ms | 50ms / 300ms | Balance responsiveness vs. request volume |
| Cache strategy | Multi-layer | Single memory cache | Offline support + persistence |
| Prefetching | Idle-time adjacent | Aggressive all | Respect bandwidth, avoid cache pollution |
| CDN caching | Public for anonymous | Per-user everywhere | High hit rate on common prefixes |
| Offline storage | IndexedDB + Trie | LocalStorage | Larger storage, structured queries |
| Request cancellation | AbortController | No cancellation | Avoid stale responses overwriting fresh |
| State management | Zustand | Redux / Context | Simple API, minimal boilerplate |
| Accessibility | Full ARIA | Basic keyboard | WCAG compliance, screen reader support |

## Future Frontend Enhancements

1. **WebSocket Streaming**: Real-time suggestion updates as user types
2. **Voice Input**: Speech-to-text integration with typeahead
3. **Rich Previews**: Inline preview cards for selected suggestions
4. **Gesture Navigation**: Swipe to delete recent searches
5. **Haptic Feedback**: Vibration on suggestion selection (mobile)
6. **Smart Prefetch**: ML-based prediction of next prefix
7. **Theme Support**: Dark mode with smooth transitions
8. **Internationalization**: RTL support, locale-specific sorting
