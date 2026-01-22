# Google Search - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Problem Statement

Design the backend infrastructure for a web search engine that:
- Crawls and indexes 100+ billion web pages
- Processes 8+ billion queries per day with sub-200ms latency
- Ranks results using PageRank and relevance signals
- Handles distributed crawling with politeness constraints

## Requirements Clarification

### Functional Requirements
1. **Web Crawling**: Discover and fetch web pages respecting robots.txt
2. **Indexing**: Build and maintain an inverted index for fast lookups
3. **PageRank**: Calculate link-based authority scores
4. **Query Processing**: Parse, expand, and execute search queries
5. **Ranking**: Combine multiple signals for result ordering

### Non-Functional Requirements
1. **Scale**: Index 100B+ pages across petabytes of data
2. **Latency**: < 200ms p99 query response time
3. **Freshness**: Update popular pages daily, news hourly
4. **Availability**: 99.99% uptime for query serving

### Scale Estimates
- 100B pages, avg 50KB each = 5PB raw content
- Inverted index: ~500TB compressed
- 8B queries/day = 100K QPS at peak
- Crawl rate: 1B pages/day for freshness

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Crawl System                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │URL Frontier │  │  Fetchers   │  │   Parser    │  │  Deduper    │    │
│  │(Priority Q) │  │  (Workers)  │  │  (Extract)  │  │ (SimHash)   │    │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │
└─────────┼────────────────┼────────────────┼────────────────┼────────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Indexing Pipeline                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  Tokenizer  │  │Index Builder│  │  PageRank   │  │   Sharder   │    │
│  │  (Stemming) │  │ (Postings)  │  │  (Batch)    │  │ (Term Hash) │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Serving Layer                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │Query Parser │  │Index Servers│  │   Ranker    │  │Result Cache │    │
│  │ (Expansion) │  │ (Sharded)   │  │ (Two-Phase) │  │  (Redis)    │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Data Layer                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐       │
│  │    PostgreSQL    │  │   Elasticsearch  │  │      Redis       │       │
│  │  (URL State,     │  │ (Inverted Index) │  │  (Query Cache,   │       │
│  │   Link Graph)    │  │                  │  │   Rate Limits)   │       │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘       │
└─────────────────────────────────────────────────────────────────────────┘
```

## Deep Dive: URL Frontier and Politeness

### URL Frontier Architecture

The frontier manages billions of URLs with priority-based scheduling:

```javascript
class URLFrontier {
  constructor() {
    this.hostQueues = new Map()      // host -> URL queue
    this.priorityQueue = new PriorityQueue()  // hosts by priority
    this.hostLastFetch = new Map()   // host -> timestamp
    this.minCrawlDelay = 1000        // Default politeness delay
  }

  async addURL(url, priority) {
    const host = new URL(url).hostname

    // Check robots.txt allowance
    if (!await this.robotsCache.isAllowed(url)) {
      return
    }

    // URL-level deduplication
    const urlHash = this.hashURL(url)
    if (await this.seenURLs.has(urlHash)) {
      return
    }
    await this.seenURLs.add(urlHash)

    // Add to per-host queue
    if (!this.hostQueues.has(host)) {
      this.hostQueues.set(host, new PriorityQueue())
    }
    this.hostQueues.get(host).enqueue({ url, priority })

    // Schedule host in global queue
    this.priorityQueue.enqueue({ host, priority })
  }

  async getNextURL() {
    while (true) {
      const { host, priority } = this.priorityQueue.dequeue()
      const lastFetch = this.hostLastFetch.get(host) || 0
      const delay = await this.getCrawlDelay(host)

      if (Date.now() - lastFetch < delay) {
        // Re-queue with lower priority
        this.priorityQueue.enqueue({ host, priority: priority * 0.9 })
        continue
      }

      const hostQueue = this.hostQueues.get(host)
      if (hostQueue && hostQueue.size() > 0) {
        const { url } = hostQueue.dequeue()
        this.hostLastFetch.set(host, Date.now())
        return url
      }
    }
  }

  async getCrawlDelay(host) {
    const robots = await this.robotsCache.get(host)
    return robots?.crawlDelay || this.minCrawlDelay
  }
}
```

### robots.txt Caching Strategy

```javascript
class RobotsCache {
  constructor() {
    this.cache = new Map()  // host -> { rules, expiry }
    this.ttl = 24 * 60 * 60 * 1000  // 24 hours
  }

