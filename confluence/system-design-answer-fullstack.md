# System Design: Confluence Wiki (Full-Stack Focus)

## 🎯 1. Requirements Clarification

> "Before diving in, let me clarify scope. We are building a Confluence-like wiki platform where teams create and organize documentation within spaces. I will cover both the frontend and backend, focusing on three areas where the two halves are tightly coupled: the search pipeline from indexing through query to UI rendering, the version control system from storage through diffing to the diff viewer, and page tree operations from the database model through the API to the recursive sidebar component. I will scope out real-time collaborative editing and file attachments."

**Functional:**
- Create and manage **spaces** as organizational containers
- Hierarchical **page tree** with parent-child relationships, drag-and-drop reordering
- Rich text editing with formatting toolbar and embedded macros
- **Version control** with diff viewer comparing any two versions
- **Full-text search** with highlighted snippets and space filtering
- Threaded comments with resolve/unresolve
- Content approval workflow (request, approve, reject)
- Labels for cross-cutting categorization

**Non-Functional:**

| Requirement | Target |
|-------------|--------|
| Page load latency (p99) | < 200ms |
| Search latency (p99) | < 500ms |
| Availability | 99.95% |
| Total pages | 100M+ |
| Daily page views | 50M+ |
| Editor input latency | < 16ms (60fps) |
| Tree render (500 pages) | < 100ms initial |

---

## 🏗️ 2. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                     Frontend                         │
│  React + TanStack Router + Zustand                  │
│                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ PageTree │ │  Editor  │ │DiffViewer│            │
│  │(sidebar) │ │(content  │ │(side-by- │            │
│  │          │ │ Editable)│ │  side)   │            │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘            │
│       │ tree data   │ save       │ diff data        │
└───────┼─────────────┼────────────┼──────────────────┘
        │             │            │
        │ HTTP/JSON   │            │
        │             │            │
┌───────▼─────────────▼────────────▼──────────────────┐
│                     Backend                          │
│  Node.js + Express                                  │
│                                                     │
│  ┌──────────┐ ┌──────────┐ ┌───────────────┐       │
│  │ Page API │ │Search API│ │ Version API   │       │
│  └────┬─────┘ └────┬─────┘ └───────┬───────┘       │
│       │             │               │               │
│  ┌────▼──────────────────────────────────────┐      │
│  │              PostgreSQL                    │      │
│  │  pages, page_versions, spaces, users      │      │
│  └────────────────────┬──────────────────────┘      │
│                       │                              │
│  ┌──────────┐   ┌─────▼──────┐   ┌──────────────┐  │
│  │  Redis   │   │  RabbitMQ  │   │Elasticsearch │  │
│  │ (Cache + │   │ (page-index│──▶│(Full-text    │  │
│  │ Sessions)│   │  queue)    │   │ search)      │  │
│  └──────────┘   └────────────┘   └──────────────┘  │
└─────────────────────────────────────────────────────┘
```

> "The architecture has a clear responsibility split. PostgreSQL is the source of truth for all page content, versions, and metadata. Redis accelerates read-heavy operations (page views, tree loading) and stores sessions. Elasticsearch handles full-text search with relevance scoring and highlighting. RabbitMQ decouples page writes from search indexing. The frontend is a React SPA that manages three state domains: auth, space/tree navigation, and editor state."

---

## 💾 3. Data Model

### Core Tables

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| spaces | id (UUID PK), key (unique), name, description, homepage_id, is_public, created_by | key | Organizational container; key used in URLs |
| pages | id (UUID PK), space_id (FK), parent_id (self FK), title, slug, content_json (JSONB), content_html (TEXT), content_text (TEXT), version (INT), status, position (INT) | (space_id, parent_id, position), (space_id, slug) | Adjacency list tree; triple content storage |
| page_versions | id (UUID PK), page_id (FK), version_number, title, content_json, content_html, content_text, change_message, created_by | (page_id, version_number DESC) | Immutable snapshots; one per edit |
| comments | id (UUID PK), page_id (FK), parent_id (self FK), content, is_resolved, created_by | (page_id, created_at) | Threaded comments with resolve |
| space_members | space_id (FK), user_id (FK), role | UNIQUE(space_id, user_id) | Role: admin, member, viewer |
| labels | id (UUID PK), name (unique) | name | Shared label pool |
| page_labels | page_id (FK), label_id (FK) | UNIQUE(page_id, label_id) | Many-to-many tagging |
| approvals | id (UUID PK), page_id (FK), requested_by, reviewed_by, status, version_number | (page_id, status) | pending/approved/rejected |

### Triple Content Storage

> "Each page stores content in three formats: `content_json` (JSONB) holds structured content with macro nodes for programmatic expansion, `content_html` (TEXT) holds rendered HTML for direct display, and `content_text` (TEXT) holds stripped plain text for search indexing. This avoids runtime conversion on every read. The trade-off is 3x write amplification, but page edits are infrequent compared to page views (50:1 ratio), so optimizing reads is the right call."

### Entity Diagram

```
┌──────────┐     ┌──────────────────┐     ┌─────────────────┐
│  spaces  │────▶│      pages       │────▶│  page_versions  │
│          │     │  (adjacency list │     │  (immutable     │
│ key      │     │   via parent_id) │     │   snapshots)    │
│ name     │     │                  │     │                 │
└──────────┘     │ content_json     │     │ version_number  │
                 │ content_html     │     │ content_html    │
                 │ content_text     │     │ change_message  │
                 └────────┬─────────┘     └─────────────────┘
                          │
                    ┌─────▼──────┐
                    │  comments  │
                    │ (threaded) │
                    └────────────┘
