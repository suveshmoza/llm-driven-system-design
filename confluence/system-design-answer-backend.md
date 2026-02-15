# System Design: Confluence Wiki (Backend Focus)

## 🎯 1. Requirements Clarification

> "Before diving in, let me clarify scope. We are building a wiki-based knowledge management platform where teams create, organize, and collaborate on documentation within spaces. The key backend challenges I want to focus on: the hierarchical page tree model and efficient tree queries, the Elasticsearch indexing pipeline with consistency guarantees, version control with diff computation, the macro expansion service, and the content approval workflow state machine. I will scope out real-time collaborative editing, file attachments, and PDF export."

**Functional:**
- Create and manage **spaces** as organizational containers for pages
- Hierarchical **page tree** with parent-child relationships within each space
- **Rich-text content** with embedded macros (info, warning, note, code, toc)
- **Version control** for every page edit with full diff capability between any two versions
- **Full-text search** across all spaces with filtering, highlighting, and relevance scoring
- **Threaded comments** on pages with resolve/unresolve capability
- **Content approval workflow** (request review, approve, reject)
- **Labels/tags** for cross-cutting categorization
- **Templates** for standardized page creation

**Non-Functional:**

| Requirement | Target |
|-------------|--------|
| Page load latency (p99) | < 200ms |
| Search latency (p99) | < 500ms |
| Availability | 99.95% |
| Concurrent editors | 10,000+ |
| Total pages | 100M+ |
| Daily page views | 50M+ |
| Daily page edits | 1M+ |
| Consistency | Strong for page writes, eventual for search index |

---

## 📊 2. Capacity Estimation

> "At production scale: 500K active users with 10K concurrent, 100M pages across 50K spaces. Average page is 50KB HTML plus 10KB plain text. With 1M edits per day, that is roughly 12 edits per second on average, with bursts up to 100/s during business hours. 5M search queries per day translates to about 58 queries per second. Storage is 100M pages at 50KB each, roughly 5TB of content plus version history."

| Metric | Value |
|--------|-------|
| Pages created per second (avg) | ~12 |
| Search queries per second | ~58 |
| Page views per second | ~580 |
| Storage (content + versions) | ~5TB + ~10TB versions |
| Read-to-write ratio | ~50:1 |

> "The read-heavy ratio tells me caching page content and page tree structures aggressively will yield significant database offloading. The search QPS is moderate enough that a well-configured Elasticsearch cluster can handle it without sharding."

---

## 🏗️ 3. High-Level Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Clients   │────▶│  API Gateway│────▶│  API Servers│
│  (Browser)  │     │ (Rate Limit)│     │  (Express)  │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                    ┌──────────┬────────────────┼────────────┐
                    ▼          ▼                ▼            ▼
              ┌──────────┐ ┌──────────┐  ┌──────────┐ ┌──────────┐
              │PostgreSQL│ │  Redis   │  │ RabbitMQ │ │  Search  │
              │ (Pages,  │ │ (Cache + │  │ (page-   │ │  Indexer │
              │ Versions,│ │ Sessions)│  │  index   │ │ (Worker) │
              │ Spaces)  │ └──────────┘  │  queue)  │ └────┬─────┘
              └──────────┘               └──────────┘      │
                                                     ┌─────▼──────┐
                                                     │Elasticsearch│
                                                     │(Full-text   │
                                                     │ search)     │
                                                     └────────────┘
```

> "The core insight is the asynchronous indexing pipeline. Page writes go directly to PostgreSQL (source of truth) and publish a message to RabbitMQ. A background worker consumes these messages and indexes content into Elasticsearch. This decouples write latency from search indexing latency -- a page edit takes 50ms regardless of how long ES indexing takes. The trade-off is a brief window where search results are stale, but for a wiki this is acceptable."

---

## 💾 4. Data Model

### Entity Relationship

```
┌──────────┐     ┌──────────────────┐     ┌─────────────────┐
│  spaces  │────▶│      pages       │────▶│  page_versions  │
│          │     │                  │     │                 │
│ id       │     │ id               │     │ id              │
│ key      │     │ space_id (FK)    │     │ page_id (FK)    │
│ name     │     │ parent_id (self) │     │ version_number  │
│ homepage │     │ title, slug      │     │ title           │
│ is_public│     │ content_json     │     │ content_json    │
└──────────┘     │ content_html     │     │ content_html    │
     │           │ content_text     │     │ change_message  │
     ▼           │ version          │     │ created_by (FK) │
