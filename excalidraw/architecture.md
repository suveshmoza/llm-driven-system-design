# Excalidraw - Collaborative Whiteboard Architecture

## System Overview

A real-time collaborative whiteboard enabling multiple users to simultaneously create and edit vector shapes (rectangles, ellipses, diamonds, arrows, lines, freehand paths, text) on a shared infinite canvas. The system handles conflict resolution using shape-level Last-Writer-Wins (LWW) CRDT, cursor presence tracking, and persistent storage of drawing state.

**Learning Goals:**
- Design real-time collaboration with WebSocket rooms and CRDT conflict resolution
- Implement HTML5 Canvas rendering with viewport transforms (pan/zoom)
- Build cursor presence tracking with Redis-backed ephemeral state
- Understand trade-offs between OT, CRDT, and simpler LWW approaches

## Requirements

### Functional Requirements

1. Users can create, edit, and delete drawings
2. Multiple shape types: rectangle, ellipse, diamond, arrow, line, freehand, text
3. Real-time collaboration: multiple users editing the same drawing simultaneously
4. Live cursor presence: see other collaborators' cursor positions
5. Drawing sharing with view/edit permissions
6. Pan and zoom on infinite canvas
7. Shape properties: stroke color, fill color, stroke width, opacity
8. Persistent storage: drawings survive server restarts

### Non-Functional Requirements (Production Scale)

| Metric | Target |
|--------|--------|
| Collaboration latency | < 50ms peer-to-peer |
| Concurrent users per drawing | 50+ |
| Total concurrent drawings | 100K+ |
| Canvas elements per drawing | 10K+ |
| Availability | 99.9% |
| Data durability | 99.99% |

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Client (Browser)                            │
│  ┌────────────┐  ┌──────────────┐  ┌──────────┐  ┌───────────────┐  │
│  │   Canvas   │  │   Toolbar    │  │  Zustand  │  │  WS Client    │  │
│  │  Renderer  │  │  Properties  │  │  Stores   │  │  REST Client  │  │
│  └────────────┘  └──────────────┘  └──────────┘  └───────────────┘  │
└──────────────────────────┬──────────────────┬────────────────────────┘
                           │ HTTP/REST        │ WebSocket
                           ▼                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         Load Balancer                                │
│                    (Sticky Sessions / IP Hash)                       │
└──────────────────────────┬──────────────────┬────────────────────────┘
                           │                  │
              ┌────────────┴────┐    ┌────────┴────────┐
              │  API Server 1   │    │  API Server 2   │
              │  Express + WS   │    │  Express + WS   │
              │  ┌───────────┐  │    │  ┌───────────┐  │
              │  │ WS Rooms  │  │    │  │ WS Rooms  │  │
              │  │ CRDT Merge│  │    │  │ CRDT Merge│  │
              │  └───────────┘  │    │  └───────────┘  │
              └───────┬─────────┘    └───────┬─────────┘
                      │                      │
         ┌────────────┴──────────────────────┴────────────┐
         │                                                 │
    ┌────▼────┐                                     ┌──────▼──────┐
    │PostgreSQL│                                     │ Redis/Valkey│
    │ Drawings │                                     │  Sessions   │
    │ Elements │                                     │  Cursors    │
    │ Users    │                                     │  Cache      │
    └──────────┘                                     └─────────────┘
```

## Database Schema

### Users

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(30) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    avatar_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Drawings

```sql
CREATE TABLE drawings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL DEFAULT 'Untitled',
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    elements JSONB DEFAULT '[]'::jsonb,   -- Array of shape elements
    app_state JSONB DEFAULT '{}'::jsonb,   -- Viewport, grid settings
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Why JSONB for elements?** Drawing elements are semi-structured (different shapes have different properties like `points`, `text`, `fontSize`). JSONB allows flexible schema evolution without migrations, supports indexing on specific fields via GIN indexes, and enables atomic updates to individual elements using `jsonb_set()`. The trade-off is that complex queries on element properties are slower than normalized tables, but we rarely query individual elements -- we load the entire element array for rendering.

### Drawing Collaborators

```sql
CREATE TABLE drawing_collaborators (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    drawing_id UUID NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(10) NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(drawing_id, user_id)
);
```

### Drawing Versions

```sql
CREATE TABLE drawing_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    drawing_id UUID NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    elements JSONB NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Operations Log

```sql
CREATE TABLE operations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    drawing_id UUID NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    operation_type VARCHAR(10) NOT NULL CHECK (operation_type IN ('add', 'update', 'delete', 'move')),
    element_id VARCHAR(255) NOT NULL,
    element_data JSONB,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Element Schema (JSONB)

Each element in the `elements` array follows this structure:

```json
{
  "id": "el-1700000000-abc123",
  "type": "rectangle",
  "x": 100,
  "y": 100,
  "width": 200,
  "height": 100,
  "points": null,
  "text": null,
  "strokeColor": "#1e1e1e",
  "fillColor": "#a5d8ff",
  "strokeWidth": 2,
  "opacity": 1,
  "fontSize": 16,
  "version": 3,
  "isDeleted": false,
  "createdBy": "user-uuid",
  "updatedAt": 1700000000000
}
```

## API Design

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/v1/auth/register | Register new user |
| POST | /api/v1/auth/login | Login |
| POST | /api/v1/auth/logout | Logout |
| GET | /api/v1/auth/me | Get current user |

### Drawings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/drawings | List user's drawings |
| GET | /api/v1/drawings/public | List public drawings |
| POST | /api/v1/drawings | Create drawing |
| GET | /api/v1/drawings/:id | Get drawing with elements |
| PUT | /api/v1/drawings/:id | Update drawing |
| DELETE | /api/v1/drawings/:id | Delete drawing (owner only) |
| POST | /api/v1/drawings/:id/collaborators | Add collaborator |
| DELETE | /api/v1/drawings/:id/collaborators/:userId | Remove collaborator |
| GET | /api/v1/drawings/:id/collaborators | List collaborators |

### Health & Metrics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/health | Simple health check |
| GET | /api/health/detailed | Detailed health with component status |
| GET | /metrics | Prometheus metrics |

## WebSocket Protocol

All WebSocket communication uses JSON messages over a single `/ws` endpoint.

### Client-to-Server Messages

```
join-room     { type, drawingId, userId, username }
leave-room    { type }
shape-add     { type, elementData }
shape-update  { type, elementData }
shape-delete  { type, elementId }
shape-move    { type, elementData }
elements-sync { type, elements }
cursor-move   { type, x, y }
```

### Server-to-Client Messages

```
connected     { type, color }           -- Assigned cursor color
room-state    { type, drawingId, elements }  -- Full state on join
user-joined   { type, userId, username, color }
user-left     { type, userId, username }
shape-add     { type, userId, elementData }  -- Broadcast
shape-update  { type, userId, elementData }  -- Broadcast
shape-delete  { type, userId, elementId }    -- Broadcast
shape-move    { type, userId, elementData }  -- Broadcast
elements-sync { type, userId, elements }     -- Broadcast
cursor-move   { type, userId, username, x, y, color } -- Broadcast
error         { type, message }
```

## CRDT Approach: Shape-Level LWW

### Why LWW over OT or full CRDT?

| Approach | Pros | Cons |
|----------|------|------|
| **LWW (chosen)** | Simple, low overhead, sufficient for shape editing | Can lose concurrent edits to same element |
| OT (Operational Transform) | Precise character-level merges | Complex, requires central server, hard to implement correctly |
| Full CRDT (Automerge/Yjs) | True conflict-free, decentralized | Large overhead per element, complex data structures |

**Rationale:** In a whiteboard, users typically work on different shapes. Two users simultaneously editing the exact same rectangle is rare. When it does happen, keeping the latest version is acceptable -- the "loser" sees their change replaced, which is a natural experience (someone else moved the box I was editing). For text elements where character-level merging matters, a full CRDT library would be appropriate, but for geometric shapes, LWW provides 90% of the value at 10% of the complexity.

### Merge Algorithm

```
mergeElements(existing[], incoming[]):
  elementMap = Map<id, element>

  for each in existing:
    elementMap[el.id] = el

  for each in incoming:
    current = elementMap[el.id]
    if !current:
      elementMap[el.id] = el          // New element
    else if el.version > current.version:
      elementMap[el.id] = el          // Higher version wins
    else if el.version == current.version AND el.updatedAt > current.updatedAt:
      elementMap[el.id] = el          // Same version, newer timestamp wins
    // else keep existing

  return elementMap.values()
```

### Soft Deletes

Deleted elements are marked `isDeleted: true` rather than removed from the array. This ensures that a delete operation propagating via CRDT doesn't get "undone" by a concurrent update that still references the element. The full array (including deleted elements) is kept for merge correctness; the renderer filters them out.

## Cursor Presence

Cursor positions are stored in Redis hashes with a 30-second TTL:

```
HSET presence:cursors:{drawingId} {userId} '{"userId":"...","username":"...","x":100,"y":200,"color":"#e03131"}'
EXPIRE presence:cursors:{drawingId} 30
```

Real-time cursor updates flow directly through WebSocket broadcast (not through Redis) for minimal latency. Redis serves as the persistence layer so that newly joining users can see existing cursor positions.