```

---

## 🔌 4. API Design

### Page Operations

```
POST   /api/v1/pages                              -> Create page in space
GET    /api/v1/pages/space/:key/slug/:slug         -> Get page by URL
PUT    /api/v1/pages/:id                           -> Update (creates version)
DELETE /api/v1/pages/:id                           -> Soft-delete (archive)
PUT    /api/v1/pages/:id/move                      -> Change parent/position
GET    /api/v1/spaces/:key                         -> Get space with full page tree
```

### Version and Search

```
GET    /api/v1/pages/:id/versions                  -> List version history
GET    /api/v1/pages/:id/versions/:v1/diff/:v2     -> Compute diff between versions
GET    /api/v1/search?q=query&space=KEY            -> Full-text search
```

### Comments and Approvals

```
POST   /api/v1/pages/:id/comments                  -> Add comment (threaded)
PATCH  /api/v1/comments/:id/resolve                -> Toggle resolve
POST   /api/v1/pages/:id/approvals                 -> Request approval
PATCH  /api/v1/approvals/:id                       -> Approve or reject
```

> "The URL structure for pages uses the space key plus page slug rather than page ID. This produces readable URLs like `/spaces/ENG/pages/api-design-guide`, which is important for a wiki where URLs are shared in documentation and chat. The backend resolves these using the composite index on (space_id, slug)."

---

## 🔧 5. Deep Dive: Search Pipeline (End-to-End)

> "Search touches every layer of the stack. Let me trace the full pipeline from indexing through query to UI rendering."

### Backend: Indexing Pipeline

```
Page edit saved to PostgreSQL
       │
       ▼
Publish message to RabbitMQ ("page-index" queue)
  { page_id, version, space_id, action: "index" }
       │
       ▼
Search Indexer Worker consumes message
       │
       ├── Fetch fresh page data from PostgreSQL
       │     (handles out-of-order messages by always reading latest)
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

> "The custom `wiki_analyzer` in Elasticsearch uses standard tokenization with lowercase, stop word removal, and snowball stemming. This means searching for 'configuring' also matches 'configure', 'configured', and 'configuration' -- essential for a documentation platform where terminology varies."

### Backend: Query Handling

