# Excalidraw - Collaborative Whiteboard (Full-Stack Focus)

## 🎯 Problem Statement

Design a collaborative whiteboard where multiple users simultaneously draw shapes on an infinite canvas. The system must handle real-time synchronization, conflict resolution for concurrent edits, and persistent storage -- while rendering thousands of shapes at 60fps in the browser.

## 📋 Requirements Clarification

**Functional:**
- Real-time multi-user canvas with shapes (rect, ellipse, diamond, arrow, line, freehand, text)
- Drawing CRUD with sharing (view/edit permissions)
- Live cursor presence showing collaborator positions and names
- Pan and zoom on infinite canvas
- Shape properties (color, stroke, opacity)
- Collaborator management with invite and permission control

**Non-Functional:**
- < 50ms collaboration latency for shape operations
- 60fps rendering with 1000+ elements on the canvas
- 50+ concurrent users per drawing room
- 99.9% availability with graceful degradation
- Persistent storage with version history for recovery

**Out of scope:** Image import, offline mode, mobile clients, template library

> "This is a full-stack problem where the frontend and backend challenges are tightly coupled. The canvas rendering must be fast enough that real-time updates from the server feel instant. The server must handle concurrent edits without losing data. I'll walk through both layers and how they connect."

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser Client                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Canvas   │  │  Zustand  │  │  Toolbar  │  │  WebSocket    │  │
│  │ Renderer  │  │  State    │  │    + UI   │  │  Client       │  │
│  └─────┬─────┘  └─────┬─────┘  └──────────┘  └───────┬───────┘  │
│        │              │                               │          │
│        └──────────────┼───────────────────────────────┘          │
└───────────────────────┼──────────────────────────────────────────┘
                        │ HTTP + WebSocket
                        ▼
┌───────────────────────────────────────────────────────────────────┐
│                      API Server (Express + WS)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │  Auth    │  │ Drawing  │  │  CRDT    │  │  WS Room Manager │ │
│  │  Routes  │  │ Routes   │  │  Merge   │  │  (Map<id, Set>)  │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │
└──────────────┬──────────────────┬────────────────────────────────┘
               │                  │
          ┌────▼────┐       ┌─────▼─────┐
          │PostgreSQL│       │   Redis   │
          │ elements │       │ sessions  │
          │ (JSONB)  │       │ cursors   │
          └──────────┘       └───────────┘
```

> "The architecture has three main layers: the browser renders on HTML5 Canvas and manages state with Zustand, the server handles REST for CRUD and WebSocket for real-time collaboration, and the data layer uses PostgreSQL for persistent element storage and Redis for ephemeral state like sessions and cursor positions."

**Frontend layer:** The React application uses TanStack Router for page navigation (drawing list, login, individual drawing canvas). Zustand stores manage canvas state (elements, viewport, active tool) and auth state. The canvas layer handles rendering, hit testing, and path simplification independently from React's render cycle. A WebSocket client singleton manages the server connection with automatic reconnection.

**Server layer:** Express handles REST routes for authentication, drawing CRUD, and collaborator management. The WebSocket upgrade happens on the same HTTP server, and a room manager maintains an in-memory map of drawing IDs to connected client sets. The CRDT merge module resolves conflicts when concurrent edits arrive. A debounce timer per room batches database writes.

**Data layer:** PostgreSQL stores drawings with a JSONB elements column for flexible shape storage. Redis backs express-session for immediate session revocation and stores ephemeral cursor positions with TTLs.

## 💾 Data Model

**Core tables:**

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| users | id (UUID PK), username (unique), email (unique), password_hash | email | Standard auth table |
| drawings | id (UUID PK), title, owner_id (FK), elements (JSONB), app_state (JSONB), is_public | owner_id | Elements stored as JSONB array |
| drawing_collaborators | id (UUID PK), drawing_id (FK), user_id (FK), permission | (drawing_id, user_id) unique | Permission: 'view' or 'edit' |
| drawing_versions | id (UUID PK), drawing_id (FK), version_number, elements (JSONB), created_by (FK) | (drawing_id, version_number) | Capped at 50 per drawing |

**Why JSONB for elements?**

> "Drawing elements have heterogeneous schemas -- a rectangle has width/height, freehand has a points array, text has fontSize. I store them as a JSONB array because they're always loaded and saved as a complete set. We never query 'find all blue rectangles across all drawings.' The alternative is a normalized elements table with a row per shape, but that requires N JOINs to load a drawing and N writes to save -- versus one JSONB read/write. The trade-off is write amplification on large drawings (rewriting the entire JSONB column), but TOAST compression mitigates this."

**Element structure** (within JSONB): Each element carries an id, type, position (x, y), dimensions, optional points array for freehand/line, styling properties (strokeColor, fillColor, strokeWidth, opacity), a version counter for CRDT resolution, an updatedAt timestamp as tiebreaker, an isDeleted flag for soft deletes, and a createdBy user reference.

## 🔌 API Design

### REST Endpoints

```
POST /api/v1/auth/register           Create user account
POST /api/v1/auth/login              Authenticate, create session
POST /api/v1/auth/logout             Destroy session
GET  /api/v1/auth/me                 Current user info

