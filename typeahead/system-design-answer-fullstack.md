# Typeahead - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## Problem Statement

Design an end-to-end typeahead/autocomplete system that:
- Provides instant search suggestions as users type (sub-50ms perceived latency)
- Integrates frontend caching layers with backend trie serving
- Implements real-time aggregation pipeline for trending topics
- Balances popularity, personalization, and trending in ranking
- Handles 100K+ QPS with graceful degradation

## Requirements Clarification

### Functional Requirements
1. **Suggest**: Return top suggestions for any prefix
2. **Rank**: Multi-factor scoring (popularity, recency, personalization, trending)
3. **Cache**: Multi-layer caching from browser to CDN to origin
4. **Update**: Surface trending topics within 5 minutes
5. **Offline**: Work without network using cached data

### Non-Functional Requirements
1. **Latency**: < 50ms P99 end-to-end
2. **Availability**: 99.99%
3. **Scale**: 100K+ QPS
4. **Cache Hit Rate**: > 80% at CDN level
5. **Freshness**: Trending within 5 minutes

### Scale Estimates
- Unique queries in index: 1 billion
- Peak QPS: 100,000+
- Keystrokes per session: 50-100
- API calls per session: 10-20 (with frontend caching)

## High-Level Architecture

```
+------------------------------------------------------------------------+
|                              CLIENT                                     |
+------------------------------------------------------------------------+
|  +----------------+  +----------------+  +-------------------+          |
|  | Search Box     |  | Command Palette|  | Rich Typeahead    |          |
|  +-------+--------+  +-------+--------+  +--------+----------+          |
|          |                   |                    |                     |
|          +-------------------+--------------------+                     |
|                              |                                          |
|                              v                                          |
|  +------------------------------------------------------------------+  |
|  |                  Typeahead Core Module                            |  |
|  |  Request Manager | Cache Coordinator | Source Merger | Ranking    |  |
|  +------------------------------------------------------------------+  |
|          |                   |                    |                     |
|          v                   v                    v                     |
|  +----------------+  +----------------+  +-------------------+          |
|  | Memory Cache   |  | Service Worker |  | IndexedDB         |          |
|  | (0ms, 500 items)|  | (1-5ms, SW-R)  |  | (5-20ms, offline) |          |
|  +----------------+  +----------------+  +-------------------+          |
+------------------------------------------------------------------------+
                               |
                               v
+------------------------------------------------------------------------+
|                           NETWORK                                       |
+------------------------------------------------------------------------+
|  CDN Edge (10-50ms) --> API Gateway --> Load Balancer                  |
+------------------------------------------------------------------------+
                               |
                               v
+------------------------------------------------------------------------+
|                           BACKEND                                       |
+------------------------------------------------------------------------+
|  +------------------------------------------------------------------+  |
|  |                    Suggestion Service                             |  |
|  |           Prefix Matching | Ranking | Personalization             |  |
|  +------------------------------------------------------------------+  |
|          |                   |                    |                     |
|          v                   v                    v                     |
|  +----------------+  +----------------+  +-------------------+          |
|  | Trie Servers   |  | Ranking Service|  | User Data Store   |          |
|  | (Sharded)      |  | (Real-time)    |  | (Redis)           |          |
|  +----------------+  +----------------+  +-------------------+          |
|                              |                                          |
|                              v                                          |
|  +------------------------------------------------------------------+  |
|  |                   Aggregation Pipeline                            |  |
|  |        Query Logs --> Kafka --> Filter --> Count --> Trie        |  |
|  +------------------------------------------------------------------+  |
+------------------------------------------------------------------------+
```

## Deep Dive: API Contract

The API contract is the critical integration point between frontend and backend.

### TypeScript Interfaces (Shared)