┌──────────┐     │ status           │     └─────────────────┘
│  space_  │     │ position         │
│ members  │     │ created_by (FK)  │
│          │     └──────────────────┘
│ space_id │           │
│ user_id  │           ▼
│ role     │     ┌──────────────────┐
└──────────┘     │    comments      │
                 │ page_id (FK)     │
                 │ parent_id (self) │
                 │ content          │
                 │ is_resolved      │
                 └──────────────────┘
```

### Core Tables

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| spaces | id (UUID PK), key (unique), name, description, homepage_id (FK), is_public, created_by (FK) | key | Organizational container for pages |
| pages | id (UUID PK), space_id (FK), parent_id (self FK), title, slug, content_json (JSONB), content_html (TEXT), content_text (TEXT), version (INT), status, position (INT), created_by (FK) | (space_id, parent_id, position), (space_id, slug) | Adjacency list tree; status: draft/published/archived |
| page_versions | id (UUID PK), page_id (FK), version_number (INT), title, content_json, content_html, content_text, change_message, created_by (FK) | (page_id, version_number DESC) | Immutable history; one row per edit |
| comments | id (UUID PK), page_id (FK), parent_id (self FK), content (TEXT), is_resolved (BOOL), created_by (FK) | (page_id, created_at) | Threaded via self-referencing parent_id |
| space_members | id (UUID PK), space_id (FK), user_id (FK), role | UNIQUE(space_id, user_id) | Role: admin, member, viewer |
| page_labels | page_id (FK), label_id (FK) | UNIQUE(page_id, label_id) | Many-to-many for cross-cutting tagging |
| approvals | id (UUID PK), page_id (FK), requested_by (FK), reviewed_by (FK), status, version_number | (page_id, status) | Status: pending, approved, rejected |

### Triple Content Storage

> "I store page content in three parallel columns: `content_json` (JSONB) holds structured content including macro nodes for programmatic access and macro expansion. `content_html` (TEXT) holds the rendered HTML that the frontend displays directly. `content_text` (TEXT) holds stripped plain text used for full-text search indexing. This triple storage means reads never need to re-parse or re-render -- each consumer gets the format it needs directly. The trade-off is storage overhead (roughly 3x per page), but at 50KB average page size this is negligible compared to the performance benefit."

---

## 🔌 5. API Design

### Authentication

```
POST /api/v1/auth/register    -> Create account
POST /api/v1/auth/login       -> Start session (Redis-backed)
POST /api/v1/auth/logout      -> Destroy session
GET  /api/v1/auth/me          -> Return current user
```

### Space Operations

```
POST   /api/v1/spaces                  -> Create space with key and name
GET    /api/v1/spaces                  -> List user's spaces
GET    /api/v1/spaces/:key             -> Get space with page tree
POST   /api/v1/spaces/:id/members      -> Add member with role
DELETE /api/v1/spaces/:id/members/:uid -> Remove member
```

### Page Operations

```
POST   /api/v1/pages                            -> Create page in space
GET    /api/v1/pages/space/:key/slug/:slug       -> Get page by space key + slug
PUT    /api/v1/pages/:id                         -> Update page (creates version)
DELETE /api/v1/pages/:id                         -> Soft-delete (archive)
PUT    /api/v1/pages/:id/move                    -> Move page (change parent/position)
GET    /api/v1/pages/:id/versions                -> List version history
GET    /api/v1/pages/:id/versions/:v1/diff/:v2   -> Diff between two versions
```

### Search, Comments, Approvals

```
GET    /api/v1/search?q=query&space=KEY          -> Full-text search with ES
POST   /api/v1/pages/:id/comments                -> Add comment (supports threading)
PATCH  /api/v1/comments/:id/resolve              -> Toggle resolve status
POST   /api/v1/pages/:id/approvals               -> Request approval
PATCH  /api/v1/approvals/:id                     -> Approve or reject
```

> "All endpoints require session authentication. Rate limits are applied per-user: 500 requests per 15 minutes for general API, 20 per 15 minutes for auth endpoints. Page writes invalidate Redis cache keys using pattern-based deletion (space tree cache and individual page cache)."

---

## 🔧 6. Deep Dive: Search Pipeline Consistency

> "The most interesting backend challenge is keeping Elasticsearch consistent with PostgreSQL without adding latency to page operations."

### The Pipeline

```
Page Create/Update
       │
       ├──▶ PostgreSQL (sync, in transaction)
       │         └── page record + version record
       │
       └──▶ RabbitMQ (async, after commit)
                  │
                  ▼
            Search Indexer Worker
                  │
                  ├── Fetch page from PostgreSQL (fresh read)
                  │
                  └── Index to Elasticsearch
                        ┌──────────────────────┐
                        │ page_id (keyword)     │
                        │ space_id (keyword)    │
                        │ title (text, boost 3x)│
                        │ content_text (text)   │
                        │ labels (keyword[])    │
                        │ status (keyword)      │
                        └──────────────────────┘
