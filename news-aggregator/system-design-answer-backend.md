# News Aggregator - Backend System Design Interview Answer

*A 45-minute system design interview answer focused on backend architecture, databases, crawling, and deduplication algorithms.*

---

## Opening Statement

"Today I'll design the backend for a news aggregator like Google News or Flipboard, focusing on the content ingestion pipeline and data layer. The core backend challenges are: efficiently crawling thousands of RSS feeds with rate limiting, deduplicating articles using SimHash fingerprinting, clustering related stories, building a multi-signal ranking algorithm, and serving personalized feeds with low latency. I'll walk through the database schema, caching strategy, and scalability considerations."

---

## Step 1: Requirements Clarification (3-5 minutes)

### Functional Requirements (Backend Focus)

1. **Content Ingestion Pipeline** - Crawl RSS/Atom feeds from thousands of sources on configurable schedules
2. **Article Deduplication** - Identify near-duplicate articles using SimHash with O(1) comparison
3. **Story Clustering** - Group articles about the same event using fingerprint matching
4. **Topic Extraction** - Classify articles using keyword matching (extensible to ML)
5. **Feed Generation API** - Return personalized feeds with sub-200ms latency
6. **Search API** - Full-text search with Elasticsearch
7. **Breaking News Detection** - Velocity-based detection using sliding window counters

### Non-Functional Requirements

| Requirement | Target | Backend Implication |
|-------------|--------|---------------------|
| Freshness | Breaking news < 5 min | Priority queue for high-velocity sources |
| Latency | Feed API p95 < 200ms | Redis caching with 60s TTL |
| Scale | 100K sources, 10M articles/day | Horizontal crawler scaling, partitioned processing |
| Availability | 99.9% | Graceful degradation, circuit breakers |

### Scale Estimation

```
Content Volume:
- 100,000 news sources
- 100 articles/source/day = 10M articles/day
- Article size: 5KB text + metadata
- Daily ingestion: ~50 GB

Crawling Load:
- 100K sources / 15-min interval = 111 crawls/second
- Distributed across 10 crawlers = 11 crawls/crawler/second

API Load:
- 50M DAU * 5 feed loads = 250M requests/day
- Peak: ~8,700 QPS
```

---

## Step 2: High-Level Backend Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Backend Architecture                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                    ┌─────────────────────────────────────┐                  │
│                    │           API Gateway               │                  │
│                    │    (Rate Limiting, Auth, Routing)   │                  │
│                    └─────────────────┬───────────────────┘                  │
│                                      │                                      │
│        ┌─────────────────────────────┼─────────────────────────────┐        │
│        │                             │                             │        │
│  ┌─────▼─────┐              ┌────────▼────────┐          ┌────────▼────────┐│
│  │   Feed    │              │    Search       │          │    User         ││
│  │  Service  │              │    Service      │          │   Service       ││
│  └─────┬─────┘              └────────┬────────┘          └────────┬────────┘│
│        │                             │                             │        │
│        └─────────────────────────────┼─────────────────────────────┘        │
│                                      │                                      │
│                    ┌─────────────────▼───────────────────┐                  │
│                    │              Redis                  │                  │
│                    │  (Cache, Sessions, Index Queue)     │                  │
│                    └─────────────────┬───────────────────┘                  │
│                                      │                                      │
│        ┌─────────────────────────────┼─────────────────────────────┐        │
│        │                             │                             │        │
│  ┌─────▼─────┐              ┌────────▼────────┐          ┌────────▼────────┐│
│  │ PostgreSQL│              │  Elasticsearch  │          │ Crawler Service ││
│  │ Articles  │              │ Full-text Index │          │ RSS + SimHash   ││
│  │ Clusters  │              │ Aggregations    │          │ Dedup + Parse   ││
│  └───────────┘              └─────────────────┘          └─────────────────┘│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 3: Deep Dive - Content Crawling Pipeline (10 minutes)

