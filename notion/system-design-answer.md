# Design Notion - System Design Interview Answer

## Introduction (2 minutes)

"Thanks for the opportunity. Today I'll walk you through designing Notion, a block-based collaborative workspace. Notion is fascinating because it combines real-time collaboration like Google Docs, a flexible data model where everything is a block, and hierarchical organization with workspaces and pages.

The core technical challenges we'll need to solve are:
1. Real-time collaborative editing with conflict resolution
2. A flexible block-based data model that can represent text, images, databases, and more
3. Hierarchical page organization with granular permissions
4. Offline-first architecture that syncs seamlessly

Let me start by clarifying requirements."

---

## Requirements Clarification (5 minutes)

### Functional Requirements

"For our MVP, I'd focus on these core features:

1. **Block-Based Editing**: Create and edit various block types - text, headings, lists, code, images, embeds
2. **Real-Time Collaboration**: Multiple users editing the same page simultaneously
3. **Page Organization**: Nested pages within workspaces, sidebar navigation
4. **Sharing & Permissions**: Share pages with specific users or publicly, with view/edit controls
5. **Databases**: Structured data with different view types - table, board, calendar

For this discussion, I'll focus heavily on the real-time collaboration and block model, since those are the most technically interesting aspects."

### Non-Functional Requirements

"Let me establish our scale and performance targets:

- **Latency**: Local edits should feel instant (< 100ms), cross-user sync within 500ms
- **Offline Support**: Users should be able to edit documents fully offline, then sync when connected
- **Scale**: Let's target 10 million workspaces, 1 billion blocks total
- **Availability**: 99.9% uptime for the collaboration service

The offline requirement is particularly important - it drives us toward a specific sync architecture."

---

## High-Level Design (10 minutes)

### Architecture Overview