## Key Design Decisions

### 1. WebSocket Rooms vs Redis Pub/Sub

**Decision:** In-memory Map<drawingId, Set<WebSocket>> for room management.

**Why:** For a single-server learning project, in-memory rooms are simpler and faster than Redis pub/sub. In production with multiple WebSocket servers, we would need Redis pub/sub or a dedicated message broker to fan out messages across server instances.

**Trade-off:** Cannot horizontally scale WebSocket servers without adding a pub/sub layer. Sticky sessions partially mitigate this (users reconnect to the same server), but new collaborators might be on a different server.

### 2. JSONB vs Normalized Tables for Elements

**Decision:** Store all elements as a JSONB array in the `drawings` table.

**Why:** Elements are always loaded and saved as a complete set. We never query "find all rectangles across all drawings" -- we always operate on one drawing's element set. JSONB enables:
- Single read/write for the entire canvas state
- No JOIN overhead for rendering
- Flexible element schemas (freehand has `points`, text has `fontSize`)

**Trade-off:** Cannot efficiently query individual elements across drawings. JSONB updates require rewriting the entire column (PostgreSQL handles this with TOAST compression, but it is still more expensive than updating a single row). For very large drawings (10K+ elements), the JSONB payload becomes multiple MB, which increases network and parsing overhead.

### 3. Debounced Auto-Save vs Event-Sourced Persistence

**Decision:** Debounced save (2-second idle timer) writing the full element array to PostgreSQL.

**Why:** Event sourcing (persisting every individual operation) provides perfect auditability and undo but requires reconstructing state from the operation log on load. For a whiteboard with potentially thousands of rapid operations per minute (freehand drawing generates ~60 points/second), the operation log grows extremely fast.

**Trade-off:** We lose operations that occur in the 2-second window if the server crashes. The debounced approach is a pragmatic choice: we get near-real-time persistence with manageable write amplification. Version snapshots provide periodic recovery points.

## Consistency and Idempotency

### Idempotent Drawing Operations

Every shape operation (add, update, delete, move) carries a client-generated element ID and a monotonically increasing version number. The server uses these two fields as a natural idempotency key. If a WebSocket message is retried due to a transient network failure or client reconnection, the CRDT merge logic ensures that processing the same operation twice produces the same result. An add operation for an element ID that already exists is treated as an update, and the version comparison determines whether the incoming data supersedes the current state. An update with a version equal to or lower than the existing element version is silently discarded. This means duplicate deliveries never create phantom shapes or corrupt the element array.

For REST API mutations such as creating a drawing or adding a collaborator, the server enforces idempotency through database constraints. The `drawing_collaborators` table has a unique constraint on `(drawing_id, user_id)`, so a retried collaborator-add request returns the existing record rather than creating a duplicate. Drawing creation uses client-provided UUIDs when available, allowing the client to safely retry a failed create without producing duplicate drawings.

### CRDT Convergence Guarantees

The shape-level Last-Writer-Wins register guarantees convergence across all participants in a collaboration session. Every element carries a version counter and a high-resolution timestamp. The merge function is commutative (the order in which updates arrive does not affect the final state), associative (merging pairwise or all at once yields the same result), and idempotent (applying the same update multiple times has no additional effect). These three properties ensure that even when network delays cause operations to arrive out of order or be delivered more than once, all clients converge to the same element state once all messages are processed.

Soft deletes are essential to convergence. If a delete operation physically removed an element from the array, a concurrent update arriving after the delete would re-insert the element, violating the user's intent. By marking elements as `isDeleted: true` with an incremented version, the delete participates in the same LWW comparison as any other update. A concurrent update with a lower version cannot override the delete, and a concurrent update with a higher version intentionally "wins," which is the correct behavior when the updater has not yet seen the delete.

### Retry Semantics for Persistence

The debounced auto-save mechanism writes the full element array to PostgreSQL as a single atomic transaction. If the write fails due to a transient database error, the debounce timer resets and retries after the next idle period. Because the write is a full-state snapshot rather than a delta, retrying is inherently safe. There is no risk of applying a partial update twice or missing intermediate operations. The version snapshot table uses a composite unique constraint on `(drawing_id, version_number)` to prevent duplicate snapshots from concurrent save attempts.

### Exactly-Once Delivery of Collaborative Edits

WebSocket transport provides at-most-once delivery by default. The system achieves effective exactly-once semantics through the idempotent CRDT merge on the receiving side. If a message is lost (connection drop before delivery), the client detects the gap during reconnection by comparing its local element versions against the server's authoritative state. Any elements where the server has a higher version are updated locally, and any local elements with higher versions are re-sent to the server. This reconciliation step closes the gap without requiring message acknowledgment tracking or sequence numbers, keeping the protocol simple while ensuring no edits are permanently lost.