```

### Consistency Challenges

**Problem 1: Message ordering.** If a user edits a page twice rapidly, two messages enter the queue. If worker A processes the second message before worker B processes the first, Elasticsearch ends up with stale content.

> "I solve this by including the `version` number in the queue message and checking it during indexing. The worker reads the current version from PostgreSQL before indexing. If the page version in the database is newer than what the message contains, the worker fetches the latest version and indexes that instead. This makes the indexer idempotent -- processing the same message twice always converges to the current state."

**Problem 2: RabbitMQ unavailable.** If the message broker is down, page edits should still succeed.

> "The publish-to-queue step happens after the PostgreSQL transaction commits, wrapped in a try-catch. If RabbitMQ is unavailable, the page edit succeeds but no index message is published. To recover, I run a periodic reconciliation job that scans PostgreSQL for pages with `updated_at` newer than the latest indexed timestamp in Elasticsearch. This catch-up mechanism ensures eventual consistency even after broker failures."

**Problem 3: Elasticsearch unavailable.** The worker cannot index if ES is down.

> "The worker uses a circuit breaker around Elasticsearch calls. When the circuit opens, messages are requeued with a delay (using RabbitMQ dead-letter exchange with TTL). This prevents the worker from spinning on failed index attempts. The circuit enters half-open state after 30 seconds, allowing a test request through."

### Fallback to PostgreSQL

> "When Elasticsearch is completely unavailable for search queries, the API falls back to PostgreSQL ILIKE search on the `content_text` and `title` columns. This is significantly slower (no relevance scoring, no highlighting, no stemming) but ensures search functionality degrades gracefully rather than failing entirely."

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Async indexing via RabbitMQ | Non-blocking writes, independently scalable workers | Brief staleness window, message ordering complexity |
| ❌ Synchronous ES writes | Instant search consistency | 50-200ms added to every page edit, ES failure blocks writes |
| ✅ PostgreSQL ILIKE fallback | Always available, no extra infra | No relevance scoring, O(n) scan, no highlighting |
| ❌ No fallback | Simpler code | Search completely unavailable during ES outages |

---

## 🔧 7. Deep Dive: Version Control and Conflict Resolution

> "Every page edit creates an immutable version record. This is the backbone of the wiki -- users must be able to see what changed, who changed it, and revert if needed."

### Version Creation Flow

```
Client sends PUT /pages/:id
       │
       ▼
BEGIN TRANSACTION
├── SELECT version FROM pages WHERE id = $1 FOR UPDATE
│        └── Lock the row to prevent concurrent version creation
├── new_version = current_version + 1
├── UPDATE pages SET content_html = $2, content_text = $3,
│                    version = new_version, updated_by = $4
├── INSERT INTO page_versions (page_id, version_number, title,
│        content_json, content_html, content_text, change_message, created_by)
COMMIT
       │
       ▼
