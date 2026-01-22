# Typeahead - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Problem Statement

Design the backend infrastructure for a typeahead/autocomplete system that:
- Provides instant search suggestions as users type
- Achieves sub-50ms latency for prefix matching across billions of queries
- Balances popularity, personalization, and trending topics in ranking
- Handles 100K+ QPS with high availability

## Requirements Clarification

### Functional Requirements
1. **Suggest**: Return top suggestions for any prefix
2. **Rank**: Order by relevance (popularity, recency, personalization)
3. **Personalize**: User-specific suggestion boosting
4. **Update**: Reflect trending topics in near real-time
5. **Filter**: Remove inappropriate or blocked content

### Non-Functional Requirements
1. **Latency**: < 50ms P99
2. **Availability**: 99.99%
3. **Scale**: 100K+ QPS
4. **Freshness**: Trending within 5 minutes

### Scale Estimates
- Unique queries: 1 billion
- QPS at peak: 100,000+
- Suggestions per request: 5-10
- Index update frequency: Every minute

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Client Layer                                │
│              Search Box | Mobile App | API                      │
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
│          Query Logs → Count → Filter → Trie Build              │
└─────────────────────────────────────────────────────────────────┘
```

## Deep Dive: Trie with Pre-computed Top-K

This is the key data structure enabling sub-50ms latency.

### Trie Implementation

```javascript
class TrieNode {
  constructor() {
    this.children = new Map();   // Character -> TrieNode
    this.isEndOfWord = false;
    this.suggestions = [];        // Pre-computed top-k at this prefix
    this.count = 0;
  }
}

class Trie {
  constructor(topK = 10) {
    this.root = new TrieNode();
    this.topK = topK;
  }

  insert(phrase, count) {
    let node = this.root;

    for (const char of phrase.toLowerCase()) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode());
      }
      node = node.children.get(char);

      // Update top-k suggestions at each prefix node
      this.updateSuggestions(node, phrase, count);
    }

    node.isEndOfWord = true;
    node.count = count;
  }

  updateSuggestions(node, phrase, count) {
    // Add or update this phrase in suggestions
    const existing = node.suggestions.find(s => s.phrase === phrase);
    if (existing) {
      existing.count = count;
    } else {
      node.suggestions.push({ phrase, count });
    }

    // Sort and keep top-k
    node.suggestions.sort((a, b) => b.count - a.count);
    if (node.suggestions.length > this.topK) {
      node.suggestions = node.suggestions.slice(0, this.topK);
    }
  }

  getSuggestions(prefix) {
    let node = this.root;

    for (const char of prefix.toLowerCase()) {
      if (!node.children.has(char)) {
        return []; // No matches for this prefix
      }
      node = node.children.get(char);
    }

    return node.suggestions;
  }
}
```

### Why Pre-compute Top-K?

| Approach | Query Time | Space | Update Cost |
|----------|------------|-------|-------------|
| Traverse subtree | O(subtree size) | Low | O(1) |
| Pre-computed top-k | O(prefix length) | Higher | O(k log k) |

**Trade-off**: We use more memory to store top-k at each node, but queries are O(prefix_length) instead of O(subtree). For 100K QPS, this is essential.

### Data Structure Alternatives

| Data Structure | Prefix Lookup | Memory | Update Cost | Fuzzy Support | Best For |
|----------------|---------------|--------|-------------|---------------|----------|
| **Trie** | O(prefix_len) | High | O(k log k) | No | Exact prefix matching |
| **Radix Trie** | O(prefix_len) | Medium | O(k log k) | No | Memory-constrained prefix |
| **DAWG** | O(prefix_len) | Low | Expensive rebuild | No | Static datasets |
| **Inverted Index** | O(1) hash + scan | Medium | O(1) | Yes | Full-text search |
| **Elasticsearch** | O(1) | High | Near real-time | Yes | Complex queries |

**Decision**: Trie with pre-computed top-k provides optimal prefix lookup time.

## Deep Dive: Sharding Strategy

```javascript
class TrieServer {
  constructor(shardId, totalShards) {
    this.shardId = shardId;
    this.totalShards = totalShards;
    this.trie = new Trie();
  }