```typescript
// shared/types.ts - Used by both frontend and backend

interface Suggestion {
  phrase: string
  score: number
  count?: number
  source?: 'api' | 'recent' | 'trending' | 'personal'
  trending?: boolean
  category?: string
  metadata?: Record<string, unknown>
}

interface SuggestionRequest {
  q: string                    // Prefix query
  limit?: number               // Max suggestions (default: 8)
  userId?: string              // For personalization
  includeMetadata?: boolean    // Return extra fields
}

interface SuggestionResponse {
  suggestions: Suggestion[]
  cached: boolean              // Was this served from cache?
  latencyMs: number            // Server-side processing time
  requestId: string            // For debugging/tracing
}

interface TrendingResponse {
  queries: Array<{
    phrase: string
    velocity: number           // Rate of increase
    count: number
  }>
  windowMinutes: number        // Time window for trending calculation
}

interface UserHistoryEntry {
  phrase: string
  count: number
  lastSearched: Date
}
```

### REST API Endpoints

```typescript
// Backend routes
const routes = {
  // Core suggestion endpoint
  'GET /api/v1/suggestions': {
    query: { q: string, limit?: number, userId?: string },
    response: SuggestionResponse,
    caching: 'public, max-age=60, stale-while-revalidate=300'
  },

  // Log completed search (for aggregation)
  'POST /api/v1/suggestions/log': {
    body: { query: string, userId?: string, sessionId: string },
    response: { success: boolean }
  },

  // Get trending queries
  'GET /api/v1/suggestions/trending': {
    response: TrendingResponse,
    caching: 'public, max-age=30'
  },

  // Get user history
  'GET /api/v1/suggestions/history': {
    headers: { Authorization: 'Bearer {token}' },
    response: { history: UserHistoryEntry[] }
  },

  // Popular data bundle (for offline sync)
  'GET /api/v1/suggestions/popular-data': {
    response: {
      prefixes: Record<string, Suggestion[]>,
      trie?: SerializedTrie,
      lastUpdated: string
    },
    caching: 'public, max-age=3600'
  },

  // Admin endpoints
  'GET /api/v1/admin/trie/stats': {
    response: { nodeCount: number, phraseCount: number, shardStats: object[] }
  },
  'POST /api/v1/admin/trie/rebuild': {
    response: { jobId: string, status: string }
  },
  'POST /api/v1/admin/filter': {
    body: { phrase: string, reason: string },
    response: { success: boolean }
  }
}
```

### Request/Response Flow

```
Frontend Request:
GET /api/v1/suggestions?q=weat&limit=5&userId=abc123
Headers:
  Accept: application/json
  X-Request-ID: req_123456
  X-Client-Version: 1.0.0

Backend Response:
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: public, max-age=60, stale-while-revalidate=300
ETag: "a1b2c3d4"
X-Cache-Status: MISS
X-Response-Time: 12ms

{
  "suggestions": [
    { "phrase": "weather forecast", "score": 0.95 },
    { "phrase": "weather today", "score": 0.92 },
    { "phrase": "weather radar", "score": 0.88 },
    { "phrase": "weather alert", "score": 0.85, "trending": true },
    { "phrase": "weather seattle", "score": 0.82 }
  ],
  "cached": false,
  "latencyMs": 12,
  "requestId": "req_123456"
}
```

## Deep Dive: Backend Trie with Pre-computed Top-K

### Trie Data Structure

