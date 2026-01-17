# Web Crawler - Architecture Design

## 1. Goals and Non-Goals

### Goals (v1)
- Crawl public HTML pages over HTTP(S)
- Discover and deduplicate URLs
- Obey `robots.txt` and basic politeness rules (rate limiting per domain)
- Extract page text, metadata, and outgoing links
- Scale horizontally to millions of pages
- Provide real-time observability via dashboard
- Be operable in production

### Non-Goals (v1)
- Full JavaScript rendering (SPA support deferred to v2)
- PageRank or advanced ranking algorithms
- Full-text search indexing
- Near-real-time freshness guarantees
- Anti-bot evasion or stealth crawling
- Content storage in object storage (raw HTML archival)

---

## 2. Requirements

### Functional Requirements

1. **URL Discovery**: Extract and discover new links from crawled pages
2. **Page Fetching**: Download HTML content from web servers with proper error handling
3. **Content Extraction**: Parse HTML to extract titles, descriptions, and links
4. **Politeness**: Respect robots.txt, implement per-domain rate limiting
5. **Deduplication**: Avoid crawling duplicate URLs or duplicate content
6. **Prioritization**: Crawl important pages first (seeds, shallow pages)

### Non-Functional Requirements

| Requirement | Target (Local) | Target (Production) |
|-------------|----------------|---------------------|
| Crawl rate | 10-50 pages/sec | 400+ pages/sec |
| Workers | 3-5 | 80-150 |
| Availability | Workers fail independently | 99.9% uptime |
| Dashboard latency | < 5s updates | < 1s updates |
| Consistency | Eventual (small duplicate window) | Eventual |

---

## 3. Capacity Estimation

| Metric | Local Scale | Production Scale |
|--------|-------------|------------------|
| Target crawl rate | 10-50 pages/second | 400+ pages/second |
| Workers | 3-5 | 80-150 |
| Storage per page | ~20KB compressed | ~20KB compressed |
| URL frontier size | 100K URLs | Billions of URLs |
| URL metadata | 100 bytes/URL | 100 bytes/URL |
| robots.txt cache | ~1MB | ~100GB |

---

## 4. High-Level Architecture

### System Diagram

```
                    +------------------+
                    |   Frontend       |
                    |   Dashboard      |
                    |   (React/Vite)   |
                    +--------+---------+
                             |
                    +--------v---------+
                    |   API Server     |
                    |   (Express.js)   |
                    |   Port: 3001     |
                    +--------+---------+
                             |
         +-------------------+-------------------+
         |                   |                   |
+--------v-------+  +--------v-------+  +--------v-------+
| Fetcher        |  | Fetcher        |  | Fetcher        |
| Worker 1       |  | Worker 2       |  | Worker N       |
+-------+--------+  +--------+-------+  +--------+-------+
        |                    |                   |
        +--------------------+-------------------+
                             |
        +--------------------+--------------------+
        |                    |                    |
+-------v-------+   +--------v--------+  +--------v--------+
|  URL Frontier |   | Robots Service  |  | Parser/Link     |
|  (PostgreSQL) |   | (Redis Cache)   |  | Extractor       |
+-------+-------+   +-----------------+  +--------+--------+
        |                                         |
+-------v-------+                        +--------v--------+
| UrlTable      |                        | URL Ingestion   |
| (Metadata)    |                        | Service         |
+---------------+                        +-----------------+
        |
+-------v-------+
| Content Store |
| (Optional S3) |
+---------------+
```

### Core Components

| Component | Responsibility |
|-----------|---------------|
| **API Server** | RESTful API for dashboard, seed injection, stats |
| **Fetcher Workers** | Stateless workers that fetch pages |
| **URL Frontier** | Priority queue deciding what to crawl next |
| **Robots Service** | Fetch, cache, and query robots.txt rules |
| **Parser/Extractor** | Extract text, metadata, and links from HTML |
| **URL Ingestion** | Normalize, deduplicate, and enqueue discovered URLs |
| **UrlTable** | Central metadata store for all known URLs |
| **Content Store** | Persist fetched content (v2) |

### Data Flow

1. Seed URLs are inserted into the UrlTable with high priority
2. Frontier schedules URLs for fetching based on priority and politeness
3. Fetcher workers download HTML pages
4. Parser extracts text, metadata, and links
5. Discovered links are normalized and deduplicated
6. New URLs are added back to the frontier
7. Dashboard polls API for real-time statistics

---

## 5. URL Frontier

### Responsibilities
- Decide *what* to crawl next
- Enforce politeness (per-host rate limits)
- Track crawl state and scheduling
- Handle priority-based ordering