  async isAllowed(url) {
    const host = new URL(url).hostname
    let entry = this.cache.get(host)

    if (!entry || Date.now() > entry.expiry) {
      const rules = await this.fetchRobotsTxt(host)
      entry = { rules, expiry: Date.now() + this.ttl }
      this.cache.set(host, entry)
    }

    return this.matchRules(url, entry.rules, 'Googlebot')
  }

  matchRules(url, rules, userAgent) {
    const path = new URL(url).pathname

    for (const rule of rules) {
      if (rule.userAgent !== '*' && rule.userAgent !== userAgent) {
        continue
      }

      // Check disallow patterns
      for (const pattern of rule.disallow) {
        if (this.matchPattern(path, pattern)) {
          return false
        }
      }
    }
    return true
  }
}
```

### Why Priority-Based Frontier?

| Approach | Pros | Cons |
|----------|------|------|
| **Priority queue** | Crawl important pages first | Complex priority computation |
| FIFO queue | Simple implementation | Wastes resources on low-value pages |
| Random sampling | Even coverage | Misses time-sensitive content |

**Decision**: Priority queue with multiple signals (PageRank, freshness, inlink count) maximizes value from limited crawl budget.

## Deep Dive: Inverted Index Construction

### Index Builder Pipeline

```javascript
class IndexBuilder {
  async processDocument(doc) {
    // Tokenize and normalize
    const tokens = this.tokenize(doc.content)
    const titleTokens = this.tokenize(doc.title)

    const postings = new Map()  // term -> posting

    for (let pos = 0; pos < tokens.length; pos++) {
      const term = this.stem(tokens[pos])

      if (!postings.has(term)) {
        postings.set(term, {
          docId: doc.id,
          positions: [],
          termFreq: 0,
          fieldBoosts: { title: 0, body: 0, anchor: 0 }
        })
      }

      const posting = postings.get(term)
      posting.positions.push(pos)
      posting.termFreq++
    }

    // Apply title boost
    for (const term of titleTokens.map(t => this.stem(t))) {
      if (postings.has(term)) {
        postings.get(term).fieldBoosts.title++
      }
    }

    return postings
  }

  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && !this.stopwords.has(t))
  }

  stem(term) {
    // Porter stemmer for English
    return this.porterStemmer.stem(term)
  }
}
```

### Index Sharding Strategy

```javascript
class IndexSharder {
  constructor(numShards = 256) {
    this.numShards = numShards
  }

  // Shard by term hash for efficient query routing
  getShardForTerm(term) {
    const hash = this.hashTerm(term)
    return hash % this.numShards
  }

  hashTerm(term) {
    let hash = 0
    for (const char of term) {
      hash = ((hash << 5) - hash + char.charCodeAt(0)) >>> 0
    }
    return hash
  }

  // Query routing: determine which shards to query
  getQueryShards(terms) {
    const shards = new Set()
    for (const term of terms) {
      shards.add(this.getShardForTerm(term))
    }
    return Array.from(shards)
  }
}
```

### Shard-by-Term vs Shard-by-Document

| Strategy | Query Pattern | Pros | Cons |
|----------|---------------|------|------|
| **By term** | Fan-out to term shards | All postings for term on one shard | Multi-term queries hit multiple shards |
| By document | Scatter-gather all shards | Simple partitioning | Every query hits all shards |

**Decision**: Shard by term hash. For most queries (2-5 terms), we query 2-5 shards instead of all 256. This reduces average query fan-out by 50x.

## Deep Dive: PageRank Computation

### Batch PageRank Algorithm

```javascript
class PageRankCalculator {
  constructor(dampingFactor = 0.85, maxIterations = 100) {
    this.d = dampingFactor
    this.maxIterations = maxIterations
    this.convergenceThreshold = 1e-6
  }