```typescript
class TrieNode {
  children: Map<string, TrieNode> = new Map()
  isEndOfWord: boolean = false
  suggestions: Array<{ phrase: string; count: number }> = []
  count: number = 0
}

class Trie {
  private root: TrieNode = new TrieNode()
  private topK: number

  constructor(topK = 10) {
    this.topK = topK
  }

  insert(phrase: string, count: number): void {
    let node = this.root

    for (const char of phrase.toLowerCase()) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode())
      }
      node = node.children.get(char)!

      // Update top-k suggestions at each prefix node
      this.updateSuggestions(node, phrase, count)
    }

    node.isEndOfWord = true
    node.count = count
  }

  private updateSuggestions(node: TrieNode, phrase: string, count: number): void {
    const existing = node.suggestions.find(s => s.phrase === phrase)
    if (existing) {
      existing.count = count
    } else {
      node.suggestions.push({ phrase, count })
    }

    // Sort and keep top-k
    node.suggestions.sort((a, b) => b.count - a.count)
    if (node.suggestions.length > this.topK) {
      node.suggestions = node.suggestions.slice(0, this.topK)
    }
  }

  getSuggestions(prefix: string): Array<{ phrase: string; count: number }> {
    let node = this.root

    for (const char of prefix.toLowerCase()) {
      if (!node.children.has(char)) {
        return []
      }
      node = node.children.get(char)!
    }

    return node.suggestions
  }

  // Serialization for offline sync
  serialize(): string {
    return JSON.stringify(this.serializeNode(this.root))
  }

  private serializeNode(node: TrieNode): object {
    const children: Record<string, object> = {}
    for (const [char, child] of node.children) {
      children[char] = this.serializeNode(child)
    }
    return {
      c: children,
      e: node.isEndOfWord,
      s: node.suggestions,
      n: node.count
    }
  }

  static deserialize(data: string): Trie {
    const trie = new Trie()
    trie.root = Trie.deserializeNode(JSON.parse(data))
    return trie
  }
}
```

### Sharding Strategy

```typescript
class TrieServer {
  private shardId: number
  private totalShards: number
  private trie: Trie

  constructor(shardId: number, totalShards: number) {
    this.shardId = shardId
    this.totalShards = totalShards
    this.trie = new Trie()
  }

  // Route by first character for prefix locality
  static getShardForPrefix(prefix: string, totalShards: number): number {
    const firstChar = prefix.charAt(0).toLowerCase()
    return firstChar.charCodeAt(0) % totalShards
  }
}

// Handle hot spots with sub-sharding
const shardMap: Record<string, string[]> = {
  'a': ['a-shard-1', 'a-shard-2', 'a-shard-3'],  // 'a' is hot
  'b': ['b-shard-1'],
  's': ['s-shard-1', 's-shard-2'],  // 's' is hot
}

function getShard(prefix: string): string {
  const firstChar = prefix.charAt(0).toLowerCase()
  const shards = shardMap[firstChar] || ['default-shard']

  if (shards.length === 1) return shards[0]

  // Use second character for sub-shard routing
  const secondChar = prefix.charAt(1) || 'a'
  return shards[secondChar.charCodeAt(0) % shards.length]
}
```

## Deep Dive: Multi-Factor Ranking

### Ranking Service (Backend)

```typescript
class RankingService {
  async rank(suggestions: Suggestion[], context: RankingContext): Promise<Suggestion[]> {
    const { userId, prefix } = context

    const scored = await Promise.all(
      suggestions.map(async suggestion => {
        // Base popularity score (logarithmic scaling)
        const popularityScore = Math.log10(suggestion.count + 1) / 10

        // Recency score (exponential decay)
        const recencyScore = this.calculateRecency(suggestion.lastUpdated)

        // Personalization score
        let personalScore = 0
        if (userId) {
          personalScore = await this.getPersonalScore(userId, suggestion.phrase)
        }

        // Trending boost
        const trendingBoost = await this.getTrendingBoost(suggestion.phrase)

        // Prefix match quality
        const matchQuality = this.calculateMatchQuality(prefix, suggestion.phrase)

        // Combine with weights
        const finalScore =
          popularityScore * 0.30 +
          recencyScore * 0.15 +
          personalScore * 0.25 +
          trendingBoost * 0.20 +
          matchQuality * 0.10

        return { ...suggestion, score: finalScore }
      })
    )

    return scored.sort((a, b) => b.score - a.score)
  }

  private calculateRecency(lastUpdated: Date): number {
    const ageInHours = (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60)
    // Exponential decay with 1-week half-life
    return Math.exp(-ageInHours / 168)
  }

  private async getPersonalScore(userId: string, phrase: string): Promise<number> {
    const userHistory = await redis.get(`user_history:${userId}`)
    if (!userHistory) return 0

    const history = JSON.parse(userHistory)
    const match = history.find((h: any) => h.phrase === phrase)

    if (match) {
      const daysSince = (Date.now() - match.timestamp) / (1000 * 60 * 60 * 24)
      return Math.exp(-daysSince / 30) // 30-day half-life
    }

    return 0
  }

  private async getTrendingBoost(phrase: string): Promise<number> {
    const trending = await redis.zscore('trending_queries', phrase)
    if (!trending) return 0
    return Math.min(Number(trending) / 1000, 1.0)
  }

  private calculateMatchQuality(prefix: string, phrase: string): number {
    const lowerPrefix = prefix.toLowerCase()
    const lowerPhrase = phrase.toLowerCase()

    if (lowerPhrase.startsWith(lowerPrefix)) return 1.0
    if (lowerPhrase.includes(' ' + lowerPrefix)) return 0.8
    if (lowerPhrase.includes(lowerPrefix)) return 0.5
    return 0
  }
}
```