GET    /api/v1/drawings              List user's drawings (owned + collaborated)
POST   /api/v1/drawings              Create new drawing
GET    /api/v1/drawings/:id          Get drawing with elements
PUT    /api/v1/drawings/:id          Update drawing metadata or elements
DELETE /api/v1/drawings/:id          Delete drawing (owner only)

POST   /api/v1/drawings/:id/collaborators         Add collaborator
DELETE /api/v1/drawings/:id/collaborators/:userId  Remove collaborator
GET    /api/v1/drawings/:id/collaborators          List collaborators

GET /api/health                      Liveness check
GET /api/health/detailed             Component health status
GET /metrics                         Prometheus metrics
```

### WebSocket Messages

Client-to-server: join-room, leave-room, shape-add, shape-update, shape-delete, shape-move, elements-sync, cursor-move. Server-to-client: connected (with cursor color), room-state (full elements on join), user-joined, user-left, shape operation broadcasts, cursor broadcasts, error.

## 🔧 Deep Dive 1: Canvas Rendering Pipeline

### Viewport Transform

The infinite canvas uses a 2D affine transform:

```
ctx.setTransform(zoom, 0, 0, zoom, scrollX, scrollY)
```

- **Pan:** Middle mouse or space+drag updates scrollX/scrollY
- **Zoom:** Scroll wheel changes zoom factor, centered on cursor position
- **Coordinate conversion:** worldX = (screenX - scrollX) / zoom

### Rendering Loop

```
┌─────────┐    ┌──────────┐    ┌────────────┐    ┌──────────┐
│  Clear   │───▶│ Draw Dot │───▶│  Apply     │───▶│ Render   │
│  Canvas  │    │   Grid   │    │ Transform  │    │ Elements │
└─────────┘    └──────────┘    └────────────┘    └────┬─────┘
                                                      │
                                              ┌───────▼───────┐
                                              │  Selection    │
                                              │  Handles      │
                                              └───────────────┘