```
GET /search?q=kubernetes+deployment&space=ENG
       │
       ▼
Build Elasticsearch query:
  multi_match on title (boost 3x), content_text, labels (boost 2x)
  + filter: space_id = lookup(ENG), status = published
  + highlight: title, content_text (fragment_size 150)
       │
       ├── ES available ──▶ Execute search, return highlighted results
       │
       └── ES unavailable ──▶ Fallback to PostgreSQL:
             WHERE (title ILIKE '%kubernetes%' OR content_text ILIKE '%kubernetes%')
             AND (title ILIKE '%deployment%' OR content_text ILIKE '%deployment%')
```

### Frontend: Search UI

```
┌───────────────────────────────────────────────┐
│  🔍 [kubernetes deployment              ] [⏎] │
│                                                │
│  3 results in "Engineering"                    │
│                                                │
│  📄 Kubernetes Deployment Guide               │
│     Engineering > DevOps > Kubernetes          │
│     ...the **kubernetes deployment** manifest  │
│     requires configuring resource limits...    │
│                                                │
│  📄 CI/CD Pipeline Setup                       │
│     Engineering > DevOps > CI                  │
│     ...trigger a **kubernetes deployment**     │
│     after all tests pass in the pipeline...    │
│                                                │
└───────────────────────────────────────────────┘
```

> "Search input is debounced at 300ms. Results include highlighted snippets from Elasticsearch with matching terms in bold. Each result shows the breadcrumb path so users understand where the page sits in the space hierarchy. Clicking a result navigates to the page with the matching term scrolled into view."

### Trade-off: Elasticsearch vs PostgreSQL Full-Text Search

> "PostgreSQL offers built-in full-text search with `tsvector` and `ts_rank`, which would eliminate the need for Elasticsearch, RabbitMQ, and the indexer worker -- a major reduction in infrastructure complexity. However, PostgreSQL FTS lacks three capabilities critical for a wiki: fuzzy matching (finding 'kubrnetes' when the user means 'kubernetes'), BM25 relevance scoring (Elasticsearch's algorithm handles term frequency and document length normalization better than ts_rank for long-form content), and built-in highlighting (PostgreSQL requires manual snippet extraction). For a wiki where search is the primary navigation mechanism beyond the page tree, search quality directly impacts user productivity."

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Elasticsearch + async indexing | BM25 relevance, fuzzy matching, highlighting, scalable | Extra infrastructure (ES + RabbitMQ + worker), 5-10s index lag |
| ❌ PostgreSQL FTS | No extra infrastructure, instant consistency | Weaker relevance, no fuzzy matching, manual highlighting |

> "The fallback strategy is important. When Elasticsearch is down, users can still find pages using PostgreSQL ILIKE. The results are worse (no relevance scoring, no snippets, slower) but the system remains functional. The frontend renders a subtle warning banner: 'Search results may be limited -- using basic search.' This dual-path approach means search never fully fails."

---

## 🔧 6. Deep Dive: Version Control System (End-to-End)

> "Version control is the feature that makes a wiki trustworthy. Users must see who changed what and when, compare any two versions, and understand the evolution of a page."

### Backend: Version Creation

```
PUT /pages/:id with { title, contentHtml, contentText, changeMessage }
       │
       ▼
BEGIN TRANSACTION
├── SELECT version FROM pages WHERE id = $1 FOR UPDATE
├── new_version = current_version + 1
├── UPDATE pages SET content_html, content_text, version = new_version
├── INSERT INTO page_versions (page_id, version_number, title,
│        content_html, content_text, change_message, created_by)
COMMIT
       │
       ▼
Invalidate cache + publish to search queue
```

> "The SELECT FOR UPDATE acquires a row lock, preventing two concurrent edits from creating the same version number. Without this, two editors saving simultaneously could both read version=3, both try to create version=4, and produce corrupted version history. The row lock serializes concurrent edits -- one gets version 4, the other gets version 5."

### Backend: Diff Computation