### Frontend Re-ranking (Client-side Personalization)

```typescript
class ClientRanker {
  private recentSearches: string[]
  private frequentSearches: Map<string, number>

  constructor(history: UserHistoryEntry[]) {
    this.recentSearches = history
      .sort((a, b) => b.lastSearched.getTime() - a.lastSearched.getTime())
      .slice(0, 50)
      .map(h => h.phrase)

    this.frequentSearches = new Map(
      history.map(h => [h.phrase, h.count])
    )
  }

  rerank(suggestions: Suggestion[]): Suggestion[] {
    return suggestions
      .map(s => {
        let boost = 0

        // Boost recent searches
        const recencyIndex = this.recentSearches.indexOf(s.phrase)
        if (recencyIndex !== -1) {
          boost += (50 - recencyIndex) / 100 // 0.01 to 0.5
        }

        // Boost frequent searches
        const frequency = this.frequentSearches.get(s.phrase) || 0
        if (frequency > 0) {
          boost += Math.min(frequency / 20, 0.3) // Up to 0.3
        }

        return { ...s, score: s.score + boost }
      })
      .sort((a, b) => b.score - a.score)
  }
}
```

## Deep Dive: Real-Time Aggregation Pipeline

### Query Log Processing (Backend)

```typescript
class AggregationPipeline {
  private buffer: Map<string, number> = new Map()
  private flushInterval = 60000 // 1 minute

  async start(): Promise<void> {
    // Subscribe to query log stream
    await kafka.subscribe('query_logs', async (message) => {
      await this.processQuery(message)
    })

    // Periodic flush to trie servers
    setInterval(() => this.flush(), this.flushInterval)
  }

  async processQuery(message: string): Promise<void> {
    const { query, timestamp, userId } = JSON.parse(message)

    // Filter inappropriate content
    if (await this.isInappropriate(query)) return

    // Filter low-quality queries
    if (this.isLowQuality(query)) return

    // Increment buffer count
    const current = this.buffer.get(query) || 0
    this.buffer.set(query, current + 1)

    // Update trending counters
    await this.updateTrending(query, timestamp)
  }

  private isLowQuality(query: string): boolean {
    if (query.length < 2) return true
    if (query.length > 100) return true
    if (/^\d+$/.test(query)) return true
    if (/^[asdfghjklqwertyuiopzxcvbnm]{10,}$/i.test(query)) return true
    return false
  }

  private async updateTrending(query: string, timestamp: number): Promise<void> {
    // Sliding window counter (5-minute windows)
    const windowKey = `trending_window:${Math.floor(timestamp / 300000)}`

    await redis.zincrby(windowKey, 1, query)
    await redis.expire(windowKey, 3600)

    // Periodically aggregate for trending
    if (Math.random() < 0.01) { // Sample 1%
      await this.aggregateTrending()
    }
  }

  private async aggregateTrending(): Promise<void> {
    const recentWindows: string[] = []
    const now = Date.now()

    for (let i = 0; i < 12; i++) { // Last hour (12 x 5-min windows)
      recentWindows.push(`trending_window:${Math.floor((now - i * 300000) / 300000)}`)
    }

    await redis.zunionstore('trending_queries', recentWindows.length, ...recentWindows)
  }

  private async flush(): Promise<void> {
    if (this.buffer.size === 0) return

    const updates = Array.from(this.buffer.entries())
    this.buffer.clear()

    // Group by shard and send updates
    const shardUpdates = new Map<number, Array<{ phrase: string; count: number }>>()

    for (const [phrase, count] of updates) {
      const shardId = TrieServer.getShardForPrefix(phrase, this.shardCount)
      if (!shardUpdates.has(shardId)) {
        shardUpdates.set(shardId, [])
      }
      shardUpdates.get(shardId)!.push({ phrase, count })
    }

    for (const [shardId, phraseUpdates] of shardUpdates) {
      await this.sendUpdates(shardId, phraseUpdates)
    }
  }
}
```