### Scheduling Model
- URLs are grouped by host/domain
- Each domain has:
  - Crawl delay (from robots.txt or default 1s)
  - Next-allowed-fetch timestamp
  - Lock to prevent concurrent access
- Frontier selects:
  - The highest-priority URL from an eligible domain
  - Domain must not be rate-limited

### Priority Signals

| Level | Score | Criteria |
|-------|-------|----------|
| High | 3 | Seed URLs, homepages, shallow pages (depth ≤ 2) |
| Medium | 2 | Content pages, blog posts, /about, /contact |
| Low | 1 | Paginated content, archives, deep pages |

### Implementation

```sql
-- URL Frontier: Queue of URLs to crawl
CREATE TABLE url_frontier (
    id SERIAL PRIMARY KEY,
    url TEXT NOT NULL,
    url_hash VARCHAR(64) NOT NULL UNIQUE,
    domain VARCHAR(255) NOT NULL,
    priority INTEGER DEFAULT 1,      -- 1=low, 2=medium, 3=high
    depth INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',  -- pending, in_progress, completed, failed
    scheduled_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_frontier_priority ON url_frontier (priority DESC, scheduled_at ASC);
CREATE INDEX idx_frontier_domain ON url_frontier (domain);
CREATE INDEX idx_frontier_status ON url_frontier (status);
```

---

## 6. UrlTable (Metadata Store)

### Purpose
Central source of truth for all known URLs.

### Logical Schema

| Field | Type | Description |
|-------|------|-------------|
| url_hash | VARCHAR(64) | SHA-256 hash of normalized URL (PK) |
| normalized_url | TEXT | Canonical URL string |
| domain | VARCHAR(255) | Hostname |
| status | ENUM | never_crawled / fetched / failed / blocked |
| http_status | INTEGER | Last HTTP status code |
| last_crawled_at | TIMESTAMP | When last fetched |
| next_crawl_at | TIMESTAMP | When eligible for re-crawl |
| discovered_at | TIMESTAMP | When first seen |
| content_hash | VARCHAR(64) | Hash of extracted content |
| error_count | INTEGER | Consecutive failures |
| title | TEXT | Extracted page title |
| description | TEXT | Meta description |
| links_count | INTEGER | Number of outgoing links |

### Implementation

```sql
-- Crawled Pages: Metadata about fetched pages
CREATE TABLE crawled_pages (
    id SERIAL PRIMARY KEY,
    url TEXT NOT NULL,
    url_hash VARCHAR(64) NOT NULL UNIQUE,
    domain VARCHAR(255) NOT NULL,
    status_code INTEGER,
    content_type VARCHAR(100),
    content_length INTEGER,
    content_hash VARCHAR(64),
    title TEXT,
    description TEXT,
    links_count INTEGER DEFAULT 0,
    crawled_at TIMESTAMP DEFAULT NOW(),
    crawl_duration_ms INTEGER,
    error_message TEXT
);

CREATE INDEX idx_pages_domain ON crawled_pages (domain);
CREATE INDEX idx_pages_crawled_at ON crawled_pages (crawled_at DESC);
```

---

## 7. Fetcher Workers

### Responsibilities
- Fetch HTML pages via HTTP(S)
- Respect timeouts and redirects
- Handle errors gracefully
- Update URL status in frontier

### Behavior

**Input:** FetchTask(url, domain)

**Output:**
- Success → FetchedPage(html, headers, status_code)
- Failure → ErrorEvent(url, error_type, message)

### Constraints

| Constraint | Value |
|------------|-------|
| Max redirects | 5 |
| Request timeout | 30 seconds |
| Max page size | 10 MB |
| User-Agent | Identifies crawler with contact info |

### Implementation

```typescript
interface FetchConfig {
  timeout: 30000,
  maxRedirects: 5,
  maxContentLength: 10 * 1024 * 1024,
  headers: {
    'User-Agent': 'MyCrawler/1.0 (+https://example.com/bot)',
    'Accept': 'text/html,application/xhtml+xml',
  }
}
```

---

## 8. Robots Service

### Responsibilities
- Fetch and parse `robots.txt` per domain
- Cache rules with TTL
- Answer: "Is this URL allowed for our User-Agent?"
- Extract crawl-delay directives

### Behavior

1. On first access to a domain, fetch `/robots.txt`
2. Parse and cache the result
3. Frontier queries before scheduling each URL
4. Respect crawl-delay if specified

### Caching Strategy

| Storage | TTL | Purpose |
|---------|-----|---------|
| Redis | 1 hour | Hot cache for active domains |
| PostgreSQL | Persistent | Backup and analytics |

### Implementation

