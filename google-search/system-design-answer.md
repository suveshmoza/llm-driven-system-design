# Google Search - System Design Interview Answer

## Opening Statement (1 minute)

"I'll design Google Search, a web search engine that indexes and searches 100+ billion web pages with sub-200ms latency. The key challenges are crawling the web efficiently while respecting rate limits, building an inverted index that can be queried at massive scale, and ranking results by relevance and quality using PageRank and other signals.

The core technical challenges are implementing a politeness-respecting URL frontier for crawling, building a sharded inverted index that supports fast term lookup, and combining multiple ranking signals in a two-phase ranking system that meets latency requirements."

## Requirements Clarification (3 minutes)

### Functional Requirements
- **Crawl**: Discover and fetch web pages
- **Index**: Build searchable index of content
- **Query**: Process user search queries
- **Rank**: Order results by relevance and quality
- **Serve**: Return results with low latency

### Non-Functional Requirements
- **Scale**: Index 100B+ web pages
- **Latency**: < 200ms for query response
- **Freshness**: Update popular pages daily
- **Relevance**: High precision and recall

### Scale Estimates
- 100+ billion web pages indexed
- 8+ billion searches per day
- Average query touches millions of documents
- Index size: Petabytes

## High-Level Architecture (5 minutes)

```
+----------------------------------------------------------+
|                      Crawl System                          |
|      URL Frontier | Fetcher | Parser | Deduplication       |
+----------------------------------------------------------+
                           |
                           v
+----------------------------------------------------------+
|                   Indexing Pipeline                        |
|      Tokenizer | Index Builder | PageRank | Sharding       |
+----------------------------------------------------------+
                           |
                           v
+----------------------------------------------------------+
|                    Serving System                          |
|       Query Parser | Index Servers | Ranking | Cache       |
+----------------------------------------------------------+
                           |
                           v
+----------------------------------------------------------+
|                      Data Layer                            |
|    Bigtable (URL DB) | GFS (documents, index) | Cache      |
+----------------------------------------------------------+
```

### Core Components
1. **Crawler** - Fetches web pages with politeness controls
2. **Indexer** - Tokenizes and builds inverted index
3. **PageRank** - Computes link-based authority scores
4. **Query Processor** - Parses and expands queries
5. **Ranker** - Combines signals for final ordering

## Deep Dive: Web Crawler (8 minutes)

### URL Frontier

The frontier manages which URLs to crawl next while respecting politeness:

```javascript
class URLFrontier {
  constructor() {
    this.hostQueues = new Map()    // host -> URL queue
    this.priorityQueue = new PriorityQueue()  // Next hosts to crawl
    this.hostLastFetch = new Map() // host -> last fetch time
    this.minCrawlDelay = 1000      // 1 second between same host
  }

  async addURL(url, priority) {
    const host = new URL(url).hostname

    // Check robots.txt
    if (!await this.isAllowed(url)) {
      return
    }

    // Check for duplicate
    if (await this.isDuplicate(url)) {
      return
    }

    // Add to host-specific queue
    if (!this.hostQueues.has(host)) {
      this.hostQueues.set(host, [])
    }
    this.hostQueues.get(host).push({ url, priority })

    // Add host to priority queue
    this.priorityQueue.enqueue({ host, priority })
  }

  async getNextURL() {
    while (true) {
      const { host } = this.priorityQueue.dequeue()
      const lastFetch = this.hostLastFetch.get(host) || 0
      const now = Date.now()

      // Politeness: wait between requests to same host
      if (now - lastFetch < this.minCrawlDelay) {
        this.priorityQueue.enqueue({ host, priority: 0 })
        continue
      }

      const queue = this.hostQueues.get(host)
      if (queue && queue.length > 0) {
        const { url } = queue.shift()
        this.hostLastFetch.set(host, now)
        return url
      }
    }
  }
}
```

### Crawler Implementation