  // Route by first character for prefix locality
  static getShardForPrefix(prefix, totalShards) {
    const firstChar = prefix.charAt(0).toLowerCase();
    return firstChar.charCodeAt(0) % totalShards;
  }
}

class SuggestionService {
  async getSuggestions(prefix, options = {}) {
    // Route to correct shard
    const shardId = TrieServer.getShardForPrefix(prefix, this.shards.length);
    const shardAddress = this.shards[shardId];

    // Check cache first
    const cacheKey = `suggestions:${prefix}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // Query shard
    const suggestions = await this.queryShard(shardAddress, prefix);

    // Cache with short TTL (60 seconds)
    await redis.setex(cacheKey, 60, JSON.stringify(suggestions));

    return suggestions;
  }
}
```

### Sharding Strategy Comparison

| Strategy | Locality | Distribution | Routing | Hot Spots |
|----------|----------|--------------|---------|-----------|
| **First character** | Excellent | Uneven (s > x) | Simple | Yes ('s', 't', 'a') |
| **First 2 chars** | Good | Better | Simple | Fewer |
| **Consistent hashing** | None | Even | Hash lookup | No |
| **Range-based** | Good | Configurable | Range lookup | Tunable |

**Decision**: First character sharding preserves prefix locality (queries for "app" and "apple" go to same shard).

### Handling Hot Spots

```javascript
// Split hot shards into sub-shards
const shardMap = {
  'a': ['a-shard-1', 'a-shard-2', 'a-shard-3'],  // 'a' is hot, use 3 sub-shards
  'b': ['b-shard-1'],
  's': ['s-shard-1', 's-shard-2'],  // 's' is hot
};

function getShard(prefix) {
  const firstChar = prefix.charAt(0).toLowerCase();
  const shards = shardMap[firstChar] || ['default-shard'];

  if (shards.length === 1) return shards[0];

  // Use second character for sub-shard routing
  const secondChar = prefix.charAt(1) || 'a';
  return shards[secondChar.charCodeAt(0) % shards.length];
}
```

## Deep Dive: Multi-Factor Ranking

```javascript
class RankingService {
  async rank(suggestions, context) {
    const { userId, prefix } = context;

    const scored = await Promise.all(
      suggestions.map(async suggestion => {
        // Base popularity score (logarithmic scaling)
        const popularityScore = Math.log10(suggestion.count + 1);

        // Recency score (decay older queries)
        const recencyScore = this.calculateRecency(suggestion.lastUpdated);

        // Personalization score
        let personalScore = 0;
        if (userId) {
          personalScore = await this.getPersonalScore(userId, suggestion.phrase);
        }

        // Trending boost
        const trendingBoost = await this.getTrendingBoost(suggestion.phrase);

        // Prefix match quality
        const matchQuality = this.calculateMatchQuality(prefix, suggestion.phrase);

        // Combine with weights
        const finalScore =
          popularityScore * 0.30 +
          recencyScore * 0.15 +
          personalScore * 0.25 +
          trendingBoost * 0.20 +
          matchQuality * 0.10;

        return { ...suggestion, score: finalScore };
      })
    );

    return scored.sort((a, b) => b.score - a.score);
  }

  calculateRecency(lastUpdated) {
    const ageInHours = (Date.now() - lastUpdated) / (1000 * 60 * 60);
    // Exponential decay with 1-week half-life
    return Math.exp(-ageInHours / 168);
  }

  async getPersonalScore(userId, phrase) {
    const userHistory = await redis.get(`user_history:${userId}`);
    if (!userHistory) return 0;

    const history = JSON.parse(userHistory);
    const match = history.find(h => h.phrase === phrase);

    if (match) {
      // Decay personal relevance over time
      const daysSince = (Date.now() - match.timestamp) / (1000 * 60 * 60 * 24);
      return Math.exp(-daysSince / 30); // 30-day half-life
    }

    return 0;
  }

  async getTrendingBoost(phrase) {
    const trending = await redis.zscore('trending_queries', phrase);
    if (!trending) return 0;
    return Math.min(trending / 1000, 1.0);
  }
}
```

### Ranking Algorithm Alternatives

| Approach | Personalization | Latency | Complexity | Explainability |
|----------|-----------------|---------|------------|----------------|
| **Weighted formula** | Basic | <1ms | Low | High |
| **ML model (LTR)** | Advanced | 5-20ms | High | Low |
| **Two-stage ranking** | Advanced | 2-10ms | Medium | Medium |
| **Contextual bandits** | Adaptive | 1-5ms | Medium | Medium |

**Decision**: Weighted formula for simplicity and explainability. ML can be added later.

## Deep Dive: Real-Time Aggregation Pipeline

```javascript
class AggregationPipeline {
  constructor() {
    this.buffer = new Map();  // phrase -> count
    this.flushInterval = 60000; // 1 minute
  }

  async start() {
    // Subscribe to query log stream
    kafka.subscribe('query_logs', async (message) => {
      await this.processQuery(message);
    });

    // Periodic flush to trie servers
    setInterval(() => this.flush(), this.flushInterval);
  }

  async processQuery(message) {
    const { query, timestamp, userId } = JSON.parse(message);

    // Filter inappropriate content
    if (await this.isInappropriate(query)) return;

    // Filter low-quality queries
    if (this.isLowQuality(query)) return;

    // Increment buffer count
    const current = this.buffer.get(query) || 0;
    this.buffer.set(query, current + 1);

    // Update trending counters
    await this.updateTrending(query, timestamp);
  }

  isLowQuality(query) {
    if (query.length < 2) return true;         // Too short
    if (query.length > 100) return true;       // Too long
    if (/^\d+$/.test(query)) return true;      // Only numbers
    if (/^[asdfghjklqwertyuiopzxcvbnm]{10,}$/i.test(query)) return true; // Keyboard smash
    return false;
  }

  async updateTrending(query, timestamp) {
    // Sliding window counter (5-minute windows)
    const windowKey = `trending_window:${Math.floor(timestamp / 300000)}`;

    await redis.zincrby(windowKey, 1, query);
    await redis.expire(windowKey, 3600); // Keep 1 hour of windows

    // Periodically aggregate for trending
    await this.aggregateTrending();
  }

  async flush() {
    if (this.buffer.size === 0) return;

    const updates = Array.from(this.buffer.entries());
    this.buffer.clear();

    // Group by shard and send updates
    const shardUpdates = new Map();
    for (const [phrase, count] of updates) {
      const shardId = TrieServer.getShardForPrefix(phrase, this.shardCount);
      if (!shardUpdates.has(shardId)) {
        shardUpdates.set(shardId, []);
      }
      shardUpdates.get(shardId).push({ phrase, count });
    }

    for (const [shardId, phraseUpdates] of shardUpdates) {
      await this.sendUpdates(shardId, phraseUpdates);
    }
  }
}
```

### Trie Rebuild Strategy

- **Incremental updates**: Add delta counts every minute
- **Full rebuild**: Nightly rebuild from aggregated data
- **A/B deployment**: Build new trie, swap atomically

## Database Schema

```sql
-- Phrase counts (aggregated)
CREATE TABLE phrase_counts (
  phrase VARCHAR(200) PRIMARY KEY,
  count BIGINT DEFAULT 0,
  last_updated TIMESTAMP DEFAULT NOW(),
  is_filtered BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_phrase_count ON phrase_counts(count DESC);

-- Query logs (raw, for aggregation)
CREATE TABLE query_logs (
  id BIGSERIAL PRIMARY KEY,
  query VARCHAR(200) NOT NULL,
  user_id UUID,
  timestamp TIMESTAMP DEFAULT NOW(),
  session_id VARCHAR(100)
);

CREATE INDEX idx_query_logs_time ON query_logs(timestamp);

-- User search history (for personalization)
CREATE TABLE user_history (
  user_id UUID NOT NULL,
  phrase VARCHAR(200) NOT NULL,
  count INTEGER DEFAULT 1,
  last_searched TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, phrase)
);

-- Filtered phrases (inappropriate content)
CREATE TABLE filtered_phrases (
  phrase VARCHAR(200) PRIMARY KEY,
  reason VARCHAR(50),
  added_at TIMESTAMP DEFAULT NOW()
);
```

## Caching Strategy

### Multi-Layer Cache

```
┌──────────────────────────────────────────────────────────┐
│  Request: GET /api/v1/suggestions?q={prefix}             │
└───────────────────────┬──────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│  1. Check Redis cache: suggestions:{prefix}              │
│     Hit? → Return cached data                            │
│     Miss? → Continue                                     │
└───────────────────────┬─────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│  2. Query trie shard for prefix                          │
│     → Get base suggestions                               │
└───────────────────────┬─────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│  3. Apply ranking (popularity + trending + personal)     │
│     → Store in cache (TTL: 60 seconds)                   │
│     → Return ranked suggestions                          │
└─────────────────────────────────────────────────────────┘
```

### Cache Key Design

```javascript
const CACHE_KEYS = {
  // Prefix suggestions (short TTL for freshness)
  suggestions: (prefix) => `suggestions:${prefix}`,

  // Trending queries (very short TTL)
  trending: () => `trending_queries`,

  // User history (longer TTL, invalidate on search)
  userHistory: (userId) => `user_history:${userId}`,

  // Sliding window counters for trending
  trendingWindow: (timestamp) => `trending_window:${Math.floor(timestamp / 300000)}`
};
```

### Cache Invalidation Strategies

| Strategy | Hit Rate | Staleness | Complexity |
|----------|----------|-----------|------------|
| **Fixed TTL** | 60-80% | TTL seconds | Low |
| **LRU with TTL** | 70-85% | TTL seconds | Low |
| **Write-through** | 90%+ | None | Medium |
| **Stale-while-revalidate** | 95%+ | Seconds | Medium |

**Decision**: LRU with 60-second TTL + stale-while-revalidate at CDN.

## Idempotency and Consistency

### Query Log Ingestion Idempotency

```javascript
class IdempotentAggregator {
  constructor() {
    this.processedKeys = new Set();
    this.keyExpiry = 300000;  // 5 minutes
  }

  async processQuery(message) {
    const { idempotencyKey } = message;

    // Check in-memory first (fast path)
    if (this.processedKeys.has(idempotencyKey)) {
      return { status: 'duplicate', processed: false };
    }

    // Check Redis for distributed deduplication
    const exists = await redis.setnx(`idem:${idempotencyKey}`, '1');
    if (!exists) {
      return { status: 'duplicate', processed: false };
    }

    await redis.expire(`idem:${idempotencyKey}`, 300);
    this.processedKeys.add(idempotencyKey);
    setTimeout(() => this.processedKeys.delete(idempotencyKey), this.keyExpiry);

    await this.doProcessQuery(message);
    return { status: 'processed', processed: true };
  }
}
```

### Write Consistency Model

| Operation | Consistency | Rationale |
|-----------|-------------|-----------|
| Query log ingestion | Eventual | High throughput matters |
| Phrase count updates | Eventual | Aggregated counts tolerate drift |
| Trending score updates | Eventual | Real-time approximation sufficient |
| Filter list updates | Strong | Must block immediately |
| User history updates | Eventual | Personalization can lag |

## Circuit Breaker and Failure Handling

```javascript
class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || 'default';
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeoutMs = options.resetTimeoutMs || 30000;
    this.state = 'CLOSED';  // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
  }

  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
      } else {
        throw new CircuitOpenError(`Circuit ${this.name} is OPEN`);
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
}
```

### Graceful Degradation

```javascript
async getSuggestionsWithFallbacks(prefix, userId) {
  try {
    return await this.primarySuggestionPath(prefix, userId);
  } catch (error) {
    // Fallback 1: Try stale cache
    const staleCache = await redis.get(`suggestions:stale:${prefix}`);
    if (staleCache) return JSON.parse(staleCache);

    // Fallback 2: Return popular suggestions
    return await this.getPopularSuggestions(prefix);
  }
}
```

## API Design

### RESTful Endpoints

```
Suggestions:
GET    /api/v1/suggestions?q={prefix}  Get suggestions for prefix
POST   /api/v1/suggestions/log         Log completed search

Analytics:
GET    /api/v1/suggestions/trending    Get trending queries
GET    /api/v1/suggestions/popular     Get popular queries
GET    /api/v1/suggestions/history     Get user history

Admin:
GET    /api/v1/admin/trie/stats        Get trie statistics
POST   /api/v1/admin/trie/rebuild      Rebuild trie from database
POST   /api/v1/admin/phrases           Add/update phrase
DELETE /api/v1/admin/phrases/:phrase   Remove phrase
POST   /api/v1/admin/filter            Add to filter list
POST   /api/v1/admin/cache/clear       Clear suggestion cache
```

### Request/Response Examples

**Get Suggestions**:

```http
GET /api/v1/suggestions?q=weat&limit=5&userId=abc123
```

Response:
```json
{
  "suggestions": [
    { "phrase": "weather forecast", "score": 0.95 },
    { "phrase": "weather today", "score": 0.92 },
    { "phrase": "weather radar", "score": 0.88 },
    { "phrase": "weather alert", "score": 0.85, "trending": true },
    { "phrase": "weather seattle", "score": 0.82 }
  ],
  "cached": false,
  "latencyMs": 12
}
```

## Observability

### Key Metrics (Prometheus)

```javascript
// Request latency histogram
const suggestionLatency = new promClient.Histogram({
  name: 'typeahead_suggestion_latency_seconds',
  help: 'Latency of suggestion requests',
  labelNames: ['endpoint', 'cache_hit'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5]
});

// Cache metrics
const cacheHitRate = new promClient.Gauge({
  name: 'typeahead_cache_hit_rate',
  help: 'Cache hit rate (0-1)',
  labelNames: ['cache_type']
});

// Trie metrics
const trieNodeCount = new promClient.Gauge({
  name: 'typeahead_trie_node_count',
  help: 'Number of nodes in trie',
  labelNames: ['shard_id']
});

// Kafka lag
const kafkaLag = new promClient.Gauge({
  name: 'typeahead_kafka_consumer_lag',
  help: 'Kafka consumer lag',
  labelNames: ['partition']
});
```

### Alert Thresholds

```yaml
alerts:
  - name: TypeaheadHighLatency
    expr: histogram_quantile(0.99, rate(typeahead_suggestion_latency_seconds_bucket[5m])) > 0.05
    severity: warning

  - name: TypeaheadLowCacheHitRate
    expr: typeahead_cache_hit_rate{cache_type="redis"} < 0.7
    severity: warning

  - name: TypeaheadKafkaLagHigh
    expr: sum(typeahead_kafka_consumer_lag) > 50000
    severity: warning
```

## Scalability Considerations

### Read Scaling

1. **Trie Sharding**: Shard by first character across multiple servers
2. **Read Replicas**: Multiple replicas per shard for high QPS
3. **CDN Caching**: Edge caching for popular prefixes

### Write Scaling

1. **Buffered Writes**: Aggregate counts before updating trie
2. **Kafka Partitioning**: Scale aggregation workers horizontally
3. **Batch Updates**: Periodic trie rebuilds from aggregated data

### Estimated Capacity

| Component | Single Node | Scaled (4x) |
|-----------|-------------|-------------|
| Trie lookups | 50K/sec | 200K/sec |
| Redis cache | 100K/sec | 100K/sec |
| Kafka ingestion | 50K/sec | 200K/sec |
| PostgreSQL writes | 5K/sec | 20K/sec |

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Pre-computed top-k | O(1) lookup | Higher memory, update cost |
| First-char sharding | Prefix locality | Uneven distribution |
| Weighted ranking | Simple, explainable | Less personalization |
| 60s cache TTL | Low latency | Slight staleness |
| Kafka aggregation | Scalable ingestion | Eventual consistency |

## Future Backend Enhancements

1. **Fuzzy Matching**: Add edit-distance for typo correction
2. **ML-Based Ranking**: Learning-to-rank for better personalization
3. **Real-Time Streaming**: WebSocket for instant trending updates
4. **Geo-Sharding**: Region-specific suggestions
5. **A/B Testing Framework**: Experiment with ranking weights
