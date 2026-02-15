# Excalidraw - Collaborative Whiteboard - Development Notes

## Project Context

Building a collaborative whiteboard to explore real-time canvas rendering, shape-level CRDT conflict resolution, and WebSocket-based multi-user collaboration.

**Key Learning Goals:**
- HTML5 Canvas rendering with viewport transforms (pan/zoom)
- Shape-level Last-Writer-Wins CRDT for concurrent edits
- WebSocket room management for real-time collaboration
- Cursor presence tracking via Redis
- JSONB storage patterns for flexible element schemas

---

## Key Challenges Explored

### 1. Canvas Rendering with Viewport Transforms

**Problem:** Need an infinite canvas that supports panning and zooming while rendering shapes at their "world" coordinates.

**Solution:** Apply a 2D affine transform before rendering:
- `ctx.setTransform(zoom, 0, 0, zoom, scrollX, scrollY)`
- All element coordinates stored in world space
- Screen-to-world conversion: `worldX = (screenX - scrollX) / zoom`

**Key insight:** Draw the grid in screen space (before the transform), draw elements in world space (after the transform). This prevents grid dots from scaling with zoom.

### 2. CRDT vs OT vs Simple Merge

**Options evaluated:**

| Strategy | Pros | Cons |
|----------|------|------|
| OT (Operational Transform) | Precise character-level merges | Complex, needs central server |
| Full CRDT (Yjs/Automerge) | True conflict-free | Large library, complex data structures |
| Shape-level LWW (chosen) | Simple, 50 lines of code | Loses one edit on same-element conflict |

**Decision:** Shape-level LWW is sufficient because whiteboard users typically edit different shapes. The rare case of two users editing the same shape simultaneously results in one edit winning -- which feels natural in a visual editor.

### 3. Persistence Strategy

**Decision:** Debounced auto-save (2-second idle timer) writing full JSONB to PostgreSQL.

**Why not event sourcing?** Freehand drawing at 60fps generates ~60 operations per second per user. With 50 concurrent users, that's 3,000 writes/second. The debounced approach collapses all operations into a single write every 2 seconds.

**Why not element-level writes?** Could use `jsonb_set()` for individual element updates, but the complexity of tracking dirty elements and constructing the JSON path isn't worth it at this scale. The full JSONB rewrite is fast enough (TOAST compression handles large payloads well).

---

## Development Phases

### Phase 1: Backend Core (Complete)
- [x] PostgreSQL schema with JSONB elements
- [x] Express API with session auth
- [x] Drawing CRUD with access control
- [x] Collaborator management
- [x] Health checks and Prometheus metrics

### Phase 2: WebSocket Collaboration (Complete)
- [x] Room management (Map<drawingId, Set<WebSocket>>)
- [x] Shape operation broadcasting
- [x] CRDT merge on server
- [x] Debounced auto-save to PostgreSQL
- [x] Cursor presence via Redis

### Phase 3: Frontend Canvas (Complete)
- [x] HTML5 Canvas with pan/zoom
- [x] All shape renderers (rect, ellipse, diamond, arrow, line, freehand, text)
- [x] Hit testing for selection
- [x] Drawing interaction model (mousedown/move/up)
- [x] Freehand with Ramer-Douglas-Peucker simplification
- [x] Keyboard shortcuts

### Phase 4: Frontend UI (Complete)
- [x] Toolbar with tool selection
- [x] Properties panel (colors, stroke width, opacity)
- [x] Drawing list/dashboard
- [x] Share dialog with collaborator management
- [x] Login/register pages
- [x] Collaborator cursor overlay

### Phase 5: Polish (Partial)
- [x] WebSocket reconnection with exponential backoff
- [x] Version snapshots
- [x] Zoom indicator
- [ ] Undo/redo
- [ ] Copy/paste
- [ ] Group selection
- [ ] Export to PNG/SVG (server-side rendering)

---

## Design Decisions Log

### Decision 1: JSONB vs Normalized Elements Table
**Context:** How to store drawing elements
**Decision:** Single JSONB column on the drawings table
**Trade-off:** Write amplification on large drawings (rewriting entire column), but eliminates N JOINs and enables flexible element schemas
**Would change:** For 10K+ element drawings, would add element-level JSONB operations

### Decision 2: In-Memory WS Rooms vs Redis Pub/Sub
**Context:** How to manage WebSocket room membership and broadcasting
**Decision:** In-memory Map<drawingId, Set<WebSocket>>
**Trade-off:** Cannot scale horizontally without adding pub/sub layer
**Would change:** For production, add Redis Pub/Sub with channel-per-drawing

### Decision 3: Debounced Save vs Event Sourcing
**Context:** How often to persist drawing state
**Decision:** 2-second debounce, full JSONB write
**Trade-off:** Lose up to 2 seconds of work on crash
**Would change:** For mission-critical drawings, would add WAL-like operation log

### Decision 4: Canvas 2D vs WebGL
**Context:** Rendering technology choice
**Decision:** Canvas 2D API
**Trade-off:** CPU-bound, limited to ~5K elements at 60fps
**Would change:** For production Figma-like apps, would use WebGL with batched draw calls

### Decision 5: DOM Cursor Overlay vs Canvas-Drawn Cursors
**Context:** How to render collaborator cursors
**Decision:** CSS-positioned SVG elements in a DOM layer above canvas
**Trade-off:** Slightly more complex layout (two overlapping layers)
**Would change:** This is actually the right approach -- avoids full canvas redraws

---

## Resources

- [Excalidraw Architecture Blog](https://blog.excalidraw.com/)
- [Canvas API MDN](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
- [Ramer-Douglas-Peucker Algorithm](https://en.wikipedia.org/wiki/Ramer%E2%80%93Douglas%E2%80%93Peucker_algorithm)
- [CRDTs for Collaborative Editing](https://crdt.tech/)
- [Pino Logger](https://getpino.io/)
- [Opossum Circuit Breaker](https://nodeshift.dev/opossum/)