```javascript
class WebCrawler {
  async crawl(url) {
    // Fetch with timeout
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Googlebot/2.1' },
      timeout: 10000
    })

    if (!response.ok) {
      await this.recordError(url, response.status)
      return
    }

    const html = await response.text()

    // Content deduplication via SimHash
    const contentHash = this.simHash(html)
    if (await this.isContentDuplicate(contentHash)) {
      return  // Duplicate content
    }

    // Parse and extract
    const parsed = this.parseHTML(html)

    // Store document
    await this.storeDocument(url, {
      content: parsed.text,
      title: parsed.title,
      links: parsed.links,
      fetchTime: Date.now(),
      contentHash
    })

    // Add discovered links to frontier
    for (const link of parsed.links) {
      const absoluteUrl = new URL(link, url).href
      const priority = this.calculatePriority(absoluteUrl)
      await this.frontier.addURL(absoluteUrl, priority)
    }
  }

  calculatePriority(url) {
    // Higher priority for:
    // - Known important domains
    // - Pages with many inlinks
    // - Fresh content (news sites)
    let priority = 0.5

    if (this.importantDomains.has(new URL(url).hostname)) {
      priority += 0.3
    }

    const inlinkCount = this.getInlinkCount(url)
    priority += Math.min(0.2, inlinkCount / 1000)

    return priority
  }
}
```

### robots.txt Handling

```javascript
class RobotsTxtParser {
  constructor() {
    this.cache = new Map()  // host -> rules
  }

  async isAllowed(url, userAgent = 'Googlebot') {
    const host = new URL(url).hostname

    // Get cached or fetch robots.txt
    let rules = this.cache.get(host)
    if (!rules) {
      rules = await this.fetchAndParse(host)
      this.cache.set(host, rules)
    }

    // Check against rules
    const path = new URL(url).pathname
    for (const rule of rules) {
      if (rule.userAgent === '*' || rule.userAgent === userAgent) {
        for (const disallow of rule.disallow) {
          if (path.startsWith(disallow)) {
            return false
          }
        }
      }
    }

    return true
  }
}
```

## Deep Dive: Inverted Index (8 minutes)

### Index Construction

```javascript
class IndexBuilder {
  async buildIndex(documents) {
    const invertedIndex = new Map()  // term -> postings list

    for (const doc of documents) {
      const tokens = this.tokenize(doc.content)

      for (let position = 0; position < tokens.length; position++) {
        const term = this.normalize(tokens[position])

        if (!invertedIndex.has(term)) {
          invertedIndex.set(term, [])
        }

        // Find or create posting for this document
        let posting = invertedIndex.get(term).find(p => p.docId === doc.id)
        if (!posting) {
          posting = {
            docId: doc.id,
            positions: [],
            termFreq: 0,
            fieldWeights: { title: 0, body: 0, anchor: 0 }
          }
          invertedIndex.get(term).push(posting)
        }

        posting.positions.push(position)
        posting.termFreq++
      }

      // Title terms get higher weight
      const titleTokens = this.tokenize(doc.title)
      for (const token of titleTokens) {
        const term = this.normalize(token)
        const posting = invertedIndex.get(term)?.find(p => p.docId === doc.id)
        if (posting) {
          posting.fieldWeights.title++
        }
      }
    }

    // Calculate IDF and final scores
    const docCount = documents.length
    for (const [term, postings] of invertedIndex) {
      const idf = Math.log(docCount / postings.length)

      for (const posting of postings) {
        const tf = 1 + Math.log(posting.termFreq)
        posting.tfidf = tf * idf
      }
    }

    return invertedIndex
  }

  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && !this.stopwords.has(t))
  }

  normalize(term) {
    // Stemming (Porter stemmer)
    return this.stemmer.stem(term)
  }
}
```

### Index Sharding