Invalidate Redis cache (page + space tree)
Publish to RabbitMQ (page-index queue)
```

> "The `SELECT ... FOR UPDATE` is critical. Without it, two concurrent edits could both read version=3, both try to create version=4, and one would either fail on a unique constraint or silently overwrite the other. The row lock serializes concurrent edits, ensuring version numbers are always sequential with no gaps."

### Diff Computation

> "Diffs are computed on-demand, not stored. When a user requests the diff between version 2 and version 5, the API loads both version records from `page_versions` and runs a line-level diff algorithm on the `content_html` content. Each change is classified as added, removed, or unchanged."

```
Version 2                    Version 5
┌──────────────────┐         ┌──────────────────┐
│ Line 1 (same)    │         │ Line 1 (same)    │
│ Line 2 (removed) │   ──▶   │ Line 2a (added)  │
│ Line 3 (same)    │         │ Line 3 (same)    │
│                   │         │ Line 4 (added)   │
└──────────────────┘         └──────────────────┘
```

### Why Not Store Pre-computed Diffs?

> "I considered storing diffs rather than full content for each version. This would save storage (a typical edit changes 5% of a page, so storing only the delta would be ~20x smaller). But the trade-off is reconstruction cost: to view version N, you would need to replay N diffs from the base version, which is O(N) in version count. For a frequently edited page with 500 versions, reconstructing the latest version means applying 500 sequential patches. Storing full snapshots makes any version retrievable in O(1) at the cost of storage. At 50KB per version and 1M edits per day, that is 50GB/day of version storage -- significant but manageable with blob storage tiering. The simplicity and performance of O(1) retrieval justifies the storage cost."

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Full snapshots per version | O(1) retrieval, simple diff between any two versions | Higher storage (full copy per edit) |
| ❌ Delta-only storage | 20x storage reduction | O(N) reconstruction, complex merge logic |
| ✅ On-demand diff computation | No storage for diffs, flexible comparison pairs | CPU cost on each diff request |
| ❌ Pre-computed diffs | Instant diff display | Only adjacent version diffs; comparing v2 to v8 requires chaining |

---

## 🔧 8. Deep Dive: Page Tree Performance at Scale

### The Adjacency List Model

> "Each page has a `parent_id` that references another page in the same space. The root pages have `parent_id = NULL`. A `position` integer controls ordering among siblings. This is the simplest tree model -- a single self-referencing foreign key."

### Tree Operations

**Loading the full tree:** The API loads all pages for a space in a single query (SELECT id, parent_id, title, slug, position FROM pages WHERE space_id = $1 ORDER BY position), then builds the tree in-memory by mapping parent_id to children arrays.

> "For a space with 500 pages, this query returns 500 rows (roughly 25KB of data) and the in-memory tree construction takes under 1ms. The result is cached in Redis for 120 seconds. This approach works because wiki spaces are typically bounded: even large engineering organizations rarely exceed 2,000 pages per space."

**Breadcrumb queries:** To display the breadcrumb trail (Home > Engineering > Backend > API Design), I use a recursive CTE that walks up the ancestor chain from the current page.

```
Current page (API Design)
       │ parent_id
       ▼
  Backend page
       │ parent_id
       ▼
  Engineering page
       │ parent_id
       ▼
  Home page (parent_id = NULL, stop)

