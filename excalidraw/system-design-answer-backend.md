# Excalidraw - Collaborative Whiteboard (Backend Focus)

## 🎯 Problem Statement

Design a collaborative whiteboard where multiple users can simultaneously draw shapes, see each other's cursors, and have their work persist reliably. Think Excalidraw, Miro, or FigJam -- but focused on the backend challenges of real-time sync, conflict resolution, and persistence.

## 📋 Requirements Clarification

"Before diving in, let me clarify scope and constraints."

**Functional:**
- Multi-user real-time drawing on shared canvas
- Shape types: rectangles, ellipses, lines, arrows, freehand paths, text
- Drawing CRUD with sharing permissions (view/edit)
- Live cursor presence
- Persistent storage

**Non-Functional:**
- Collaboration latency < 50ms
- Support 50+ concurrent users per drawing
- 99.9% availability
- Graceful conflict resolution for concurrent edits

**Out of scope:** Image import, templates, mobile clients, offline mode

## 🏗️ Architecture

```
┌─────────────┐          ┌─────────────┐          ┌─────────────┐
│   Browser   │──HTTP───▶│   API GW    │──────────▶│  API Server │
│  (Canvas +  │          │  (nginx /   │          │  (Express)  │
│   WS Client)│──WS────▶│   sticky)   │──────────▶│  + WS Room  │
└─────────────┘          └─────────────┘          └──────┬──────┘
                                                         │
                              ┌───────────────────┬──────┴──────┐
                              │                   │             │
                         ┌────▼────┐        ┌─────▼─────┐  ┌───▼───┐
                         │PostgreSQL│        │   Redis   │  │Redis  │
                         │ Drawings │        │ Sessions  │  │Pub/Sub│
                         │ Users    │        │ Cursors   │  │(scale)│
                         └──────────┘        └───────────┘  └───────┘
```

> "I split the architecture into REST for CRUD operations and WebSocket for real-time collaboration. The API server handles both on the same port, which simplifies deployment. For horizontal scaling, I'd add Redis Pub/Sub to fan out WebSocket messages across server instances."

## 💾 Data Model

**Users table** -- standard auth with UUID primary keys

**Drawings table** -- the core entity:
- id (UUID), title, owner_id (FK users)
- elements (JSONB) -- array of all shapes
- app_state (JSONB) -- viewport settings
- is_public (boolean), timestamps

**Collaborators table** -- access control:
- drawing_id + user_id (unique constraint)
- permission: 'view' | 'edit'

**Versions table** -- periodic snapshots for recovery:
- drawing_id, version_number, elements (JSONB snapshot)

> "I chose JSONB for elements because they're always loaded as a complete set for rendering. We never query 'find all rectangles across drawings' -- we always operate on one drawing's full element array. This avoids JOIN overhead and supports flexible element schemas where freehand shapes have a `points` array but rectangles don't."

## 🔧 Deep Dive 1: Real-Time Collaboration Protocol

### WebSocket Room Management

```
Server maintains: rooms = Map<drawingId, Set<WebSocket>>

join-room:
  1. Client sends { type: 'join-room', drawingId, userId, username }
  2. Server adds client to room set
  3. Server loads elements from memory (or DB if first joiner)
  4. Server sends { type: 'room-state', elements } to joiner
  5. Server broadcasts { type: 'user-joined' } to other room members

shape-add/update/delete:
  1. Client sends operation with element data
  2. Server applies CRDT merge to in-memory state
  3. Server broadcasts to all room members except sender
  4. Server debounces DB save (2s idle timer)
```

### Trade-off: WebSocket Rooms vs Redis Pub/Sub

| Approach | Pros | Cons |
|----------|------|------|
| ✅ In-memory rooms | Zero-latency broadcast, simple | Single-server only |
| ❌ Redis Pub/Sub | Multi-server fan-out | Added latency (~1ms), complexity |

> "For a single-server deployment, in-memory rooms give the lowest possible broadcast latency. When scaling horizontally, I'd add Redis Pub/Sub: each server subscribes to channels for its active drawing rooms, and operations publish to the channel. The trade-off is ~1ms added latency per message, but this is well within our 50ms target. Sticky sessions ensure a user's WebSocket typically stays on one server, reducing cross-server traffic."

## 🔧 Deep Dive 2: Conflict Resolution with Shape-Level LWW

### The Core Problem