### Frontend: Logging Searches

```typescript
// Log completed search when user selects a suggestion
async function logSearch(phrase: string, sessionId: string): Promise<void> {
  // Non-blocking beacon
  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      '/api/v1/suggestions/log',
      JSON.stringify({ query: phrase, sessionId })
    )
  } else {
    // Fallback to fetch with keepalive
    fetch('/api/v1/suggestions/log', {
      method: 'POST',
      body: JSON.stringify({ query: phrase, sessionId }),
      keepalive: true
    }).catch(() => {}) // Ignore failures
  }
}
```

## Deep Dive: Caching Integration

### Backend Cache Headers

```typescript
// Express middleware for cache headers
app.get('/api/v1/suggestions', async (req, res) => {
  const prefix = req.query.q as string
  const userId = req.userId // From auth middleware

  // Determine cacheability
  const isPersonalized = userId && await hasUserHistory(userId)

  if (isPersonalized) {
    // Private cache for personalized responses
    res.setHeader('Cache-Control', 'private, max-age=0')
    res.setHeader('Vary', 'Cookie, Authorization')
  } else {
    // Public cache for anonymous responses
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
    res.setHeader('Vary', 'Accept-Encoding')
    res.setHeader('Surrogate-Control', 'max-age=120') // CDN-specific
  }

  // ETag for conditional requests
  const suggestions = await getSuggestions(prefix, userId)
  const etag = generateETag(prefix, suggestions)
  res.setHeader('ETag', etag)

  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end()
  }

  res.json({
    suggestions,
    cached: false,
    latencyMs: Date.now() - req.startTime,
    requestId: req.headers['x-request-id']
  })
})
```

### Frontend Cache Coordination

```typescript
class CacheCoordinator {
  private memoryCache: Map<string, { data: Suggestion[]; timestamp: number }> = new Map()
  private serviceWorkerReady: Promise<boolean>
  private indexedDB: OfflineTypeahead

  constructor() {
    this.serviceWorkerReady = this.initServiceWorker()
    this.indexedDB = new OfflineTypeahead()
  }

  async get(prefix: string): Promise<Suggestion[] | null> {
    // Layer 1: Memory cache (0ms)
    const memCached = this.memoryCache.get(prefix)
    if (memCached && Date.now() - memCached.timestamp < 60000) {
      return memCached.data
    }

    // Layer 2: Service Worker handles network/cache
    // (Transparent - just make fetch request)

    // Layer 3: IndexedDB for offline
    if (!navigator.onLine) {
      return await this.indexedDB.getSuggestions(prefix)
    }

    return null // Cache miss - proceed to network
  }

  set(prefix: string, suggestions: Suggestion[]): void {
    // Update memory cache
    this.memoryCache.set(prefix, {
      data: suggestions,
      timestamp: Date.now()
    })

    // Prune old entries (LRU-style)
    if (this.memoryCache.size > 500) {
      const oldest = [...this.memoryCache.entries()]
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 100)

      for (const [key] of oldest) {
        this.memoryCache.delete(key)
      }
    }

    // Also cache prefix substrings (for backspace)
    for (let i = prefix.length - 1; i >= 1; i--) {
      const subPrefix = prefix.substring(0, i)
      if (!this.memoryCache.has(subPrefix)) {
        const subData = suggestions.filter(s =>
          s.phrase.toLowerCase().startsWith(subPrefix.toLowerCase())
        )
        if (subData.length > 0) {
          this.memoryCache.set(subPrefix, {
            data: subData,
            timestamp: Date.now()
          })
        }
      }
    }
  }
}
```

