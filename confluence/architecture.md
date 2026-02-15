# Confluence Wiki/Knowledge Base - Architecture

## System Overview

Confluence is a wiki-based knowledge management platform that enables teams to create, organize, and collaborate on documentation. The system supports hierarchical page organization within spaces, rich-text content with macros, version control with diffing, full-text search, threaded comments, and content approval workflows.

**Learning Goals:**
- Design a wiki data model with hierarchical page trees
- Implement version control with efficient diff computation
- Build full-text search with Elasticsearch and async indexing
- Create a macro expansion system for structured content
- Design an approval workflow for content governance
- Understand space-based access control patterns

## Requirements

### Functional Requirements
1. Users can create and manage **spaces** (organizational containers for pages)
2. Pages are organized in a **hierarchical tree** within each space
3. Pages support **rich-text editing** with macros (info, warning, note, code, toc)
4. Every page edit creates a **version** with full diff capability
5. **Full-text search** across all spaces with filtering and highlighting
6. **Threaded comments** on pages with resolve/unresolve
7. **Content approval workflow** (request, approve, reject)
8. **Labels/tags** for cross-cutting page categorization
9. **Templates** for standardized page creation

### Non-Functional Requirements (Production Scale)
| Metric | Target |
|--------|--------|
| Page load latency (p99) | < 200ms |
| Search latency (p99) | < 500ms |
| Availability | 99.95% |
| Concurrent editors | 10,000+ |
| Total pages | 100M+ |
| Daily page views | 50M+ |

## Capacity Estimation

### Production Scale
- 500K active users, 10K concurrent
- 100M pages across 50K spaces
- Average page size: 50KB HTML, 10KB text
- 1M page edits/day (creating 1M versions)
- 5M search queries/day
- Storage: 100M pages x 50KB = 5TB content + versions

### Local Development Scale
- 2-5 users, 2-3 spaces, 50-100 pages
- Single PostgreSQL, Redis, Elasticsearch, RabbitMQ instances
- All services on localhost with Docker Compose

## High-Level Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│   Web Browser   │────▶│   CDN / Edge    │────▶│  Load Balancer  │
│   (React SPA)   │     │   (Static Assets)│     │  (NGINX / ALB)  │
│                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                    ┌────────────────────────────────────┼────────────────────┐
                    │                                    │                    │
           ┌────────▼────────┐   ┌──────────────────┐   │    ┌──────────────▼──────┐
           │                 │   │                  │   │    │                     │
           │   API Server    │   │   API Server     │   │    │   API Server        │
           │   (Express)     │   │   (Express)      │   │    │   (Express)         │
           │   Port 3001     │   │   Port 3002      │   │    │   Port 3003         │
           │                 │   │                  │   │    │                     │
           └──┬────┬────┬────┘   └──────────────────┘   │    └─────────────────────┘
              │    │    │                               │
              │    │    └───────────────────────────────┤
              │    │                                    │
     ┌────────▼─┐  │  ┌──────────┐   ┌─────────────┐  │   ┌──────────────┐
     │          │  │  │          │   │             │  │   │              │
     │PostgreSQL│  │  │  Valkey  │   │  RabbitMQ   │──┼──▶│Search Indexer│
     │  (Pages, │  │  │ (Cache,  │   │ (page-index │  │   │  (Worker)    │
     │ Versions,│  │  │ Sessions)│   │   queue)    │  │   │              │
     │  Users)  │  │  │          │   │             │  │   └──────┬───────┘
     │          │  │  │          │   │             │  │          │
     └──────────┘  │  └──────────┘   └─────────────┘  │   ┌──────▼───────┐
                   │                                   │   │              │
                   └───────────────────────────────────┘   │Elasticsearch │
                                                           │ (Full-text   │
                                                           │  search)     │
                                                           │              │
                                                           └──────────────┘
```

## Core Components

### 1. Wiki Data Model

The core data model revolves around **spaces** containing hierarchical **pages**:

```sql
-- Spaces: organizational containers
spaces (id, key, name, description, homepage_id, is_public, created_by)

-- Pages: wiki content with parent-child hierarchy
pages (id, space_id, parent_id, title, slug, content_json, content_html,
       content_text, version, status, position, created_by, updated_by)

-- Page versions: immutable history records
page_versions (id, page_id, version_number, title, content_json,
               content_html, content_text, change_message, created_by)