```

Each shape type has a dedicated renderer. The grid is drawn in screen space before the viewport transform, so dots maintain consistent spacing at all zoom levels. Elements are drawn in world space after the transform. Selection handles are drawn last, on top of everything.

> "The rendering pipeline runs on every requestAnimationFrame. I batch all state reads at the start of each frame and draw everything in one pass. This is important because WebSocket messages can arrive mid-frame -- without batching, we'd get tearing artifacts where some elements reflect the new state and others don't."

### Freehand Path Simplification

Freehand drawing at 60fps generates hundreds of points. On mouseup, the Ramer-Douglas-Peucker algorithm simplifies the path from ~200 points to ~40 while preserving visual fidelity. This reduces storage by 5x and rendering cost proportionally. Smooth rendering uses quadratic Bezier curves between consecutive points rather than straight line segments, producing natural-looking strokes.

### Performance for Large Canvases

**Viewport culling** skips rendering elements outside the visible area. For a 5000-element canvas where the user is zoomed in, typically only 50-200 elements need drawing. **requestAnimationFrame batching** ensures multiple state changes within one frame produce a single render pass. **Dirty rectangle tracking** during drag operations limits clearing and redrawing to just the changed region.

### Trade-off: Canvas 2D vs WebGL vs SVG

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Canvas 2D | Simple API, good for 1K elements | CPU-bound, no DOM events |
| ❌ WebGL | GPU-accelerated, 100K+ elements | Complex shaders, harder debugging |
| ❌ SVG | Built-in events, CSS styling | DOM bloat above 1K elements |

> "Canvas 2D handles our target of 1000+ elements at 60fps without GPU complexity. SVG would give us free click events on shapes (no hit testing needed) but each shape is a DOM node, and DOM manipulation at 1000+ nodes causes frame drops. WebGL would be the choice for a Figma-scale product with 100K+ elements, but the shader complexity is not justified for our scale."

## 🔧 Deep Dive 2: Real-Time Collaboration

### WebSocket Protocol Flow

```
Client                    Server                   Other Clients
  │                         │                           │
  │── join-room ──────────▶│                           │
  │                         │── room-state (elements)──▶│
  │◀── room-state ─────────│                           │
  │                         │                           │
  │── shape-add ──────────▶│                           │
  │                         │── shape-add broadcast ───▶│
  │                         │                           │
  │── cursor-move ────────▶│                           │
  │                         │── cursor-move broadcast ─▶│
```

### Optimistic Updates + CRDT Merge

Shape operations are applied locally first (instant feedback), then sent to the server, which broadcasts to other clients. The user never waits for a server round-trip. On the server, the CRDT merge handles conflicts:

```
mergeElements(existing, incoming):
  for each incoming element:
    if element.version > existing[id].version    ──▶ accept incoming
    if same version, incoming.updatedAt > existing ──▶ accept incoming
    else                                          ──▶ keep existing
```

### Trade-off: LWW CRDT vs Operational Transform

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Shape-level LWW | Simple (50 LOC), low overhead | Loses one edit on same-element conflict |
| ❌ OT (Google Docs style) | Precise merging | Requires centralized transform server |
| ❌ Full CRDT (Yjs) | True conflict-free | 100KB+ library, complex data structures |

> "In a whiteboard, users typically work on different shapes. Two users editing the exact same rectangle simultaneously is rare. When it happens, LWW keeps the latest version -- the 'loser' sees their change replaced, which feels natural. For text elements where character-level merging matters, I'd integrate Yjs. But for geometric shapes, LWW gives 90% of the value at 10% of the complexity."

> "OT is what Google Docs uses for character-level text editing. It requires a centralized sequencer that transforms operation indices as concurrent edits arrive. For a whiteboard where each operation targets a discrete shape rather than a position within a shared string, OT's transformation logic is unnecessary overhead. The centralized sequencer also becomes a scalability bottleneck -- every operation must pass through it, adding latency. LWW operates purely at the element level with no central coordination."

### Soft Deletes

Deleted elements are marked with an isDeleted flag and an incremented version rather than being removed from the array. This prevents resurrection bugs where a concurrent update from another user would re-add a deleted element. The renderer filters out soft-deleted elements, and periodic compaction removes elements that have been deleted for more than 24 hours.

### Reconnection and State Recovery

When a WebSocket connection drops, the client enters a reconnection loop with exponential backoff (500ms, 1s, 2s, 4s, capped at 30s). During disconnection, the user can continue drawing locally -- all operations are queued. On reconnection, the client re-sends a join-room message. The server responds with the current authoritative state. The client merges the server state with its local state using the same CRDT merge function, ensuring no edits are lost from either side.

## 🔧 Deep Dive 3: Persistence and Consistency

### Debounced Auto-Save

Rather than persisting every operation (freehand generates 60 ops/second), the server uses a 2-second debounce:

```
shape-add ──▶ reset 2s timer ──▶ (2s idle) ──▶ WRITE to PostgreSQL
shape-add ──▶ reset 2s timer ──┘
shape-add ──▶ reset 2s timer ──┘
```

When the last user leaves a room, the server flushes immediately. On graceful shutdown (SIGTERM), all active rooms are flushed before the process exits.

### Trade-off: Debounced Save vs Event Sourcing

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Debounced full-state save | Simple, predictable writes | Lose up to 2s on crash |
| ❌ Event sourcing | Perfect audit trail, undo | 3000 writes/sec with 50 users |

> "Event sourcing is elegant but the write volume is brutal. 50 concurrent users drawing freehand generates 3,000 operations per second. Persisting each one creates enormous I/O pressure and requires complex log compaction. The debounced approach collapses all operations into a single JSONB write every 2 seconds. We lose up to 2 seconds of work on a server crash, but the in-memory state typically survives because crashes are rare and WebSocket reconnection re-syncs from surviving memory."

### Version Snapshots

Each debounced save creates a version snapshot, capped at 50 per drawing. This enables recovery from accidental bulk deletes and provides a timeline of drawing evolution. The version number increments monotonically, and old snapshots are pruned on a FIFO basis.

## 🔌 Cursor Presence

### Dual-Path Architecture

```
Real-time path:  Client ──WS──▶ Server ──broadcast──▶ Other Clients
                 (10fps throttled for network efficiency)