```javascript
class IndexSharder {
  // Shard by term hash for efficient query routing
  async shardIndex(invertedIndex, numShards) {
    const shards = Array.from({ length: numShards }, () => new Map())

    for (const [term, postings] of invertedIndex) {
      const shardId = this.hashTerm(term) % numShards
      shards[shardId].set(term, postings)
    }

    // Write each shard
    for (let i = 0; i < numShards; i++) {
      await this.writeToStorage(`index-shard-${i}`, shards[i])
    }
  }

  hashTerm(term) {
    // Consistent hash for even distribution
    let hash = 0
    for (const char of term) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0
    }
    return hash
  }
}
```

## Deep Dive: PageRank (5 minutes)

### Algorithm Implementation

```javascript
class PageRank {
  constructor(dampingFactor = 0.85, maxIterations = 100) {
    this.d = dampingFactor
    this.maxIterations = maxIterations
    this.convergenceThreshold = 0.0001
  }

  async calculate(linkGraph) {
    const pages = Object.keys(linkGraph)
    const n = pages.length

    // Initialize uniform PageRank
    let ranks = {}
    for (const page of pages) {
      ranks[page] = 1 / n
    }

    // Build reverse index (inlinks)
    const inlinks = this.buildInlinks(linkGraph)

    // Iterative calculation
    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const newRanks = {}

      for (const page of pages) {
        let sum = 0

        // Sum PageRank from linking pages
        for (const inlink of (inlinks[page] || [])) {
          const outDegree = linkGraph[inlink]?.length || 1
          sum += ranks[inlink] / outDegree
        }

        // PageRank formula with damping
        newRanks[page] = (1 - this.d) / n + this.d * sum
      }

      // Check convergence
      let maxDiff = 0
      for (const page of pages) {
        maxDiff = Math.max(maxDiff, Math.abs(ranks[page] - newRanks[page]))
      }

      ranks = newRanks

      if (maxDiff < this.convergenceThreshold) {
        console.log(`Converged after ${iteration + 1} iterations`)
        break
      }
    }

    return ranks
  }

  buildInlinks(linkGraph) {
    const inlinks = {}

    for (const [page, outlinks] of Object.entries(linkGraph)) {
      for (const target of outlinks) {
        if (!inlinks[target]) {
          inlinks[target] = []
        }
        inlinks[target].push(page)
      }
    }

    return inlinks
  }
}
```

## Deep Dive: Query Processing and Ranking (5 minutes)

### Query Parser

```javascript
class QueryProcessor {
  parseQuery(queryString) {
    const result = {
      terms: [],
      phrases: [],
      excluded: [],
      site: null
    }

    // Handle quoted phrases: "exact match"
    const phraseRegex = /"([^"]+)"/g
    let match
    while ((match = phraseRegex.exec(queryString)) !== null) {
      result.phrases.push(match[1])
    }
    queryString = queryString.replace(/"[^"]+"/g, '')

    // Handle exclusions: -term
    const excludeRegex = /-(\w+)/g
    while ((match = excludeRegex.exec(queryString)) !== null) {
      result.excluded.push(match[1])
    }
    queryString = queryString.replace(/-\w+/g, '')

    // Handle site filter: site:example.com
    const siteMatch = queryString.match(/site:(\S+)/i)
    if (siteMatch) {
      result.site = siteMatch[1]
      queryString = queryString.replace(/site:\S+/i, '')
    }

    // Remaining terms
    result.terms = queryString.split(/\s+/).filter(t => t.length > 0)

    return result
  }
}
```

### Two-Phase Ranking