## Security & Auth

- **Session-based authentication** using Redis-backed express-session
- **CORS** restricted to frontend origin (`localhost:5173`)
- **Rate limiting** using Redis sliding window (via rate-limit-redis)
- **Access control**: Drawings are private by default; only owner and explicit collaborators can view/edit
- **WebSocket auth**: Currently relies on the session cookie set during HTTP login. In production, WebSocket connections should validate a short-lived token.

## Observability

### Prometheus Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `excalidraw_http_request_duration_seconds` | Histogram | HTTP request latency |
| `excalidraw_http_requests_total` | Counter | Total HTTP requests |
| `excalidraw_ws_connections_active` | Gauge | Active WebSocket connections |
| `excalidraw_ws_messages_total` | Counter | WebSocket messages by type |
| `excalidraw_drawings_created_total` | Counter | Drawings created |
| `excalidraw_active_sessions` | Gauge | Active user sessions |
| `excalidraw_auth_attempts_total` | Counter | Auth attempts by result |
| `excalidraw_circuit_breaker_state` | Gauge | Circuit breaker states |

### Structured Logging

Pino JSON logger with request tracing (`x-trace-id` header), user context, and query timing.

## Failure Handling

- **Circuit breaker** (Opossum) wrapping database operations to prevent cascade failures
- **WebSocket reconnection** with exponential backoff (client-side, up to 5 attempts)
- **Debounced persistence** ensures drawing state survives short server restarts (last saved state is in PostgreSQL)
- **Graceful shutdown** flushes in-memory room state to database before exit

## Scalability Considerations

### Horizontal Scaling Path

1. **WebSocket Fan-out:** Add Redis Pub/Sub so shape operations broadcast across all WebSocket server instances
2. **Drawing Sharding:** Partition drawings by `drawing_id` hash across database shards
3. **Read Replicas:** Route read-only drawing loads to PostgreSQL replicas
4. **CDN for Static Assets:** Serve frontend bundle and any exported images via CDN
5. **CRDT Library:** Replace LWW with Yjs or Automerge for character-level text merging

### Bottleneck Analysis

| Component | Bottleneck | Mitigation |
|-----------|-----------|------------|
| WebSocket server | Memory per connection (~50KB) | Horizontal scaling with pub/sub |
| PostgreSQL JSONB writes | Write amplification on large drawings | Element-level updates via `jsonb_set()` |
| Redis cursor presence | High write rate (60 updates/second per user) | Throttle to 10 updates/second |
| Canvas rendering | CPU-bound for 10K+ elements | Web Workers for off-screen rendering |

## Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Conflict resolution | Shape-level LWW | Full CRDT (Yjs) | Simpler, sufficient for shape editing |
| Element storage | JSONB column | Normalized elements table | Single read/write, flexible schema |
| Real-time transport | WebSocket | SSE / Long polling | Bidirectional, low latency |
| Persistence strategy | Debounced save | Event sourcing | Lower write amplification |
| Cursor presence | Redis hash + WS | Redis Pub/Sub only | WS for speed, Redis for persistence |
| Session storage | Redis + cookie | JWT | Immediate revocation, simpler |

## Implementation Notes

### Production-Grade Patterns Implemented

1. **Prometheus Metrics** (`services/metrics.ts`): HTTP request duration histograms, WebSocket connection gauges, business metrics (drawings created, auth attempts)
2. **Circuit Breaker** (`services/circuitBreaker.ts`): Opossum-based circuit breaker for database operations with configurable thresholds and half-open recovery
3. **Structured Logging** (`services/logger.ts`): Pino JSON logger with request tracing, user context, and query timing
4. **Rate Limiting** (`services/rateLimiter.ts`): Redis-backed sliding window rate limiting for authentication and drawing operations
5. **Health Checks** (`app.ts`): Liveness, readiness, and detailed component health endpoints

### Simplified for Local Development

- **Single WebSocket server** instead of pub/sub fan-out across instances
- **In-memory room state** instead of distributed state via Redis Streams
- **Session auth** instead of OAuth/JWT for simplicity
- **PostgreSQL full-column JSONB writes** instead of element-level `jsonb_set()` updates

### Omitted (Production Would Need)

- CDN for frontend bundle and exported images
- Multi-region deployment with conflict resolution across regions
- Kubernetes orchestration with auto-scaling WebSocket pods
- Yjs/Automerge for character-level text CRDT
- Server-side canvas rendering for PNG/SVG export (node-canvas or Puppeteer)
- Undo/redo via operation stack
- Offline mode with local-first sync