### Crawl Scheduler and Rate Limiter

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                  CrawlScheduler + DomainRateLimiter                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  CrawlSchedule Record:                                                      │
│  ├─ source_id, url, crawl_interval (5-60 min), priority (1-10)              │
│  ├─ last_crawled_at, next_crawl_at, consecutive_failures                    │
│  └─ circuit_state: 'closed' | 'open' | 'half-open'                          │
│                                                                             │
│  getNextBatch(limit=100):                                                   │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  SELECT * FROM crawl_schedule                                         │ │
│  │  WHERE next_crawl_at <= NOW() AND circuit_state != 'open'             │ │
│  │  ORDER BY priority DESC, next_crawl_at ASC LIMIT {limit}              │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  updateAfterCrawl(sourceId, success):                                       │
│  ├─ Success: next_crawl = NOW() + interval, failures = 0, circuit = closed  │
│  └─ Failure: next_crawl = NOW() + 2^min(failures,6) min, circuit = open@5   │
│                                                                             │
│  DomainRateLimiter (per domain):                                            │
│  ├─ Default: 1 req/sec, 1000ms min crawl delay                              │
│  ├─ Fetch robots.txt → parse Crawl-delay directive                          │
│  ├─ TokenBucket: capacity=1, refillRate=1000/delay                          │
│  └─ acquireToken(): wait loop until token available (100ms sleep)           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### RSS Feed Parser

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RSS Feed Parser                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ParsedArticle: { external_id, url, title, summary, author, published_at }  │
│                                                                             │
│  Flow: fetchWithRetry(url, timeout=10s, retries=3, backoff=[1s,5s,30s])     │
│        → XMLParser.parse() → Detect format (RSS 2.0 or Atom)                │
│        → Map items to ParsedArticle                                         │
│                                                                             │
│  Field Mapping:                                                             │
│  ├─ external_id: item.guid || item.id || item.link                          │
│  ├─ url: item.link['@_href'] || item.link                                   │
│  ├─ title: item.title                                                       │
│  ├─ summary: stripHtml(item.description || item.summary)                    │
│  ├─ author: item.author || item['dc:creator']                               │
│  └─ published_at: item.pubDate || item.published || item.updated            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 4: Deep Dive - SimHash Deduplication (10 minutes)

### SimHash Algorithm (64-bit fingerprint)