"Here's how I'd structure the system:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Client Layer                                │
│       React + Block Editor + CRDT Runtime + IndexedDB           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ WebSocket
┌─────────────────────────────────────────────────────────────────┐
│                   Sync Server Cluster                           │
│         (Real-time operation broadcast + conflict resolution)   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Server                                   │
│         - Workspaces - Pages - Permissions - Search             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Data Layer                                 │
├─────────────────┬───────────────────────────────────────────────┤
│   PostgreSQL    │              Elasticsearch                    │
│   - Blocks      │              - Full-text search               │
│   - Pages       │              - Block content                  │
│   - Workspaces  │                                               │
└─────────────────┴───────────────────────────────────────────────┘
```

Let me walk through each layer."

### Client Layer

"The client is where most of the magic happens. We have:

- A **React-based block editor** that renders the block tree
- A **CRDT runtime** that handles local operations and merges remote changes
- **IndexedDB** for offline storage - the entire document lives locally

The key insight is that edits are applied locally first, then synced. This gives us that instant feel."

### Sync Server

"The sync server handles WebSocket connections and broadcasts operations. It's stateless - all state lives in the database and on clients. This lets us scale horizontally by adding more sync servers behind a load balancer.

When a user makes an edit:
1. Client applies the operation locally (instant)
2. Client sends the operation over WebSocket
3. Sync server broadcasts to other users on that page
4. Sync server persists to database"

### API Server

"The API server handles non-real-time operations: workspace management, page CRUD, permission changes, search queries. Standard REST API backed by PostgreSQL."

---

## Deep Dive: Block Data Model (8 minutes)

### Block Structure

"Everything in Notion is a block. This is the core abstraction:

```typescript
interface Block {
  id: string
  type: BlockType  // 'text', 'heading_1', 'bulleted_list', 'image', 'database', etc.
  parentId: string | null
  pageId: string
  properties: Record<string, any>  // Type-specific properties
  content: RichText[]  // The text content with formatting
  children: string[]  // Ordered child block IDs
  createdAt: Date
  updatedAt: Date
}
```

Why this design? Blocks are recursive - a toggle block contains child blocks, a column layout contains column blocks containing content blocks. This gives us enormous flexibility."

### Rich Text Model

"Text content uses a span-based model:

```typescript
interface RichText {
  text: string
  annotations: {
    bold?: boolean
    italic?: boolean
    code?: boolean
    color?: string
  }
  link?: string
}
```

A sentence like 'Hello **world**' becomes two spans: `{text: 'Hello '}` and `{text: 'world', annotations: {bold: true}}`. This makes it easy to apply formatting to ranges."

### Database Schema

"For persistence, I'd use PostgreSQL:

```sql
CREATE TABLE blocks (
  id UUID PRIMARY KEY,
  page_id UUID REFERENCES pages(id),
  parent_block_id UUID REFERENCES blocks(id),
  type VARCHAR(50) NOT NULL,
  properties JSONB,
  content JSONB,  -- Rich text array
  position VARCHAR(100),  -- Fractional index for ordering
  version INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_blocks_page ON blocks(page_id);
CREATE INDEX idx_blocks_parent ON blocks(parent_block_id);
```

The `position` field uses fractional indexing, which I'll explain next."

### Fractional Indexing for Ordering

"A key challenge is ordering blocks. If I want to insert a block between positions 1 and 2, traditional integer indexes would require reindexing everything after.

Fractional indexing solves this. Positions are strings that sort lexicographically:
- Block A: position 'a'
- Block B: position 'b'
- Insert between: position 'aU' (sorts between 'a' and 'b')

This gives us O(1) insertions with no reindexing. The tradeoff is positions can grow long in adversarial cases, but in practice they stay short."

---

## Deep Dive: Real-Time Collaboration (10 minutes)

### Why CRDT over Operational Transformation?

"For real-time collaboration, there are two main approaches: Operational Transformation (OT) like Google Docs uses, or Conflict-free Replicated Data Types (CRDTs).

I'd choose CRDTs because:
1. **No central authority needed** - operations can merge in any order
2. **Better offline support** - clients can diverge and converge later
3. **Simpler server** - just broadcasts, no transformation logic

The tradeoff is slightly larger operation payloads, but for Notion's block-based model, this is acceptable."

### Operation Structure

"Each edit becomes a CRDT operation:

```typescript
interface Operation {
  id: string
  type: 'insert' | 'delete' | 'update'
  blockId: string
  parentId?: string
  position?: FractionalIndex
  properties?: Partial<Block>
  timestamp: HybridLogicalClock
  author: string
}
```

The hybrid logical clock gives us causal ordering even across devices with clock drift."

### Sync Protocol

"Here's how sync works:

```typescript
class SyncClient {
  private pendingOps: Operation[] = []
  private confirmedVersion: number = 0

  async applyLocal(op: Operation) {
    // 1. Apply immediately to local state
    this.applyOp(op)
    this.pendingOps.push(op)

    // 2. Send to server
    this.ws.send({ type: 'operation', op })
  }

  handleServerOp(op: Operation) {
    // Apply remote operation if we haven't seen it
    if (!this.hasOp(op.id)) {
      this.applyOp(op)
    }
  }

  handleAck(opId: string) {
    // Remove from pending once server confirms
    this.pendingOps = this.pendingOps.filter(op => op.id !== opId)
  }
}
```

The key is that local operations are applied immediately and optimistically. The server broadcasts to other clients and acknowledges. If we go offline, operations queue up and sync when we reconnect."

### Conflict Resolution

"What happens when two users edit the same block simultaneously?

For block properties (like converting to a different type), we use last-write-wins based on the hybrid logical clock.

For text content within a block, we'd use a sequence CRDT like RGA or Yjs. These can merge concurrent insertions deterministically by using unique IDs for each character.

The beauty of CRDTs is there's no 'conflict' - operations always merge to a consistent state, even if users diverged significantly while offline."

---

## Deep Dive: Page Hierarchy & Permissions (5 minutes)

### Recursive Page Structure

"Pages can nest infinitely - a workspace contains root pages, which can contain child pages, and so on:

```sql
CREATE TABLE pages (
  id UUID PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id),
  parent_id UUID REFERENCES pages(id),  -- NULL for root pages
  title VARCHAR(500),
  icon VARCHAR(100),
  is_database BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

This recursive structure is simple but has query implications. Getting the full path to a page requires a recursive CTE, but we can cache this for performance."

### Permission Model

"Permissions cascade down the tree by default, but can be overridden:

- Workspace level: Member roles (admin, member, guest)
- Page level: Override with specific user/group access

When checking permissions, we walk up the tree until we find an explicit permission or reach the workspace level. This is cacheable since permission changes are infrequent."

---

## Database Views (3 minutes)

"Notion databases are just pages where blocks are rows. Each row block has properties defined by the database schema:

```typescript
interface DatabaseView {
  id: string
  databaseId: string
  type: 'table' | 'board' | 'list' | 'calendar' | 'gallery'
  name: string
  filter: Filter[]
  sort: Sort[]
  properties: PropertyVisibility[]
}
```

The same underlying data can be viewed as a table, Kanban board, or calendar - it's just different rendering and grouping logic on the client. Filters and sorts can be applied per-view without affecting the data."

---

## Trade-offs and Alternatives (2 minutes)

"Let me summarize the key design decisions:

| Decision | Chosen | Alternative | Why |
|----------|--------|-------------|-----|
| Sync mechanism | CRDT | Operational Transform | Better offline support, simpler server |
| Block ordering | Fractional index | Array index | No reindexing on insert |
| Storage | PostgreSQL + JSONB | Document DB | Relational queries, strong consistency |
| Real-time transport | WebSocket | SSE | Bidirectional communication needed |

If I had more time, I'd want to discuss:
- How to handle very large pages with 10,000+ blocks (lazy loading, virtual scrolling)
- Presence indicators showing who's viewing/editing
- Search indexing strategy for blocks
- Mobile offline sync with bandwidth constraints"

---

## Summary

"To summarize, I've designed Notion with:

1. **A flexible block model** where everything from text to databases is a block with consistent structure
2. **CRDT-based real-time sync** that handles offline editing and conflict resolution
3. **Fractional indexing** for efficient block ordering
4. **Hierarchical pages** with cascading permissions
5. **Client-first architecture** with IndexedDB for offline support

The system prioritizes user experience - edits feel instant, sync is seamless, and the flexible block model lets users build anything from notes to databases.

Any questions about specific aspects of the design?"