Result: [Home, Engineering, Backend, API Design]
```

> "The recursive CTE terminates when it reaches a page with NULL parent_id. For a tree 5 levels deep, this is 5 index lookups on the primary key -- essentially free. The composite index on (space_id, parent_id, position) ensures sibling queries and subtree operations are efficient."

**Moving pages:** Changing a page's position in the tree requires updating its `parent_id` and `position`, then reordering siblings at both the source and destination. This is wrapped in a transaction to prevent orphaned nodes.

### When Adjacency List Breaks Down

> "The adjacency list model struggles with one operation: subtree queries. 'Find all descendants of page X' requires either a recursive CTE (which performs one index lookup per level) or loading the full tree and filtering in-memory. For a 5-level tree this is fast, but for a 50-level tree (deeply nested documentation) it becomes expensive."

> "Nested sets would make subtree queries O(1) -- a single range query on left/right values -- but every insert or move requires recalculating left/right values for potentially thousands of nodes. For a wiki where page moves happen frequently (reorganizing documentation) but deep subtree queries are rare, the adjacency list trade-off is correct."

| Approach | Tree Load | Page Move | Subtree Query | Complexity |
|----------|-----------|-----------|---------------|------------|
| ✅ Adjacency list | O(n) load + build | O(1) parent update | O(depth) CTE | Low |
| ❌ Nested sets | O(log n) range | O(n) recalculate | O(1) range | Medium |
| ❌ Materialized path | O(n) prefix match | O(n) path rewrite | O(1) prefix | Low |

---

## 🗄️ 9. Caching Strategy

| Data | Cache Key Pattern | TTL | Invalidation |
|------|-------------------|-----|--------------|
| Page content | page:{spaceKey}:{slug} | 120s | On page edit |
| Space page tree | space-tree:{spaceKey} | 120s | On page create/edit/move/delete |
| Breadcrumbs | breadcrumbs:{pageId} | 300s | On page move or ancestor change |
| Search results | Not cached | - | Always fresh from ES |
| User session | sess:{sessionId} | 24h | On logout |

> "I use pattern-based cache invalidation: when a page is edited, I delete both the page cache key and the space tree cache key. This is simpler than tracking dependencies between cache entries. The 120-second TTL provides a safety net -- even if invalidation misses a key, staleness is bounded."

---

## 🔄 10. Macro Expansion Service

> "Macros are structured content blocks stored as nodes in the `content_json` JSONB column. The macro service expands these nodes into styled HTML during page save and also supports client-side rendering."

### Macro Types

| Macro | Input | Output | Use Case |
|-------|-------|--------|----------|
| info | Text content | Blue-bordered callout box | Informational highlights |
| warning | Text content | Yellow-bordered callout box | Warnings and cautions |
| note | Text content | Purple-bordered callout box | Side notes |
| code | Code string + language | Syntax-highlighted block | Code snippets |
| toc | None (auto-generated) | Ordered list of heading links | Page navigation |

> "The TOC macro is interesting because it must be regenerated on every page save. The service scans the content_html for heading tags (h1-h6), extracts their text and nesting level, and generates an ordered list with anchor links. This means the TOC is always consistent with the actual page headings."

---

## 📈 11. Scalability Path

### What Breaks First

> "The first bottleneck is the page_versions table. With 1M edits per day, this table grows by 1M rows daily -- 365M rows per year. Each row contains full HTML content (50KB average), so the table grows by 50GB per day. After a year, it is 18TB of version data."

**Mitigation:** Partition `page_versions` by `created_at` (monthly partitions). Recent versions (last 90 days) stay on fast SSD storage. Older partitions are moved to cheaper HDD-backed tablespace. The vast majority of version access is recent (users reviewing last few edits), so this hot/cold split optimizes for the common case.

### Horizontal Scaling Path

1. **Read replicas** for page queries (read-heavy workload)
2. **Shard PostgreSQL by space_id** -- all pages within a space are co-located, and cross-space queries are rare
3. **Scale Elasticsearch** horizontally with index sharding (by space_id routing)
4. **Replace RabbitMQ with Kafka** for higher-throughput indexing at extreme scale
5. **CDN** for static page content that does not change frequently
6. **CRDT-based collaborative editing** via WebSocket for real-time co-editing

---

## 🛡️ 12. Security and Auth

> "Session-based authentication with Redis-backed store. Sessions expire after 24 hours. Passwords are hashed with bcrypt (12 salt rounds)."

**Space-level access control:**

| Role | Read Pages | Edit Pages | Manage Members | Delete Space |
|------|-----------|------------|----------------|-------------|
| Viewer | Yes | No | No | No |
| Member | Yes | Yes | No | No |
| Admin | Yes | Yes | Yes | Yes |

> "All page operations check space membership before proceeding. This is a simple RBAC model -- production would add page-level permissions, group-based access, and anonymous viewing for public spaces."

---

## 🔍 13. Observability

| Metric | Type | Purpose |
|--------|------|---------|
| http_request_duration_seconds | Histogram | Latency percentiles per endpoint |
| page_operations_total | Counter | Create/update/delete volume by operation type |
| search_duration_seconds | Histogram | Search latency separate from general HTTP |
| search_fallback_total | Counter | How often PostgreSQL fallback is triggered |
| indexer_lag_seconds | Gauge | Time between page edit and ES index |
| version_count_per_page | Histogram | Distribution of version counts |
| circuit_breaker_state | Gauge | 0=closed, 1=open, 2=half-open |

> "Structured JSON logging via Pino includes request IDs for distributed tracing. The most important alert is indexer lag exceeding 60 seconds, which indicates the search pipeline is falling behind and users are seeing stale search results."

---

## ⚖️ 14. Trade-offs Summary

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Adjacency list (page tree) | Simple writes, O(1) move | O(depth) ancestor queries |
| ❌ Nested sets | O(1) subtree queries | O(n) writes on insert/move |
| ✅ Full version snapshots | O(1) retrieval of any version | Higher storage per edit |
| ❌ Delta-only versions | 20x storage savings | O(N) reconstruction cost |
| ✅ Async ES indexing via RabbitMQ | Non-blocking page writes | Brief search staleness |
| ❌ Sync ES writes | Instant search consistency | 50-200ms per page edit |
| ✅ Triple content storage (JSON/HTML/text) | Zero-cost format conversion on read | 3x storage per page |
| ❌ Single format with on-demand conversion | Minimal storage | CPU cost on every read |
| ✅ ES with PostgreSQL ILIKE fallback | Graceful degradation | Two search code paths to maintain |
| ❌ ES only, no fallback | Simpler code | Search unavailable during ES outages |
| ✅ Session auth (Redis) | Immediate revocation | Requires Redis for auth |
| ❌ JWT | Stateless auth | No immediate revocation without blacklist |