> "Diffs are computed on-demand by loading both version snapshots from `page_versions` and running a line-level diff algorithm on the HTML content. Each change segment is classified as added, removed, or unchanged."

```
GET /pages/:id/versions/2/diff/5
       │
       ▼
Load page_versions WHERE page_id AND version_number IN (2, 5)
       │
       ▼
Run line-level diff on content_html
       │
       ▼
Return array of segments:
  [
    { type: "unchanged", value: "<h1>Title</h1>" },
    { type: "removed",   value: "<p>Old paragraph</p>" },
    { type: "added",     value: "<p>New paragraph with changes</p>" },
    { type: "unchanged", value: "<p>Rest of content</p>" }
  ]
```

### Frontend: Diff Viewer

```
┌─────────────────────────┬─────────────────────────┐
│  Version 2               │  Version 5               │
├─────────────────────────┼─────────────────────────┤
│  # API Design            │  # API Design            │
│                          │                          │
│  ## Overview             │  ## Overview             │
│  ░░░░░░░░░░░░░░░░░░░░░░ │  The API uses REST...   │  ← green
│  The API follows...      │  The API follows...      │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │                          │  ← red
│  with rate limiting      │                          │
│                          │                          │
│  ## Endpoints            │  ## Endpoints            │
└─────────────────────────┴─────────────────────────┘
     [◀ v1]  Version 2 vs Version 5  [v6 ▶]
```

> "The diff viewer uses synchronized scrolling -- both panels share a scroll handler that keeps them aligned. Each segment is rendered with a CSS class: `diff-added` (green background), `diff-removed` (red background), or `diff-unchanged` (no highlight). The viewer also shows version selectors so users can compare any two versions, not just adjacent ones."

### Trade-off: Full Snapshots vs Delta Storage

> "I store the complete content for every version rather than storing only the delta from the previous version. This uses more storage -- roughly 50KB per version instead of ~2.5KB for a typical delta. At 1M edits per day, that is 50GB/day versus 2.5GB/day. But the benefit is significant: any version can be retrieved with a single database read (O(1)), and any two versions can be compared directly without reconstructing intermediate states. With delta storage, viewing version 100 would require replaying 100 deltas from the base version, making the diff viewer response time proportional to the version count -- unacceptable for heavily edited wiki pages."

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Full snapshots | O(1) retrieval, direct comparison of any pair | Higher storage (50KB/version) |
| ❌ Delta storage | 20x less storage | O(N) reconstruction, complex merge |
| ✅ On-demand diff | Flexible pair comparison, no diff storage | CPU cost per request |
| ❌ Pre-computed diffs | Instant adjacent comparisons | N-squared storage for all pairs |

---

## 🔧 7. Deep Dive: Page Tree Operations (End-to-End)

> "The page tree is the primary navigation structure. It must handle spaces with hundreds of pages, support drag-and-drop reordering, and render recursively in the sidebar."

### Backend: Adjacency List Model

> "Each page has a `parent_id` referencing another page in the same space. Root pages have `parent_id = NULL`. A `position` integer controls sibling ordering. The composite index on (space_id, parent_id, position) makes tree queries efficient."

**Loading the tree:** A single query retrieves all pages for a space, returning a flat list. The API does not pre-build the nested tree structure -- it returns flat data and lets the frontend build the tree.

**Breadcrumb query:** A recursive CTE walks up the ancestor chain from the current page to the root.

```
Page: "API Design"
       │ parent_id
       ▼
Page: "Backend"
       │ parent_id
       ▼
Page: "Engineering"
       │ parent_id = NULL
       ▼
(stop)

Breadcrumb: Engineering > Backend > API Design
```

**Move operation:** The backend wraps moves in a transaction, updating the moved page's `parent_id` and `position`, then reordering siblings at both the source and destination to eliminate gaps.

### Frontend: Recursive Tree Component