  async calculate(linkGraph) {
    const pages = Object.keys(linkGraph)
    const n = pages.length

    // Initialize uniform distribution
    let ranks = {}
    for (const page of pages) {
      ranks[page] = 1 / n
    }

    // Build inlink index for efficiency
    const inlinks = this.buildInlinkIndex(linkGraph)

    // Handle dangling nodes (no outlinks)
    const danglingNodes = pages.filter(p =>
      !linkGraph[p] || linkGraph[p].length === 0
    )

    for (let iter = 0; iter < this.maxIterations; iter++) {
      const newRanks = {}

      // Dangling node contribution (distributed to all)
      let danglingSum = 0
      for (const node of danglingNodes) {
        danglingSum += ranks[node]
      }
      const danglingContrib = this.d * danglingSum / n

      for (const page of pages) {
        // Sum from inlinks
        let linkSum = 0
        for (const inlink of (inlinks[page] || [])) {
          const outDegree = linkGraph[inlink].length
          linkSum += ranks[inlink] / outDegree
        }

        // PageRank formula
        newRanks[page] = (1 - this.d) / n +
                         this.d * linkSum +
                         danglingContrib
      }

      // Check convergence
      const diff = this.l1Diff(ranks, newRanks)
      ranks = newRanks

      if (diff < this.convergenceThreshold) {
        console.log(`Converged after ${iter + 1} iterations`)
        break
      }
    }

    return ranks
  }

  buildInlinkIndex(linkGraph) {
    const inlinks = {}
    for (const [page, outlinks] of Object.entries(linkGraph)) {
      for (const target of outlinks) {
        if (!inlinks[target]) inlinks[target] = []
        inlinks[target].push(page)
      }
    }
    return inlinks
  }

  l1Diff(ranks1, ranks2) {
    let sum = 0
    for (const page of Object.keys(ranks1)) {
      sum += Math.abs(ranks1[page] - ranks2[page])
    }
    return sum
  }
}
```

### PageRank Update Strategy

| Strategy | Update Frequency | Pros | Cons |
|----------|------------------|------|------|
| **Batch weekly** | Weekly | Simple, stable | New pages wait for rank |
| Incremental | Per crawl | Fresh ranks | Complex, may oscillate |
| Real-time | Continuous | Immediate | Expensive, unstable |

**Decision**: Weekly batch computation. PageRank is relatively stable; link structure changes slowly compared to content.

## Deep Dive: Two-Phase Ranking

### Query Flow

```javascript
class QueryProcessor {
  async search(queryString) {
    // Parse query
    const parsed = this.parseQuery(queryString)

    // Phase 1: Fast candidate retrieval (BM25 only)
    const candidates = await this.retrieveCandidates(parsed, 1000)

    // Phase 2: Expensive re-ranking (all signals)
    const ranked = await this.rerank(candidates, parsed)

    return ranked.slice(0, 10)
  }

  async retrieveCandidates(query, limit) {
    // Query Elasticsearch with BM25
    const results = await this.elasticsearch.search({
      index: 'documents',
      body: {
        query: {
          bool: {
            must: query.terms.map(term => ({
              match: { content: term }
            })),
            must_not: query.excluded.map(term => ({
              match: { content: term }
            })),
            filter: query.site ? [
              { term: { host: query.site } }
            ] : []
          }
        },
        size: limit
      }
    })

    return results.hits.hits
  }

  async rerank(candidates, query) {
    const scored = await Promise.all(
      candidates.map(async doc => {
        const textScore = doc._score  // BM25 from ES
        const pageRank = await this.getPageRank(doc._id)
        const freshness = this.calculateFreshness(doc._source.lastModified)
        const clickScore = await this.getClickThrough(doc._id, query)

        // Learned weights
        const finalScore =
          textScore * 0.35 +
          pageRank * 0.25 +
          freshness * 0.15 +
          clickScore * 0.25

        return { doc, score: finalScore }
      })
    )

    scored.sort((a, b) => b.score - a.score)
    return scored.map(s => s.doc)
  }