```sql
-- Domains: Per-domain settings and robots.txt cache
CREATE TABLE domains (
    id SERIAL PRIMARY KEY,
    domain VARCHAR(255) NOT NULL UNIQUE,
    robots_txt TEXT,
    robots_fetched_at TIMESTAMP,
    crawl_delay FLOAT DEFAULT 1.0,
    page_count INTEGER DEFAULT 0,
    is_allowed BOOLEAN DEFAULT true
);
```

```
# Redis keys
crawler:domain:{domain}:robots     - Cached robots.txt content
crawler:domain:{domain}:delay      - Crawl delay for domain
crawler:domain:{domain}:lock       - Rate limit lock (SET NX EX)
```

---

## 9. Parser & Link Extractor

### Responsibilities
- Parse HTML DOM
- Extract clean text and metadata
- Discover and normalize outgoing links

### Parsing Steps

1. Parse DOM with Cheerio
2. Extract:
   - `<title>` content
   - `<meta name="description">` content
   - Visible text
3. Find links:
   - `<a href="...">`
   - `<link href="...">` (canonical, alternate)
4. Resolve relative URLs to absolute
5. Drop unsupported schemes (`mailto:`, `javascript:`, `tel:`)
6. Normalize URLs
7. Deduplicate per page

### Output

```typescript
interface ParsedPage {
  title: string;
  description: string;
  text: string;
  links: string[];
  contentHash: string;
}
```

---

## 10. URL Normalization & Deduplication

### Normalization Rules

1. Lowercase scheme and host
2. Remove fragment (`#...`)
3. Normalize default ports (`:80` for HTTP, `:443` for HTTPS)
4. Sort query parameters alphabetically
5. Remove known tracking params (`utm_*`, `ref`, `source`)
6. Remove trailing slashes (optional, configurable)
7. Decode percent-encoded characters where safe

### Deduplication Strategy

**URL-level:**
- Normalize → SHA-256 hash → lookup in Redis SET
- O(1) membership check

**Content-level (v2):**
- Hash extracted text with SimHash
- Detect near-duplicate pages across URLs

### Implementation

```typescript
function normalizeUrl(url: string): string {
  const parsed = new URL(url);

  // Lowercase
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();

  // Remove fragment
  parsed.hash = '';

  // Remove default ports
  if (parsed.port === '80' || parsed.port === '443') {
    parsed.port = '';
  }

  // Sort query params, remove tracking
  const params = new URLSearchParams(parsed.search);
  const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'ref'];
  trackingParams.forEach(p => params.delete(p));
  parsed.search = [...params].sort().map(([k, v]) => `${k}=${v}`).join('&');

  return parsed.toString();
}
```

```
# Redis deduplication
crawler:visited_urls    - Set of URL hashes (SADD, SISMEMBER)
```

---

## 11. URL Ingestion Service

### Responsibilities
- Consume discovered URLs from parser
- Normalize and deduplicate
- Insert new URLs into UrlTable
- Enqueue eligible URLs into Frontier

### Backpressure Controls

| Control | Value | Purpose |
|---------|-------|---------|
| Max depth | 10 | Prevent crawling infinitely deep |
| Max URLs per page | 1000 | Prevent link spam |
| Rate limit per source | 100/sec | Prevent frontier flooding |

---

## 12. Distributed Coordination

### Problem
Multiple workers must coordinate to avoid hitting the same domain concurrently.

### Solution: Redis Distributed Locks

```typescript
async function acquireDomainLock(domain: string, workerId: string, delaySeconds: number): Promise<boolean> {
  const lockKey = `crawler:domain:${domain}:lock`;
  const result = await redis.set(lockKey, workerId, 'NX', 'EX', delaySeconds);
  return result === 'OK';
}
```

### Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| Redis Locks (chosen) | Simple, auto-expiry, distributed | Slightly less efficient than central scheduler |
| Central Scheduler | Optimal scheduling | Single point of failure |
| Token Bucket | Smooth rate limiting | More complex implementation |

---

## 13. API Design

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check with DB/Redis status |
| GET | `/api/stats` | Comprehensive crawl statistics |
| GET | `/api/stats/timeseries` | Time-series data for charts |
| GET | `/api/frontier/stats` | Frontier queue statistics |
| GET | `/api/frontier/urls` | List URLs in frontier |
| POST | `/api/frontier/add` | Add URLs to frontier |
| POST | `/api/frontier/seed` | Add seed URLs with high priority |
| POST | `/api/frontier/recover` | Recover stale in-progress URLs |
| GET | `/api/pages` | List crawled pages with filtering |
| GET | `/api/domains` | List crawled domains |
| GET | `/api/domains/:domain/robots` | Get cached robots.txt |