Two users simultaneously edit the same rectangle -- User A changes its color while User B moves it. Without conflict resolution, one update overwrites the other.

### Shape-Level Last-Writer-Wins

Each element carries: `id`, `version` (integer), `updatedAt` (timestamp)

```
mergeElements(existing[], incoming[]):
  for each incoming element:
    current = existing[element.id]
    if !current → add element
    if element.version > current.version → replace
    if same version, element.updatedAt > current.updatedAt → replace
    else → keep existing
```

### Trade-off: LWW vs Full CRDT (Yjs/Automerge)

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Shape-level LWW | Simple, low overhead, 50 LOC | Loses one edit on same-element conflict |
| ❌ Full CRDT (Yjs) | True conflict-free merging | 100KB+ library, complex data structures |

> "I chose LWW because whiteboard users typically work on different shapes. The probability of two users editing the exact same rectangle at the exact same moment is low. When it happens, the user whose edit 'loses' sees their change replaced -- which feels natural ('someone else moved the box I was editing'). For text elements where character-level merging matters, I'd integrate Yjs, but for geometric shapes, LWW provides 90% of the value at 10% of the complexity."

### Soft Deletes for CRDT Correctness

Deleted elements are marked `isDeleted: true` rather than removed. This prevents a subtle bug: if User A deletes element X while User B concurrently updates element X, User B's update would "resurrect" the element. With soft deletes, the CRDT merge sees the higher-version delete and keeps it deleted.

## 🔧 Deep Dive 3: Persistence Strategy

### Debounced Auto-Save

Rather than writing every operation to the database (which would generate thousands of writes during freehand drawing at 60 points/second), the server uses a debounced save:

1. After each shape operation, reset a 2-second timer
2. When the timer fires, write the full element array to PostgreSQL
3. On room empty (last user leaves), flush immediately

### Trade-off: Debounced Save vs Event Sourcing

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Debounced full-state save | Simple, predictable writes | Lose up to 2s of work on crash |
| ❌ Event sourcing | Perfect audit trail, undo support | Massive write volume, complex replay |

> "Event sourcing is the theoretically correct approach -- persist every operation, reconstruct state by replaying. But freehand drawing generates ~60 operations per second per user. With 50 concurrent users, that's 3,000 writes/second to the operations table. The debounced approach collapses all those into a single JSONB write every 2 seconds. We lose up to 2 seconds of work on a server crash, which is acceptable given that the WebSocket reconnection flow will re-sync state from the surviving in-memory copy."

### Version Snapshots

Every save creates a version snapshot (capped at 50 per drawing). This enables:
- Recovery from accidental bulk deletes
- Audit trail of drawing evolution
- Future undo/redo implementation

## 🔌 Cursor Presence

### Architecture

```
Client cursor-move ──▶ WebSocket broadcast (real-time, ~60fps throttled to 10fps)
                   └──▶ Redis HSET (persistence for late joiners, 30s TTL)

presence:cursors:{drawingId} = {
  userId1: '{"x":100,"y":200,"color":"#e03131","username":"alice"}',
  userId2: '{"x":300,"y":150,"color":"#3b5bdb","username":"bob"}'
}
```

> "Cursor updates flow primarily through WebSocket broadcast for minimum latency. Redis serves as the persistence layer so that when a new user joins, they can see existing cursor positions from the Redis hash. The 30-second TTL auto-cleans stale cursors from disconnected users."

## 📊 Scaling Path

1. **Phase 1 (Current):** Single server, in-memory rooms, debounced PostgreSQL saves
2. **Phase 2 (10K users):** Add Redis Pub/Sub for cross-server WebSocket fan-out, sticky sessions
3. **Phase 3 (100K users):** Shard drawings by ID hash, read replicas for drawing loads, CDN for frontend
4. **Phase 4 (1M users):** Dedicated WebSocket gateway layer, element-level JSONB updates via `jsonb_set()`, distributed CRDT via Yjs

## ⚖️ Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Conflict resolution | Shape-level LWW | Full CRDT (Yjs) | Simple, sufficient for shapes |
| Element storage | JSONB column | Normalized table | Single read/write, flexible schema |
| Real-time transport | WebSocket | SSE / Long polling | Bidirectional, low latency |
| Persistence | Debounced save | Event sourcing | Lower write amplification |
| Room management | In-memory Map | Redis Pub/Sub | Zero-latency for single server |
| Cursor storage | Redis hash + WS | WS only | Late-joiner cursor persistence |