```
┌────────────────────────┐
│  Space Sidebar          │
│                        │
│  ▼ Engineering         │  ← expanded
│    ▼ Backend           │  ← expanded
│      ● API Design      │  ← current page (highlighted)
│      ○ Database Guide  │
│      ○ Auth Patterns   │
│    ▶ Frontend          │  ← collapsed (children hidden)
│    ▶ DevOps            │  ← collapsed
│  ▶ Product             │  ← collapsed
│  ▶ Design              │  ← collapsed
│                        │
└────────────────────────┘
```

> "The frontend builds a nested tree structure from the flat API response in a single O(n) pass: create a lookup map by page ID, then for each page, push it into its parent's children array. The resulting tree is cached in the SpaceStore. Only children of expanded nodes are rendered -- a collapsed node with 100 descendants renders as a single component."

### Full-Stack Coordination: Drag-and-Drop Move

```
Frontend: User drags "API Design" from Backend to Frontend
       │
       ▼
Optimistic update: move node in SpaceStore tree immediately
       │
       ▼
PUT /api/v1/pages/:id/move  { newParentId, position }
       │
       ▼
Backend: BEGIN TRANSACTION
├── Update page parent_id and position
├── Reorder source siblings (close gap)
├── Reorder destination siblings (make room)
COMMIT
       │
       ├── Success: invalidate Redis cache, confirm frontend state
       │
       └── Failure: frontend rolls back tree to previous state
```

> "The optimistic update makes drag-and-drop feel instant. The tree visually rearranges the moment the user drops, before the API responds. If the server rejects the move (permission denied, concurrent edit), the frontend reverts to the pre-drag tree state. The 50:1 read-to-write ratio means the vast majority of tree operations are reads (loading and rendering), so the occasional write can afford the complexity of transactional sibling reordering."

### Trade-off: Adjacency List vs Nested Sets

> "Nested sets would make subtree queries trivial -- 'find all descendants of Engineering' is a single range query between left and right values. But every page move requires recalculating left/right values for all affected nodes. In a wiki where documentation reorganization is common (pages get moved during restructuring), the O(n) write cost of nested sets is problematic. Adjacency list makes moves O(1) at the cost of requiring recursive CTEs for ancestor queries -- but wiki trees are shallow (3-5 levels), so these CTEs execute in microseconds."

| Approach | Tree Load | Move | Subtree Query | Best For |
|----------|-----------|------|---------------|----------|
| ✅ Adjacency list | O(n) flat load | O(1) parent update | O(depth) CTE | Frequent moves, shallow trees |
| ❌ Nested sets | O(1) range query | O(n) recalculate | O(1) range | Read-heavy, deep trees |
| ❌ Materialized path | O(n) prefix match | O(subtree) rewrite | O(1) prefix | Breadcrumb-heavy UIs |

---

## 🗄️ 8. Caching Strategy

| Layer | Data | TTL | Invalidation |
|-------|------|-----|--------------|
| Redis | Page content (by space key + slug) | 120s | On page edit |
| Redis | Space page tree (by space key) | 120s | On page create/edit/move/delete |
| Redis | Breadcrumbs (by page ID) | 300s | On page move |
| Redis | Sessions | 24h | On logout |
| Frontend | Tree structure (SpaceStore) | Until space navigation | On page move/create/delete API response |
| Frontend | Editor content (EditorStore) | Until save/discard | On user action |

> "Cache invalidation uses pattern-based key deletion: editing a page deletes both the page key and the space tree key. The 120-second TTL provides a safety net for any missed invalidation. Search results are never cached -- they always come fresh from Elasticsearch to ensure recently indexed content is immediately findable."

---

## 🔒 9. Security

| Layer | Measure |
|-------|---------|
| Auth | Session-based with Redis, bcrypt (12 rounds) |
| Access | Space membership check on every page operation |
| Rate limiting | 500 req/15min API, 20 req/15min auth (Redis-backed) |
| SQL injection | Parameterized queries exclusively |
| XSS | React default escaping; wiki content rendered with care |
| CSRF | SameSite=Lax cookies, CORS restricted to frontend origin |