```

**Page tree** is implemented using an adjacency list model (`parent_id` self-reference). Tree operations:
- **Get tree**: Load all pages for a space, build in-memory tree by mapping parent-child relationships
- **Move page**: Update `parent_id` and `position`, reorder siblings
- **Get breadcrumbs**: Recursive CTE walking up the ancestor chain

### 2. Request Flows

**Page View Flow:**
```
Client ──▶ GET /pages/space/:key/slug/:slug
         ──▶ Check Redis cache (page data)
         ──▶ If miss: Query PostgreSQL (page + author + labels)
         ──▶ Build breadcrumbs (recursive CTE)
         ──▶ Cache result (120s TTL)
         ──▶ Return page with metadata
```

**Page Edit Flow:**
```
Client ──▶ PUT /pages/:id (title, contentHtml, contentText)
         ──▶ BEGIN transaction
         ──▶ Increment version number
         ──▶ UPDATE pages table
         ──▶ INSERT page_versions record
         ──▶ COMMIT
         ──▶ Invalidate Redis cache (space tree + page)
         ──▶ Publish to RabbitMQ "page-index" queue
         ──▶ Return updated page
```

**Search Flow:**
```
Client ──▶ GET /search?q=query&space=KEY
         ──▶ Build ES query (multi_match on title^3, content, labels^2)
         ──▶ Apply filters (space, status=published)
         ──▶ Execute search with highlighting
         ──▶ If ES fails: fallback to PostgreSQL ILIKE
         ──▶ Return results with highlighted snippets
```

### 3. Version Control and Diffing

Every page edit creates an immutable version record:

```
Page (version=3) ──┐
                   ├── page_versions (v1) ──┐
                   ├── page_versions (v2) ──┤── diff(v1, v2) = line changes
                   └── page_versions (v3) ──┤── diff(v2, v3) = line changes
                                            └── diff(v1, v3) = full diff
```

Diff computation uses the `diff` library's `diffLines()` function on `content_html`. Each change is classified as added, removed, or unchanged. The frontend renders these as green/red highlighted lines.

### 4. Search Architecture

Asynchronous indexing via RabbitMQ ensures page operations are not blocked by search indexing:

```
Page Create/Update ──▶ RabbitMQ (page-index queue)
                                   │
                      Search Indexer Worker
                                   │
                                   ▼
                      Elasticsearch Index
                      ┌──────────────────┐
                      │ page_id (keyword) │
                      │ space_id (keyword)│
                      │ title (text^3)    │
                      │ content_text      │
                      │ labels (keyword[])│
                      │ status (keyword)  │
                      └──────────────────┘