Persistence path: Server ──▶ Redis HSET with 30s TTL
                  (for late-joining users to see existing cursors)
```

Cursors render as colored SVG arrows in a DOM overlay above the canvas, not drawn on the canvas itself. This avoids full canvas redraws on every cursor move. Each user is assigned a distinct color on connection from a predefined palette of 12 high-contrast colors. The 10fps throttle reduces bandwidth by 6x compared to raw 60fps mousemove events while still feeling responsive.

### Trade-off: DOM Overlay vs Canvas-Drawn Cursors

| Approach | Pros | Cons |
|----------|------|------|
| ✅ DOM overlay | Independent update cycle, no canvas redraw | Two-layer layout complexity |
| ❌ Canvas-drawn | Single rendering surface | Full canvas redraw on every cursor move |

> "Drawing cursors on the canvas would mean re-rendering all shapes every time any collaborator moves their mouse -- at 10fps per user, with 10 collaborators that's 100 redraws per second, destroying our 60fps rendering budget. The DOM overlay lets cursor CSS transforms update independently of the canvas rendering loop. The trade-off is managing z-index stacking between the canvas and the overlay, but this is straightforward CSS."

## 🎨 Frontend State Management

### Why Zustand over Context

> "The canvas reads state at 60fps for rendering. React Context causes full component tree re-renders when any value changes. Zustand uses selector-based subscriptions -- the canvas component only re-renders when `elements` or `viewState` change, not when `cursors` update. This is critical for maintaining 60fps while cursor positions update at 10fps."

### Store Structure

```
canvasStore:
  elements[]          -- All shapes (source of truth for rendering)
  selectedElementId   -- Currently selected
  activeTool          -- Current drawing tool
  viewState           -- { scrollX, scrollY, zoom }
  cursors[]           -- Other users' positions
  strokeColor/fillColor/strokeWidth/opacity -- Current style

authStore:
  user, isAuthenticated, login/logout actions