## Deep Dive: Error Handling and Graceful Degradation

### Backend Circuit Breaker

```typescript
class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED'
  private failures = 0
  private lastFailureTime = 0
  private readonly failureThreshold: number
  private readonly resetTimeoutMs: number

  constructor(options: { failureThreshold?: number; resetTimeoutMs?: number } = {}) {
    this.failureThreshold = options.failureThreshold || 5
    this.resetTimeoutMs = options.resetTimeoutMs || 30000
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = 'HALF_OPEN'
      } else {
        throw new CircuitOpenError('Circuit is OPEN')
      }
    }

    try {
      const result = await operation()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  private onSuccess(): void {
    this.failures = 0
    this.state = 'CLOSED'
  }

  private onFailure(): void {
    this.failures++
    this.lastFailureTime = Date.now()
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN'
    }
  }
}

// Usage in suggestion service
class SuggestionService {
  private trieCircuit = new CircuitBreaker({ failureThreshold: 3 })
  private rankingCircuit = new CircuitBreaker({ failureThreshold: 5 })

  async getSuggestions(prefix: string, userId?: string): Promise<Suggestion[]> {
    try {
      // Primary path
      const rawSuggestions = await this.trieCircuit.execute(() =>
        this.queryTrie(prefix)
      )

      const ranked = await this.rankingCircuit.execute(() =>
        this.rankSuggestions(rawSuggestions, { prefix, userId })
      )

      return ranked
    } catch (error) {
      // Fallback path
      return this.getFallbackSuggestions(prefix)
    }
  }

  private async getFallbackSuggestions(prefix: string): Promise<Suggestion[]> {
    // Try stale cache
    const staleCache = await redis.get(`suggestions:stale:${prefix}`)
    if (staleCache) {
      return JSON.parse(staleCache)
    }

    // Return popular suggestions for this prefix character
    return this.getPopularByPrefix(prefix.charAt(0))
  }
}
```

### Frontend Graceful Degradation

```typescript
class TypeaheadWithFallbacks {
  private online = navigator.onLine
  private apiHealthy = true

  constructor() {
    window.addEventListener('online', () => this.online = true)
    window.addEventListener('offline', () => this.online = false)
  }

  async getSuggestions(prefix: string): Promise<Suggestion[]> {
    // Check network status
    if (!this.online) {
      return this.getOfflineSuggestions(prefix)
    }

    try {
      const response = await this.fetchWithTimeout(
        `/api/v1/suggestions?q=${encodeURIComponent(prefix)}`,
        { timeout: 3000 }
      )

      this.apiHealthy = true
      const data = await response.json()
      return data.suggestions

    } catch (error) {
      this.apiHealthy = false

      // Fallback 1: Stale cache
      const stale = await this.getStaleCache(prefix)
      if (stale) return stale

      // Fallback 2: Local history matching
      const history = await this.getHistoryMatches(prefix)
      if (history.length > 0) return history

      // Fallback 3: Empty state
      return []
    }
  }

  private async fetchWithTimeout(
    url: string,
    options: { timeout: number }
  ): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), options.timeout)

    try {
      const response = await fetch(url, { signal: controller.signal })
      clearTimeout(timeoutId)
      return response
    } catch (error) {
      clearTimeout(timeoutId)
      throw error
    }
  }

  private async getOfflineSuggestions(prefix: string): Promise<Suggestion[]> {
    // IndexedDB offline trie
    const offline = new OfflineTypeahead()
    return offline.getSuggestions(prefix)
  }
}
```