```javascript
class Ranker {
  async rank(query, candidateDocs) {
    // Phase 1: Fast scoring (cheap signals)
    const phase1Scored = candidateDocs.map(doc => ({
      doc,
      score: this.fastScore(doc, query)
    }))

    // Take top 1000 for expensive re-ranking
    phase1Scored.sort((a, b) => b.score - a.score)
    const topCandidates = phase1Scored.slice(0, 1000)

    // Phase 2: Expensive scoring (all signals)
    const phase2Scored = await Promise.all(
      topCandidates.map(async ({ doc }) => ({
        doc,
        score: await this.fullScore(doc, query)
      }))
    )

    phase2Scored.sort((a, b) => b.score - a.score)
    return phase2Scored.slice(0, 10)  // Top 10 results
  }

  fastScore(doc, query) {
    // BM25 text relevance only
    return this.bm25(doc, query.terms)
  }

  async fullScore(doc, query) {
    // Multiple signals with learned weights
    const textScore = this.bm25(doc, query.terms)
    const pageRank = await this.getPageRank(doc.id)
    const freshness = this.freshness(doc.lastModified)
    const clickScore = await this.getClickThrough(doc.id, query)

    return (
      textScore * 0.35 +
      pageRank * 0.25 +
      freshness * 0.15 +
      clickScore * 0.25
    )
  }

  bm25(doc, terms) {
    const k1 = 1.2
    const b = 0.75
    let score = 0

    for (const term of terms) {
      const tf = doc.termFreqs[term] || 0
      const idf = this.getIDF(term)
      const dl = doc.length
      const avgdl = this.avgDocLength

      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avgdl))
      score += tfNorm * idf
    }

    return score
  }
}
```

## Trade-offs and Alternatives (5 minutes)

### 1. Index Sharding: By Term vs By Document

**Chose: Shard by term**
- Pro: All postings for a term on one shard
- Pro: Simple query routing
- Pro: Even load distribution
- Con: Multi-shard queries for multi-term queries
- Alternative: Shard by document (simpler but less efficient queries)

### 2. Two-Phase vs Single-Phase Ranking

**Chose: Two-phase ranking**
- Pro: Meets latency requirements
- Pro: Only compute expensive signals for top candidates
- Con: May miss some relevant documents
- Alternative: Single phase (simpler but too slow)

### 3. PageRank: Batch vs Incremental

**Chose: Batch computation**
- Pro: Simpler implementation
- Pro: PageRank is relatively stable
- Con: Stale for new pages
- Alternative: Incremental updates (more complex)

### 4. Freshness: Crawl Priority vs Real-Time

**Chose: Crawl priority for news sites**
- Pro: Cost-effective at scale
- Pro: Good enough for most queries
- Con: May miss breaking news
- Alternative: Real-time ingestion for news (expensive)

### Database Schema

```sql
-- URL Database (crawl state)
CREATE TABLE urls (
  url_hash BIGINT PRIMARY KEY,
  url TEXT NOT NULL,
  last_crawl TIMESTAMP,
  crawl_status VARCHAR(20),
  content_hash BIGINT,
  page_rank DECIMAL,
  inlink_count INTEGER DEFAULT 0
);

-- Documents
CREATE TABLE documents (
  id BIGINT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT,
  content TEXT,
  fetch_time TIMESTAMP,
  length INTEGER
);

-- Link Graph
CREATE TABLE links (
  source_url_hash BIGINT,
  target_url_hash BIGINT,
  anchor_text TEXT,
  PRIMARY KEY (source_url_hash, target_url_hash)
);

-- Query Logs (for click-through learning)
CREATE TABLE query_logs (
  id BIGSERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  clicked_urls JSONB,
  timestamp TIMESTAMP DEFAULT NOW()
);
```

## Closing Summary (1 minute)

"Google Search is built around three key systems:

1. **Polite crawling** - The URL frontier manages crawl priority while respecting robots.txt and rate limits. SimHash deduplication prevents storing duplicate content.

2. **Inverted index with sharding** - Sharding by term hash ensures all postings for a term are on one shard, enabling efficient query execution. Each shard is replicated for availability.

3. **Two-phase ranking** - Phase 1 uses cheap BM25 scoring to get top 1000 candidates. Phase 2 applies expensive signals (PageRank, click-through, freshness) only to those candidates.

The main trade-off is freshness vs. cost. We can't crawl every page every minute, so we use priority-based crawling that favors important and frequently-changing pages. For breaking news, dedicated real-time pipelines would be needed."