```

## 🛡️ Failure Handling

**Client-side failures:**
- WebSocket disconnect triggers exponential backoff reconnection (500ms to 30s)
- During disconnection, local drawing continues and operations queue for replay
- On reconnection, CRDT merge reconciles local and server state
- If the server returns 401 on reconnection, redirect to login
- Canvas rendering errors are caught per-element to prevent one malformed shape from crashing the entire canvas

**Server-side failures:**
- Database outage: circuit breaker opens after 5 failures, in-memory rooms continue serving, debounced saves retry when circuit closes
- Redis outage: sessions degrade (re-auth required), cursor persistence lost but WebSocket cursors continue, rate limiting falls back to per-server memory
- Server crash: in-memory room state lost, clients reconnect and reload from last PostgreSQL snapshot, up to 2 seconds of data may be lost
- Graceful shutdown: on SIGTERM, server flushes all active rooms to PostgreSQL before exiting, ensuring zero data loss during planned deployments

**End-to-end recovery scenario:** Consider the case where the database goes down while 100 users are actively drawing. The circuit breaker opens, and debounced saves start failing silently. In-memory room state continues to serve all active collaboration sessions without interruption -- users do not notice the outage. When the database recovers, the circuit breaker enters half-open state, probes succeed, and all accumulated saves flush. The maximum data loss is bounded by the circuit breaker timeout plus one debounce interval. If the server itself crashes during the database outage, clients reconnect and find that the last persisted state may be minutes old. The CRDT reconciliation re-sends any local changes, but operations from other users during the gap are lost. This is the primary motivation for considering a write-ahead log at higher scale tiers.

## 🗄️ Caching Strategy

Drawing metadata (title, owner, permissions, collaborator list) is cached in Redis with a 5-minute TTL. The drawing list page reads from cache first, falling back to PostgreSQL on cache miss. Cache invalidation happens on write: creating, updating, or deleting a drawing evicts the relevant keys.

The full elements array is not cached in Redis because it lives in the server's in-memory room state during active collaboration. Loading from PostgreSQL when the first user joins a room takes 10-50ms depending on element count, which happens once per room activation and is not a bottleneck.

Session data uses Redis with a 24-hour TTL, enabling immediate revocation (deleting the key logs the user out) and allowing horizontal scaling of API servers since no session state is stored in process memory.

## 📡 Observability

**Prometheus metrics** track the following:

| Metric | Type | Purpose |
|--------|------|---------|
| HTTP request duration | Histogram | API latency by endpoint |
| WebSocket connections active | Gauge | Current connection count |
| WebSocket messages by type | Counter | Traffic pattern analysis |
| Drawings created | Counter | Business metric |
| Circuit breaker state | Gauge | Infrastructure health |
| Active sessions | Gauge | User concurrency |
| CRDT merge conflicts | Counter | Collaboration health |
| Debounced saves | Counter | Persistence activity |

**Structured logging** uses Pino with JSON output. Each log entry includes a request trace ID (from the x-trace-id header), user context (userId if authenticated), database query timing, and WebSocket room lifecycle events (join, leave, flush, conflict). Log levels follow standard severity: error for failures, warn for degraded states (circuit breaker open), info for business events, debug for protocol detail.

**Health checks** expose three levels: liveness (process running), readiness (PostgreSQL and Redis connected), and detailed (component-level status with latency measurements). The readiness check gates load balancer traffic, ensuring that a server that has lost its database connection stops receiving new requests.

## 📊 Scaling Path

| Scale | Frontend Changes | Backend Changes |
|-------|-----------------|-----------------|
| Single server | Canvas 2D, in-memory state | In-memory rooms, debounced PostgreSQL |
| 10K users | Viewport culling optimization | Redis Pub/Sub for cross-server WS fan-out |
| 100K users | Web Worker for CRDT merge | Drawing sharding by ID, read replicas, CDN |
| 1M users | WebGL rendering, offline-first | Dedicated WS gateway, Yjs for text, PgBouncer |

### What Breaks First

WebSocket connections are the first bottleneck at ~50KB memory per connection. A single 8GB server handles roughly 50K-100K connections. PostgreSQL write throughput becomes a concern with thousands of active rooms writing multi-MB JSONB snapshots every 2 seconds. Redis cursor writes scale with users times update frequency -- at 100K users and 10fps, Redis sees 1M writes/second for cursor data alone.

## ⚖️ Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Rendering | Canvas 2D | WebGL / SVG | Simple API, good for 1K elements |
| Conflict resolution | Shape LWW | Full CRDT | Simple, sufficient for shapes |
| Element storage | JSONB | Normalized table | Single read/write, flexible schema |
| Persistence | Debounced save | Event sourcing | Lower write amplification |
| State management | Zustand | React Context | Selector subscriptions, 60fps |
| Cursor rendering | DOM overlay | Canvas-drawn | No full canvas redraw |
| Real-time | WebSocket | SSE | Bidirectional, low latency |
| Room management | In-memory Map | Redis Pub/Sub | Zero latency at single server |
| Session storage | Redis + cookie | JWT | Immediate revocation |
| Conflict ordering | Version + timestamp | Vector clocks | Simpler, acceptable UX |