---

## 14. Observability

### Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `crawler_pages_fetched_total` | Counter | Total pages fetched |
| `crawler_pages_per_second` | Gauge | Current crawl rate |
| `crawler_fetch_success_rate` | Gauge | Success vs failure ratio |
| `crawler_http_status_*` | Counter | HTTP status distribution |
| `crawler_frontier_size` | Gauge | URLs pending in frontier |
| `crawler_robots_denials` | Counter | URLs blocked by robots.txt |
| `crawler_active_workers` | Gauge | Currently active workers |

### Implementation (Current)

```
# Redis stats keys
crawler:stats:pages_crawled        - Counter
crawler:stats:pages_failed         - Counter
crawler:stats:bytes_downloaded     - Counter
crawler:worker:{id}:heartbeat      - Worker last heartbeat
crawler:active_workers             - Set of active worker IDs
```

### Dashboard Updates
- Polling interval: 5 seconds
- Real-time charts for crawl rate, success rate, status codes

### Alerts (v2)

| Alert | Condition |
|-------|-----------|
| High error rate | 4xx/5xx > 20% for 5 minutes |
| Frontier backlog | Queue growing > 10% per minute |
| Worker crash | No heartbeat for 2 minutes |

---

## 15. Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Runtime | Node.js | Async I/O for network-heavy workload |
| Language | TypeScript | Type safety, better tooling |
| Web Framework | Express.js | API server |
| Database | PostgreSQL | Frontier, metadata, durable storage |
| Cache | Redis/Valkey | Deduplication, locks, robots cache |
| HTML Parser | Cheerio | Fast HTML parsing without JS |
| Robots Parser | robots-parser | robots.txt parsing |
| HTTP Client | Axios | HTTP requests with timeout support |
| Frontend | React 19 + Vite | Dashboard UI |
| Routing | TanStack Router | Type-safe routing |
| State | Zustand | Lightweight state management |
| Styling | Tailwind CSS | Utility-first CSS |

---

## 16. Deployment Model

### Local Development

```bash
# Start infrastructure
docker-compose up -d postgres redis

# Start API server
npm run dev:server1

# Start workers (separate terminals)
WORKER_ID=1 npm run dev:worker
WORKER_ID=2 npm run dev:worker
WORKER_ID=3 npm run dev:worker

# Start frontend
cd frontend && npm run dev
```

### Production (Kubernetes)

- **API Server**: Deployment with 2-3 replicas, HPA
- **Workers**: Deployment with 10-100 replicas, configurable
- **PostgreSQL**: StatefulSet or managed RDS
- **Redis**: StatefulSet or ElastiCache

---

## 17. Security Considerations

| Concern | Mitigation |
|---------|------------|
| Identification | Clear User-Agent with contact info |
| Rate limiting | Max 1 req/sec per domain by default |
| robots.txt | Always checked before crawling |
| Timeouts | 30s request timeout to prevent hanging |
| Page size | 10MB limit to prevent memory exhaustion |
| Dangerous URLs | Skip file:// and other local schemes |

---

## 18. Trade-offs and Alternatives

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Frontier storage | PostgreSQL | Kafka | Simpler, queryable, good enough for learning scale |
| Deduplication | Redis SET | Bloom Filter | Exact dedup, no false positives, acceptable memory |
| Rate limiting | Redis Lock | Token Bucket | Simpler, domain-level granularity sufficient |
| HTML parsing | Cheerio | Puppeteer | Much faster, no JS rendering needed for basic crawl |
| Priority queue | 3-level | Sorted set | Simpler to understand and debug |

---

## 19. Future Extensions (v2+)

| Feature | Description |
|---------|-------------|
| JavaScript rendering | Puppeteer/Playwright pool for SPA sites |
| Near-duplicate detection | SimHash for content similarity |
| Content storage | S3/HDFS for raw HTML archival |
| Sitemap parsing | Extract URLs from sitemap.xml |
| Adaptive scheduling | Learn optimal crawl frequency per domain |
| Link graph storage | Store and analyze link relationships |
| Search indexing | Elasticsearch integration for full-text search |
| Work stealing | Dynamic rebalancing when workers are idle |
| DNS caching | Reduce DNS lookups for repeated domains |
| Per-site configurations | Custom rules for specific domains |

---

## 20. Summary

This v1 crawler:
- Is simple but production-shaped
- Scales horizontally with stateless workers
- Obeys web norms (robots.txt, politeness)
- Produces clean text and a growing URL frontier
- Provides real-time observability via dashboard

It forms a solid foundation for more advanced crawling systems while being runnable on a single laptop for learning purposes.