> "The XSS concern is real for a wiki. The page viewer renders HTML content, which could include malicious scripts if a user embeds them. Server-side sanitization strips script tags, event handlers, and dangerous attributes before storing content_html. The frontend uses dangerouslySetInnerHTML for rendering, but only on sanitized content from the API."

---

## 📈 10. Scalability Path

### What Breaks First

> "The first bottleneck is the `page_versions` table. At 1M edits per day with 50KB per version, this table grows 50GB daily. After a year, it holds 365M rows and 18TB of data."

**Mitigation:** Partition by `created_at` (monthly). Hot partitions (last 90 days) on SSD, cold partitions on HDD. Most version access targets recent edits.

### Scaling Roadmap

| Phase | Backend | Frontend |
|-------|---------|----------|
| 1 | Redis caching (120s TTL) | Lazy tree expansion (render only visible nodes) |
| 2 | Read replicas for page queries | Debounced search (300ms) |
| 3 | Shard PostgreSQL by space_id | Service worker for offline page viewing |
| 4 | Scale ES with index sharding | Virtual scrolling for long pages |
| 5 | Replace RabbitMQ with Kafka | CRDT editor for real-time collaboration |

---

## 🛡️ 11. Failure Handling

### Backend Resilience

| Component Down | Impact | Mitigation |
|----------------|--------|------------|
| Elasticsearch | Search degraded | Fall back to PostgreSQL ILIKE |
| RabbitMQ | New pages not indexed | Page edits still succeed; catch-up job reconciles |
| Redis | Sessions fail, cache misses | Users re-login; reads go to PostgreSQL |
| PostgreSQL replica | Slight latency increase | Reads fall to primary |

### Frontend Error Recovery

> "The frontend handles errors at three levels. API errors during page save show an inline error message and preserve the editor content so the user can retry. Network disconnection during tree drag-and-drop rolls back the optimistic move. Search failures show a 'Search temporarily unavailable' banner without clearing existing results."

---

## 🔍 12. Observability

| Metric | Type | Purpose |
|--------|------|---------|
| http_request_duration_seconds | Histogram | Per-endpoint latency percentiles |
| page_operations_total | Counter | Create/update/delete volume |
| search_duration_seconds | Histogram | Search latency (ES vs fallback) |
| search_fallback_total | Counter | Frequency of PostgreSQL fallback |
| indexer_lag_seconds | Gauge | Time between edit and ES index |
| tree_load_duration_ms | Histogram | Page tree query + build time |
| circuit_breaker_state | Gauge | ES circuit breaker status |

> "The most important alert is `indexer_lag_seconds > 60`. This means the search pipeline is falling behind and users are seeing stale results. The second most important is `search_fallback_total` increasing -- this indicates Elasticsearch health issues even before the circuit breaker opens."

---

## ⚖️ 13. Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Page tree model | Adjacency list | Nested sets | O(1) moves, wiki trees are shallow |
| Content storage | Triple (JSON + HTML + text) | Single format with conversion | Optimizes read-heavy workload (50:1) |
| Search engine | Elasticsearch + ILIKE fallback | PostgreSQL FTS only | Better relevance, fuzzy matching, highlighting |
| Search indexing | Async via RabbitMQ | Synchronous ES writes | Non-blocking page edits |
| Version storage | Full snapshots | Delta-only | O(1) retrieval, any-pair diffing |
| Diff computation | On-demand | Pre-computed | Flexible comparison, no storage overhead |
| Editor | contentEditable | ProseMirror/Tiptap | Zero bundle cost, sufficient for wiki |
| Tree rendering | Recursive components | Flat list with indent | Natural nesting, arbitrary depth |
| Drag-and-drop | Optimistic + rollback | Wait for server confirmation | Instant UX, rare conflicts in wiki editing |
| Session auth | Redis + cookie | JWT | Immediate revocation |
| Caching | Short TTL (120s) | Event-driven invalidation | Simpler, bounded staleness |