  calculateFreshness(lastModified) {
    const ageMs = Date.now() - new Date(lastModified).getTime()
    const ageDays = ageMs / (1000 * 60 * 60 * 24)

    // Exponential decay
    return Math.exp(-ageDays / 30)
  }
}
```

### BM25 Parameters

```javascript
// BM25 scoring function
function bm25(doc, terms, avgDocLength, k1 = 1.2, b = 0.75) {
  let score = 0

  for (const term of terms) {
    const tf = doc.termFreqs[term] || 0
    const df = getDocFreq(term)
    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5))

    const tfNorm = (tf * (k1 + 1)) /
                   (tf + k1 * (1 - b + b * doc.length / avgDocLength))

    score += idf * tfNorm
  }

  return score
}
```

## Database Schema

```sql
-- URL crawl state
CREATE TABLE urls (
    url_hash BIGINT PRIMARY KEY,
    url TEXT NOT NULL,
    host VARCHAR(255) NOT NULL,
    last_crawl TIMESTAMPTZ,
    next_crawl TIMESTAMPTZ,
    crawl_status VARCHAR(20) DEFAULT 'pending',
    content_hash BIGINT,
    page_rank DECIMAL(10, 9) DEFAULT 0,
    inlink_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_urls_next_crawl ON urls(next_crawl) WHERE crawl_status = 'pending';
CREATE INDEX idx_urls_host ON urls(host);

-- Link graph for PageRank
CREATE TABLE links (
    source_hash BIGINT NOT NULL,
    target_hash BIGINT NOT NULL,
    anchor_text TEXT,
    discovered_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (source_hash, target_hash)
);

CREATE INDEX idx_links_target ON links(target_hash);

-- Query logs for learning
CREATE TABLE query_logs (
    id BIGSERIAL PRIMARY KEY,
    query_text TEXT NOT NULL,
    query_terms TEXT[] NOT NULL,
    result_count INTEGER,
    clicked_urls BIGINT[],
    latency_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_query_logs_created ON query_logs(created_at);
```

## Caching Strategy

### Query Result Cache

```javascript
class QueryCache {
  constructor(redis, ttlSeconds = 300) {
    this.redis = redis
    this.ttl = ttlSeconds
  }

  async get(queryString) {
    const key = this.getCacheKey(queryString)
    const cached = await this.redis.get(key)

    if (cached) {
      return JSON.parse(cached)
    }
    return null
  }

  async set(queryString, results) {
    const key = this.getCacheKey(queryString)
    await this.redis.setex(key, this.ttl, JSON.stringify(results))
  }

  getCacheKey(queryString) {
    // Normalize query for better hit rate
    const normalized = queryString.toLowerCase().trim()
    return `query:${this.hash(normalized)}`
  }

  // Adaptive TTL based on query type
  getTTL(query) {
    if (query.includes('news') || query.includes('today')) {
      return 60  // 1 minute for time-sensitive
    }
    if (query.includes('site:')) {
      return 600  // 10 minutes for site-specific
    }
    return 300  // 5 minutes default
  }
}
```

### Cache Warming

```javascript
// Pre-warm cache with popular queries
async function warmCache(topQueries) {
  for (const query of topQueries) {
    const cached = await queryCache.get(query)
    if (!cached) {
      const results = await search(query)
      await queryCache.set(query, results)
    }
  }
}

// Run hourly with top 1000 queries from previous day
cron.schedule('0 * * * *', async () => {
  const topQueries = await getTopQueries(1000)
  await warmCache(topQueries)
})
```

## Scalability Considerations

### Horizontal Scaling

```
┌────────────────────────────────────────────────────────────────┐
│                      Query Path                                 │
│                                                                 │
│  Client → Load Balancer → Query Servers (stateless)            │
│                              ↓                                  │
│           ┌──────────────────┼──────────────────┐              │
│           ↓                  ↓                  ↓              │
│     Index Shard 1      Index Shard 2      Index Shard N        │
│     (3 replicas)       (3 replicas)       (3 replicas)         │
└────────────────────────────────────────────────────────────────┘
```

### Capacity Planning

| Component | Single Node | Scaled (100x) |
|-----------|-------------|---------------|
| Query servers | 1K QPS | 100K QPS |
| Index shards | 100GB | 10TB |
| Redis cache | 100K ops/sec | 10M ops/sec |
| Crawl workers | 100 pages/sec | 10K pages/sec |

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Shard by term | Efficient query routing | Multi-shard coordination |
| Two-phase ranking | Meets latency SLA | May miss relevant docs in phase 1 |
| Weekly PageRank | Stable, simple | New pages wait for authority |
| Result caching | Reduces index load | Stale results for trending queries |
| Politeness delays | Respects publishers | Limits crawl throughput |

## Future Backend Enhancements

1. **Real-time indexing**: Kafka pipeline for news/social content
2. **Learning to Rank**: Train ranking model on click data
3. **Query understanding**: Entity recognition, intent classification
4. **Personalization**: User history for result re-ranking
5. **Incremental PageRank**: Update ranks as link graph changes