## Database Schema

```sql
-- Phrase counts (aggregated from query logs)
CREATE TABLE phrase_counts (
  phrase VARCHAR(200) PRIMARY KEY,
  count BIGINT DEFAULT 0,
  last_updated TIMESTAMP DEFAULT NOW(),
  is_filtered BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_phrase_count ON phrase_counts(count DESC);
CREATE INDEX idx_phrase_updated ON phrase_counts(last_updated DESC);

-- Query logs (raw, for aggregation pipeline)
CREATE TABLE query_logs (
  id BIGSERIAL PRIMARY KEY,
  query VARCHAR(200) NOT NULL,
  user_id UUID,
  session_id VARCHAR(100),
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_query_logs_time ON query_logs(timestamp);
CREATE INDEX idx_query_logs_user ON query_logs(user_id, timestamp);

-- User search history (for personalization)
CREATE TABLE user_history (
  user_id UUID NOT NULL,
  phrase VARCHAR(200) NOT NULL,
  count INTEGER DEFAULT 1,
  last_searched TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, phrase)
);

CREATE INDEX idx_user_history_recent ON user_history(user_id, last_searched DESC);

-- Filtered/blocked phrases
CREATE TABLE filtered_phrases (
  phrase VARCHAR(200) PRIMARY KEY,
  reason VARCHAR(50),
  added_at TIMESTAMP DEFAULT NOW(),
  added_by VARCHAR(100)
);
```

## Observability

### Backend Metrics (Prometheus)

```typescript
const metrics = {
  // Request latency
  suggestionLatency: new promClient.Histogram({
    name: 'typeahead_suggestion_latency_seconds',
    help: 'Latency of suggestion requests',
    labelNames: ['endpoint', 'cache_hit', 'personalized'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5]
  }),

  // Cache hit rate
  cacheHitRate: new promClient.Gauge({
    name: 'typeahead_cache_hit_rate',
    help: 'Cache hit rate (0-1)',
    labelNames: ['cache_type']
  }),

  // Trie stats
  trieNodeCount: new promClient.Gauge({
    name: 'typeahead_trie_node_count',
    help: 'Number of nodes in trie',
    labelNames: ['shard_id']
  }),

  // Circuit breaker state
  circuitState: new promClient.Gauge({
    name: 'typeahead_circuit_state',
    help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
    labelNames: ['circuit_name']
  }),

  // Kafka lag
  kafkaLag: new promClient.Gauge({
    name: 'typeahead_kafka_consumer_lag',
    help: 'Kafka consumer lag',
    labelNames: ['partition']
  })
}
```

### Frontend Metrics

```typescript
class FrontendMetrics {
  private observer: PerformanceObserver | null = null

  constructor() {
    this.initResourceObserver()
  }

  private initResourceObserver(): void {
    if (!window.PerformanceObserver) return

    this.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name.includes('/api/v1/suggestions')) {
          this.send('suggestion_request', {
            duration: entry.duration,
            transferSize: (entry as PerformanceResourceTiming).transferSize,
            cached: (entry as PerformanceResourceTiming).transferSize === 0
          })
        }
      }
    })

    this.observer.observe({ entryTypes: ['resource'] })
  }

  trackTimeToSuggestion(prefix: string): () => void {
    const start = performance.now()

    return () => {
      const duration = performance.now() - start
      this.send('time_to_suggestion', {
        prefixLength: prefix.length,
        duration,
        wasBlocking: duration > 200
      })
    }
  }

  send(name: string, data: Record<string, unknown>): void {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/v1/metrics', JSON.stringify({
        name,
        ...data,
        timestamp: Date.now(),
        connection: (navigator as any).connection?.effectiveType
      }))
    }
  }
}
```

