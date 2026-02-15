# Excalidraw - Collaborative Whiteboard (Full-Stack Focus)

## 🎯 Problem Statement

Design a collaborative whiteboard where multiple users simultaneously draw shapes on an infinite canvas. The system must handle real-time synchronization, conflict resolution for concurrent edits, and persistent storage -- while rendering thousands of shapes at 60fps in the browser.

## 📋 Requirements Clarification

**Functional:**
- Real-time multi-user canvas with shapes (rect, ellipse, diamond, arrow, line, freehand, text)
- Drawing CRUD with sharing (view/edit permissions)
- Live cursor presence
- Pan and zoom on infinite canvas
- Shape properties (color, stroke, opacity)

**Non-Functional:**
- < 50ms collaboration latency
- 60fps rendering with 1000+ elements
- 50+ concurrent users per drawing
- 99.9% availability

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

## 💾 Data Model

**Core tables:**
- `users` -- UUID PK, username, email, password_hash
- `drawings` -- UUID PK, title, owner_id, **elements JSONB**, is_public
- `drawing_collaborators` -- drawing_id + user_id (unique), permission
- `drawing_versions` -- periodic snapshots for recovery

**Why JSONB for elements?**

> "Drawing elements have heterogeneous schemas -- a rectangle has width/height, freehand has a points array, text has fontSize. I store them as a JSONB array because they're always loaded and saved as a complete set. We never query 'find all blue rectangles across all drawings.' The alternative is a normalized `elements` table with a row per shape, but that requires N JOINs to load a drawing and N writes to save -- versus one JSONB read/write. The trade-off is write amplification on large drawings (rewriting the entire JSONB column), but TOAST compression mitigates this."

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

Each shape type has a dedicated renderer: `renderRectangle()`, `renderEllipse()`, `renderDiamond()`, `renderArrow()`, `renderLine()`, `renderFreehand()`, `renderText()`.

### Freehand Path Simplification

Freehand drawing at 60fps generates hundreds of points. On mouseup, the Ramer-Douglas-Peucker algorithm simplifies the path from ~200 points to ~40 while preserving visual fidelity. This reduces storage by 5x and rendering cost proportionally.

## 🔧 Deep Dive 2: Real-Time Collaboration

### WebSocket Protocol

Messages flow through room-based WebSocket channels:

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

Shape operations are applied locally first (instant feedback), then sent to the server, which broadcasts to other clients. On the server, the CRDT merge handles conflicts:

```
mergeElements(existing, incoming):
  for each incoming element:
    if element.version > existing[id].version → accept incoming
    if same version, incoming.updatedAt > existing → accept incoming
    else → keep existing
```

### Trade-off: LWW CRDT vs Operational Transform

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Shape-level LWW | Simple (50 LOC), low overhead | Loses one edit on same-element conflict |
| ❌ OT (Google Docs style) | Precise merging | Requires centralized transform server |
| ❌ Full CRDT (Yjs) | True conflict-free | 100KB+ library, complex data structures |

> "In a whiteboard, users typically work on different shapes. Two users editing the exact same rectangle simultaneously is rare. When it happens, LWW keeps the latest version -- the 'loser' sees their change replaced, which feels natural. For text elements where character-level merging matters, I'd integrate Yjs. But for geometric shapes, LWW gives 90% of the value at 10% of the complexity."

## 🔧 Deep Dive 3: Persistence and Consistency

### Debounced Auto-Save

Rather than persisting every operation (freehand generates 60 ops/second), the server uses a 2-second debounce:

```
shape-add ──▶ reset 2s timer ──▶ (2s idle) ──▶ WRITE to PostgreSQL
shape-add ──▶ reset 2s timer ──┘
shape-add ──▶ reset 2s timer ──┘
```

When the last user leaves a room, the server flushes immediately.

### Trade-off: Debounced Save vs Event Sourcing

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Debounced full-state save | Simple, predictable writes | Lose up to 2s on crash |
| ❌ Event sourcing | Perfect audit trail, undo | 3000 writes/sec with 50 users |

> "Event sourcing is elegant but the write volume is brutal. 50 concurrent users drawing freehand generates 3,000 operations per second. Persisting each one creates enormous I/O pressure and requires complex log compaction. The debounced approach collapses all operations into a single JSONB write every 2 seconds. We lose up to 2 seconds of work on a server crash, but the in-memory state typically survives because crashes are rare and WebSocket reconnection re-syncs from surviving memory."

## 🔌 Cursor Presence

### Dual-Path Architecture

```
Real-time path:  Client ──WS──▶ Server ──broadcast──▶ Other Clients
                 (10fps throttled for network efficiency)

Persistence path: Server ──▶ Redis HSET with 30s TTL
                  (for late-joining users to see existing cursors)
```

Cursors render as colored SVG arrows in a DOM overlay above the canvas, not drawn on the canvas itself. This avoids full canvas redraws on every cursor move.

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

## 📊 Scaling Path

| Scale | Changes |
|-------|---------|
| Single server | In-memory rooms, debounced PostgreSQL writes |
| 10K users | Redis Pub/Sub for cross-server WS fan-out |
| 100K users | Drawing sharding by ID hash, read replicas |
| 1M users | Dedicated WS gateway, Yjs for text CRDT, CDN |

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
