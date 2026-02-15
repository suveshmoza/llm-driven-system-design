# Confluence Wiki - Development Notes

## Project Context

Building a Confluence-like wiki/knowledge base system to understand wiki semantics (spaces, page trees, versioning with diffs), rich-text editing, content approval workflows, and full-text search with Elasticsearch.

## Key Design Decisions

### 1. Page Tree with Adjacency List (parent_id)

Used adjacency list model with `parent_id` self-reference in the `pages` table rather than nested sets or materialized paths. Rationale:
- Simpler to understand and implement
- Efficient for the common operations (add/move/delete pages)
- PostgreSQL recursive CTEs handle ancestor queries well
- Trade-off: tree reconstruction requires loading all pages for a space, but acceptable for local scale

### 2. ContentEditable Instead of Tiptap/ProseMirror

Chose `contentEditable` with `document.execCommand` for the rich text editor:
- Avoids the complexity and bundle size of Tiptap/ProseMirror
- Good enough for demonstrating wiki editing concepts
- Stores content as HTML string directly
- Trade-off: Limited undo/redo support and less structured editing. Production would use Tiptap.

### 3. Version Diffing with `diff` Library

Used the `diff` npm package for line-by-line diffing between page versions:
- Diffs `content_html` between any two versions
- Visual diff display with green (added) and red (removed) highlighting
- Trade-off: HTML diffs can be noisy. Production would diff structured JSON content or use operational transforms.

### 4. Elasticsearch for Full-Text Search with PostgreSQL Fallback

- Primary search through Elasticsearch with custom wiki analyzer
- RabbitMQ queue decouples indexing from page operations
- Falls back to PostgreSQL ILIKE search if ES is unavailable
- Enables fuzzy matching, relevance scoring, and highlighted snippets

### 5. Macro System

Implemented macro expansion (info, warning, note, code, toc) both server-side and client-side:
- Server-side: `macroService.ts` expands macro nodes from `content_json` into styled HTML
- Client-side: `MacroRenderer.tsx` renders macros from `content_json` as React components
- Editor toolbar includes quick-insert buttons for macros

### 6. Approval Workflow

Simple approval model with pending/approved/rejected states:
- Any authenticated user can request approval
- Any other user can approve or reject
- Approving a page changes its status to "published"
- Production would add role-based approval chains and notifications

## Development Phases

### Phase 1: Infrastructure and Schema
- [x] Docker Compose (PostgreSQL, Redis, Elasticsearch, RabbitMQ)
- [x] Database schema with all tables and indexes
- [x] Backend scaffolding with shared services

### Phase 2: Core Backend
- [x] Auth routes (register, login, logout, /me)
- [x] Space CRUD with member management
- [x] Page CRUD with tree operations
- [x] Version history and diff computation
- [x] Search indexing pipeline (RabbitMQ -> worker -> Elasticsearch)

### Phase 3: Advanced Features
- [x] Threaded comments with resolve/unresolve
- [x] Content approval workflow
- [x] Page templates
- [x] Macro expansion service
- [x] Label system

### Phase 4: Frontend
- [x] Dashboard with recent pages and spaces
- [x] Space view with sidebar page tree
- [x] Page viewer with wiki content styling
- [x] Page editor with formatting toolbar
- [x] Version history timeline
- [x] Side-by-side diff viewer
- [x] Comment section with threading
- [x] Approval banner
- [x] Search with highlighted results
- [x] Breadcrumb navigation

### Phase 5: Polish
- [x] Backend unit tests
- [x] Seed data for demo
- [x] Production-grade patterns (circuit breaker, metrics, logging, rate limiting)

## Open Questions

1. **Collaborative Editing**: Real Confluence uses operational transforms for real-time co-editing. This could be added with WebSocket + CRDTs in a future iteration.

2. **Permission Model**: Current model is simple (space members with roles). Production would need page-level permissions, group-based access, and anonymous viewing.

3. **Attachment Support**: Not implemented. Would need MinIO for file storage and a separate attachments table.

4. **Page Export**: PDF/Word export would be valuable. Could use Puppeteer for PDF generation.