### Alert Thresholds

```yaml
alerts:
  - name: TypeaheadHighLatency
    expr: histogram_quantile(0.99, rate(typeahead_suggestion_latency_seconds_bucket[5m])) > 0.05
    severity: warning
    annotations:
      summary: "Typeahead P99 latency above 50ms"

  - name: TypeaheadLowCacheHitRate
    expr: typeahead_cache_hit_rate{cache_type="cdn"} < 0.7
    severity: warning
    annotations:
      summary: "CDN cache hit rate below 70%"

  - name: TypeaheadCircuitOpen
    expr: typeahead_circuit_state > 1
    severity: critical
    annotations:
      summary: "Circuit breaker is OPEN"

  - name: TypeaheadKafkaLagHigh
    expr: sum(typeahead_kafka_consumer_lag) > 50000
    severity: warning
    annotations:
      summary: "Kafka consumer lag exceeds 50K messages"
```

## End-to-End Request Flow

```
1. User types "wea" in search box
   |
   v
2. Frontend: Debounce timer starts (150ms)
   |
   v
3. Frontend: Check memory cache -> MISS
   |
   v
4. Frontend: Debounce expires, create fetch request
   |
   v
5. Service Worker: Intercept request
   | - Check SW cache -> MISS
   | - Forward to network
   |
   v
6. CDN Edge: Check edge cache
   | - Cache key: /api/v1/suggestions?q=wea
   | - MISS -> Forward to origin
   |
   v
7. Load Balancer: Route to suggestion service
   |
   v
8. Backend: Redis cache check -> MISS
   |
   v
9. Backend: Query trie shard for "wea"
   | - Get shard: 'w' -> shard-23
   | - Lookup prefix -> ["weather", "wealth", "weapon", ...]
   |
   v
10. Backend: Apply ranking
    | - Popularity (30%), Recency (15%), Personal (25%), Trending (20%), Match (10%)
    | - Sort by final score
    |
    v
11. Backend: Store in Redis cache (60s TTL)
    |
    v
12. Response flows back through CDN (cached) -> SW (cached) -> Frontend
    |
    v
13. Frontend: Update memory cache
    | - Also cache "we" and "w" subsets
    |
    v
14. Frontend: Render suggestions in dropdown
    | - Apply ARIA attributes
    | - Highlight matching prefix
    |
    v
15. User selects "weather forecast"
    |
    v
16. Frontend: Log search via sendBeacon
    |
    v
17. Backend: Query log -> Kafka -> Aggregation Pipeline
    |
    v
18. Aggregation: Update phrase count + trending window
```

## Trade-offs Summary

| Decision | Pros | Cons | Alternative |
|----------|------|------|-------------|
| Pre-computed top-k | O(1) lookup | Higher memory, update cost | On-demand traversal |
| First-char sharding | Prefix locality | Uneven distribution | Consistent hashing |
| Weighted ranking | Simple, explainable | Less adaptive | ML-based LTR |
| 60s cache TTL | Low latency | Slight staleness | Write-through |
| Multi-layer caching | Offline support, resilience | Complexity | Single cache layer |
| Debounce 150ms | Fewer requests | Slight delay | Throttle |
| Kafka aggregation | Scalable ingestion | Eventual consistency | Direct DB writes |
| Service Worker | Offline, stale-WR | Browser support | No SW |

## Future Full-Stack Enhancements

1. **WebSocket Streaming**: Real-time suggestion updates as backend data changes
2. **Fuzzy Matching**: Edit-distance tolerant matching for typos
3. **ML-Based Ranking**: Learning-to-rank with user feedback
4. **Geo-Sharding**: Region-specific suggestions
5. **A/B Testing Framework**: Experiment with ranking weights
6. **GraphQL API**: More flexible querying for rich suggestions
7. **Push Notifications**: Alert users when trending topics match interests
8. **Voice Integration**: Speech-to-text with typeahead