```

The wiki_analyzer uses standard tokenizer with lowercase, stop word, and snowball (stemming) filters for intelligent matching.

### 5. Macro System

Macros are structured content blocks embedded in pages:

| Macro | Purpose | Visual |
|-------|---------|--------|
| `info` | Informational callout | Blue background, blue border |
| `warning` | Warning callout | Yellow background, orange border |
| `note` | Note callout | Purple background, purple border |
| `code` | Code block | Gray background, monospace font |
| `toc` | Table of contents | Generated from headings |

Macros can be stored in `content_json.macros[]` and expanded server-side by `macroService.ts` or rendered client-side by `MacroRenderer.tsx`.

## Data Model / Database Schema

Full schema in `backend/src/db/init.sql`. Key design decisions:

1. **JSONB for content**: `content_json` stores structured content for macro expansion; `content_html` stores rendered HTML; `content_text` stores plain text for search indexing
2. **Soft status**: Pages have `status` (draft/published/archived) rather than hard deletes
3. **Position ordering**: `position` column enables ordered siblings within each parent
4. **Composite indexes**: `(space_id, parent_id, position)` for efficient tree queries; `(space_id, slug)` for URL resolution

## API Design

RESTful API under `/api/v1/`. Key patterns:
- Session-based auth with Redis store
- Consistent error format: `{ error: "message" }`
- Cache invalidation on writes (pattern-based key deletion)
- Idempotent version creation within transactions

## Key Design Decisions

### Adjacency List vs Nested Sets for Page Tree

| Approach | Reads | Writes | Complexity |
|----------|-------|--------|------------|
| Adjacency List (chosen) | O(n) load + build | O(1) move | Low |
| Nested Sets | O(log n) subtree | O(n) recalculate | Medium |
| Materialized Path | O(1) ancestors | O(n) reparent | Low |

Adjacency list was chosen because wiki trees are typically shallow (3-5 levels deep) and wide. The entire space page set (usually < 1000 pages) fits easily in memory for tree construction. Nested sets would be needed only for very deep trees with frequent subtree queries.

### HTML Storage vs Block-Based Storage

Chose storing content as HTML strings rather than a block-based model (like Notion):
- **HTML**: Simple to implement, works with contentEditable, easy to render
- **Blocks**: Better for collaborative editing, granular version tracking, structured queries
- Trade-off: HTML diffs are noisier than block-level diffs. Production Confluence uses a custom storage format called XHTML with macros.

### Elasticsearch vs PostgreSQL Full-Text Search

| Feature | Elasticsearch | PostgreSQL FTS |
|---------|---------------|----------------|
| Relevance scoring | Excellent (BM25) | Good (ts_rank) |
| Fuzzy matching | Built-in | Limited |
| Highlighting | Built-in | Manual |
| Scaling | Horizontal sharding | Read replicas |
| Operational complexity | High | Low |

Elasticsearch was chosen for its superior relevance scoring and highlighting capabilities. PostgreSQL full-text search serves as a fallback when ES is unavailable.

## Security / Auth

- **Session-based auth**: Express sessions stored in Valkey with 24-hour TTL
- **Password hashing**: bcrypt with 12 salt rounds
- **Rate limiting**: Redis-backed rate limiter (500 req/15min for API, 20 req/15min for auth)
- **Space membership**: Role-based (admin, member, viewer) per space
- **CORS**: Configured for frontend origin only

## Monitoring and Observability

- **Metrics**: Prometheus metrics via prom-client (HTTP request duration/count, page operations, search latency)
- **Structured logging**: Pino logger with request correlation via pino-http
- **Health check**: `GET /api/health` returns service status
- **Circuit breaker**: Opossum circuit breaker for external service calls

## Failure Handling

- **ES unavailable**: Falls back to PostgreSQL ILIKE search
- **RabbitMQ unavailable**: Page operations succeed; indexing is skipped (eventual consistency)
- **Redis unavailable**: Sessions fail (auth required), but caching degrades gracefully
- **Transaction rollbacks**: All multi-step operations use PostgreSQL transactions

## Scalability Considerations

1. **Read scaling**: Page content cached in Redis (120s TTL); page trees cached per space
2. **Write scaling**: Async search indexing via RabbitMQ decouples writes from indexing
3. **Search scaling**: Elasticsearch supports horizontal sharding for larger indices
4. **Database scaling**: Read replicas for page queries; connection pooling (max 20)
5. **Horizontal API scaling**: Stateless API servers behind load balancer; sessions in Redis

At extreme scale (100M+ pages):
- Shard PostgreSQL by space_id
- Use Kafka instead of RabbitMQ for higher throughput indexing
- Add CDN for static page content
- Implement collaborative editing with CRDTs/OT

## Trade-offs and Alternatives

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Page tree model | Adjacency list | Nested sets | Simpler writes, shallow trees |
| Content storage | HTML string | Block-based JSON | Simpler editor, direct rendering |
| Search engine | Elasticsearch | PostgreSQL FTS | Better relevance, highlighting |
| Version diffing | Line-level (diff lib) | Block-level | Simple, works with HTML content |
| Session storage | Redis + cookie | JWT | Immediate revocation, simpler |
| Async indexing | RabbitMQ | Sync ES writes | Non-blocking page operations |
| Rich text editor | contentEditable | Tiptap/ProseMirror | No extra dependency, sufficient |
| Macro rendering | Server + client | Server-only SSR | Interactive macros possible |

## Implementation Notes

### Production-Grade Patterns Implemented

1. **Circuit Breaker (Opossum)**: Wraps external service calls with failure detection. Opens after 50% error rate, resets after 30s. See `src/services/circuitBreaker.ts`.

2. **Prometheus Metrics (prom-client)**: HTTP request duration histogram, request counters, page operation counters, search latency histogram. See `src/services/metrics.ts`.

3. **Structured Logging (Pino)**: JSON-formatted logs with request correlation via pino-http. See `src/services/logger.ts`.

4. **Rate Limiting**: Redis-backed rate limiter with separate limits for API (500/15min) and auth (20/15min). See `src/services/rateLimiter.ts`.

5. **Health Check**: Simple `/api/health` endpoint for load balancer probing.

6. **Transactional Writes**: Page create/update/move operations wrapped in PostgreSQL transactions with proper rollback on failure.

### What Was Simplified
- **contentEditable** instead of Tiptap/ProseMirror rich text editor
- **Session auth** instead of OAuth 2.0 / SAML
- **Single PostgreSQL** instead of sharded cluster
- **No real-time collaboration** (would need WebSocket + CRDT)
- **HTML diffs** instead of structured content diffs

### What Was Omitted
- CDN for static assets
- Multi-region deployment
- Real-time collaborative editing
- File/image attachments
- PDF/Word export
- SAML/OAuth SSO
- Page-level permissions (only space-level)
- Audit logging
- Content replication across data centers