SimHash creates a 64-bit fingerprint where similar documents produce similar fingerprints (small Hamming distance).

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SimHasher Algorithm                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  computeFingerprint(text):                                                  │
│                                                                             │
│  Step 1: Tokenize                                                           │
│  ├─ Normalize: lowercase, remove punctuation                                │
│  ├─ Extract words (length > 2): ["breaking", "news", "stock", ...]          │
│  ├─ Generate 3-grams: ["breaking news stock", "news stock market", ...]     │
│  └─ Tokens = [...words, ...ngrams]                                          │
│                                                                             │
│  Step 2: Initialize vector = Array(64).fill(0)                              │
│                                                                             │
│  Step 3: For each token:                                                    │
│  ├─ hash = MurmurHash3_128(token) lower 64 bits                             │
│  └─ For i = 0 to 63: vector[i] += (bit i is 1) ? +1 : -1                    │
│                                                                             │
│  Step 4: Convert to fingerprint:                                            │
│  └─ For i = 0 to 63: if vector[i] > 0, set bit i to 1                       │
│                                                                             │
│  Comparison:                                                                │
│  ├─ hammingDistance(a, b): count set bits in (a XOR b)                      │
│  └─ areSimilar(fp1, fp2, threshold=3): distance <= threshold                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Story Clustering with Fingerprints

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     StoryClusterService                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  StoryCluster: { id, title, fingerprint, article_count, source_count,       │
│                  velocity, is_breaking, first_seen_at, last_updated_at }    │
│                                                                             │
│  assignArticleToCluster(article):                                           │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  1. fingerprint = simhasher.compute(title + summary)                  │ │
│  │                                                                       │ │
│  │  2. Find matching cluster (PostgreSQL bit operations):                │ │
│  │     SELECT *, bit_count(fingerprint::bit(64) # {fp}::bit(64))         │ │
│  │       AS hamming_distance                                             │ │
│  │     FROM story_clusters                                               │ │
│  │     WHERE last_updated_at > NOW() - '48 hours'                        │ │
│  │       AND bit_count(...) <= 3                                         │ │
│  │     ORDER BY hamming_distance, last_updated_at DESC LIMIT 5           │ │
│  │                                                                       │ │
│  │  3. If match: addArticleToCluster (update count, sources)             │ │
│  │     If no match: createCluster (new with article_count=1)             │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### MinHash + LSH for Scale (10M+ articles)

For production scale, use Locality Sensitive Hashing to avoid O(n) comparisons:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       MinHashLSH Algorithm                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Config: numHashes=100, bands=20, rowsPerBand=5                             │
│                                                                             │
│  generateSignature(text):                                                   │
│  ├─ Get character 3-shingles: "hello" → {"hel", "ell", "llo"}               │
│  └─ For each of 100 hash functions: signature[i] = min(hash(shingles))      │
│                                                                             │
│  index(articleId, signature):                                               │
│  ├─ Divide 100-element signature into 20 bands of 5 rows each               │
│  └─ For each band: bucketKey = "{band}:{bandSig}", add articleId to bucket  │
│                                                                             │
│  findCandidates(signature):                                                 │
│  ├─ For each band: look up bucketKey, collect all articleIds                │
│  └─ Return candidates (only compare these with full fingerprint!)           │
│                                                                             │
│  Key insight: Similar documents share at least one identical band           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 5: Deep Dive - Ranking Algorithm (8 minutes)

### Multi-Signal Feed Ranking

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      FeedRanker Service                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Weights: relevance=0.35, freshness=0.25, quality=0.20,                     │
│           diversity=0.10, trending=0.10                                     │
│                                                                             │
│  rankStories(stories, userPrefs, context):                                  │
│  ├─ For each story: compute signals, weighted score, apply breaking boost   │
│  └─ Return sorted by score descending                                       │
│                                                                             │
│  Signal Computations (all normalized 0-1):                                  │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  RELEVANCE: topic_weights + preferred_sources(+0.2)                   │ │
│  │             - excluded_sources(-0.5), already_read(*0.1)              │ │
│  │                                                                       │ │
│  │  FRESHNESS: exp(-ageHours * ln(2) / 6) // 6-hour half-life            │ │
│  │             6h→0.5, 12h→0.25, 24h→0.06                                │ │
│  │                                                                       │ │
│  │  QUALITY: (source_count/5) * 0.6 + credibility * 0.4                  │ │
│  │                                                                       │ │
│  │  DIVERSITY: topic penalty (1 - occurrences*0.2) * source penalty      │ │
│  │                                                                       │ │
│  │  TRENDING: min(velocity/10, 1)                                        │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  Breaking News Boost: score *= 1.3 if is_breaking                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Breaking News Detection

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    BreakingNewsDetector Service                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Thresholds: velocity > 2 articles/min AND source_count >= 5                │
│  Window: 30 minutes                                                         │
│                                                                             │
│  checkVelocity(clusterId):                                                  │
│  ├─ Query: COUNT(*), COUNT(DISTINCT source_id) WHERE created_at > -30min    │
│  ├─ velocity = article_count / 30                                           │
│  ├─ Update cluster velocity                                                 │
│  └─ If thresholds met: markAsBreaking(clusterId)                            │
│                                                                             │
│  markAsBreaking(clusterId):                                                 │
│  ├─ UPDATE: is_breaking=true, breaking_started_at=COALESCE(current, NOW())  │
│  └─ If newly marked: notifyInterestedUsers (push queue)                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 6: Database Schema (5 minutes)

### PostgreSQL Schema

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PostgreSQL Schema                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  sources: id, name, url, category, credibility_score, crawl_interval,       │
│           is_active, created_at                                             │
│                                                                             │
│  crawl_schedule (separate for perf):                                        │
│  ├─ source_id (PK), last_crawled_at, next_crawl_at, priority                │
│  ├─ consecutive_failures, circuit_state, last_article_count                 │
│  └─ INDEX: idx_crawl_due ON (next_crawl_at) WHERE circuit_state != 'open'   │
│                                                                             │
│  story_clusters: id, title, fingerprint (BIGINT), primary_topic, topics[],  │
│  ├─ article_count, source_count, velocity, is_breaking, breaking_started_at │
│  ├─ first_seen_at, last_updated_at                                          │
│  └─ INDEXES: fingerprint, last_updated_at DESC, (is_breaking, velocity)     │
│                                                                             │
│  articles: id, source_id, story_cluster_id, external_id, url, title,        │
│  ├─ summary, author, published_at, crawled_at, fingerprint, topics[]        │
│  └─ INDEXES: (source_id, external_id) UNIQUE, story_cluster_id, published   │
│                                                                             │
│  users + user_preferences + user_reading_history                            │
│                                                                             │
│  FUNCTION: hamming_distance(a,b) → bit_count((a XOR b)::bit(64))            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Elasticsearch Mapping

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Elasticsearch Index: articles                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Settings: shards=1, replicas=0, refresh="5s"                               │
│  Analyzer: news_analyzer (standard + lowercase + stop + snowball)           │
│                                                                             │
│  Fields: article_id, story_cluster_id, source_id, source_name (keyword)     │
│          title (text + keyword), summary (text), topics (keyword)           │
│          published_at (date), velocity (float), is_breaking (boolean)       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 7: Caching Strategy (3 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Redis Cache Patterns                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  TTLs: feed=60s, prefs=300s, trending=30s                                   │
│                                                                             │
│  Key Patterns:                                                              │
│  ├─ feed:user:{id}:{cursor}:{limit} → personalized feed (60s)               │
│  ├─ feed:global:trending → global trending (30s)                            │
│  ├─ prefs:user:{id} → user preferences (5m)                                 │
│  ├─ session:{id} → user session (24h)                                       │
│  ├─ index:queue → articles pending ES indexing (list)                       │
│  ├─ crawl:lock:{sourceId} → distributed lock (5m)                           │
│  └─ rate:{ip} → rate limiting counter (60s)                                 │
│                                                                             │
│  Operations:                                                                │
│  ├─ get/set PersonalizedFeed, UserPreferences                               │
│  ├─ invalidateUserFeed (keys pattern match + del)                           │
│  └─ get/set GlobalTrending                                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 8: Circuit Breaker Pattern (3 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Circuit Breaker (opossum)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Config: timeout=10s, errorThreshold=50%, resetTimeout=30s, volume=5        │
│                                                                             │
│       ┌─────────┐    50% failures    ┌─────────┐                            │
│       │ CLOSED  │ ─────────────────▶ │  OPEN   │                            │
│       │ (normal)│                    │ (reject)│                            │
│       └────┬────┘                    └────┬────┘                            │
│            │              after 30s       │                                 │
│            │           ┌──────────────────┘                                 │
│            │           ▼                                                    │
│            │     ┌───────────┐                                              │
│            │     │ HALF-OPEN │ ──success──▶ CLOSED                          │
│            │     │  (test)   │ ──failure──▶ OPEN                            │
│            │     └───────────┘                                              │
│                                                                             │
│  Fallback: Return { status: 'circuit_open', articles: [] }                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 9: API Endpoints (2 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          API Endpoints                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  GET /api/v1/feed (auth required)                                           │
│  ├─ Params: cursor, limit                                                   │
│  ├─ Try cache → generate if miss → cache → return { stories, next_cursor }  │
│  └─ Metrics: cache hits/misses                                              │
│                                                                             │
│  GET /api/v1/search (rate limited)                                          │
│  ├─ Params: q, topic?, source?, from?, to?, limit                           │
│  ├─ Elasticsearch: multi_match (title^2, summary) + filters                 │
│  └─ Return { hits (with highlights), total }                                │
│                                                                             │
│  GET /api/v1/breaking (no auth)                                             │
│  ├─ Query: is_breaking=true, started > -6h, ORDER BY velocity DESC          │
│  └─ Return { stories }                                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Trade-offs Summary

| Decision | Chosen Approach | Alternative | Trade-off |
|----------|-----------------|-------------|-----------|
| Deduplication | SimHash (64-bit) | Semantic embeddings | Fast O(1) compare vs better paraphrase detection |
| Similarity search | PostgreSQL Hamming | MinHash + LSH in Redis | Simpler ops vs O(1) candidate lookup at scale |
| Message queue | Redis Lists | RabbitMQ/Kafka | Lower ops overhead vs better delivery guarantees |
| Feed caching | 60s TTL | Real-time generation | Faster response vs always-fresh content |
| Topic extraction | Keyword matching | ML classifier | Predictable behavior vs better accuracy |
| Breaking detection | Velocity threshold | Anomaly detection ML | Simple tuning vs adaptive thresholds |

---

## Closing Summary

"I've designed a backend system for news aggregation with:

1. **Distributed Crawling** - Rate-limited per domain with circuit breakers and exponential backoff
2. **SimHash Deduplication** - O(1) fingerprint comparison with 64-bit hashes
3. **Story Clustering** - Grouping articles within Hamming distance threshold
4. **Multi-signal Ranking** - Balancing relevance, freshness, quality, diversity, and trending
5. **Velocity-based Breaking News** - Real-time detection with sliding window counters

The architecture separates the ingestion pipeline (crawling, dedup, clustering) from the serving path (feed generation), allowing each to scale independently. PostgreSQL handles transactional data and fingerprint matching, Redis provides caching and queuing, and Elasticsearch powers full-text search. Happy to dive deeper into any component."
