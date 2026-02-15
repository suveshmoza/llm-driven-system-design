# Excalidraw - Collaborative Whiteboard (Backend Focus)

## 🎯 Problem Statement

Design a collaborative whiteboard where multiple users can simultaneously draw shapes, see each other's cursors, and have their work persist reliably. Think Excalidraw, Miro, or FigJam -- but focused on the backend challenges of real-time sync, conflict resolution, and persistence.

## 📋 Requirements Clarification

"Before diving in, let me clarify scope and constraints."

**Functional:**
- Multi-user real-time drawing on shared canvas
- Shape types: rectangles, ellipses, lines, arrows, freehand paths, text
- Drawing CRUD with sharing permissions (view/edit)
- Live cursor presence showing collaborator positions and usernames
- Persistent storage with version history for recovery
- Collaborator management with granular access control (view vs edit)

**Non-Functional:**
- Collaboration latency < 50ms for shape operations between peers
- Support 50+ concurrent users per drawing room
- 100K+ concurrent active drawings across the platform
- Handle 10K+ canvas elements per drawing without degradation
- 99.9% availability with graceful degradation under load
- 99.99% data durability for saved drawings
- Graceful conflict resolution for concurrent edits to the same element

**Out of scope:** Image import, templates, mobile clients, offline mode, export to PNG/SVG

> "I want to focus the backend discussion on three hard problems: the real-time collaboration protocol, conflict resolution semantics, and the persistence strategy. These are where the interesting trade-offs live."

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

**Component responsibilities:**

- **API Gateway (nginx):** Terminates TLS, routes HTTP and WebSocket traffic, enforces sticky sessions via IP hash so that a user's WebSocket connection consistently lands on the same backend server. This is critical because room state lives in memory on the server that owns the room.

- **API Server (Express + WS):** Handles REST endpoints for drawing CRUD, user authentication, and collaborator management. Also upgrades HTTP connections to WebSocket for real-time collaboration. Each server instance maintains an in-memory map of active rooms, where a room is a drawing ID mapped to the set of connected WebSocket clients.

- **PostgreSQL:** Stores the authoritative state of all drawings, users, collaborators, and version history. The elements column uses JSONB for flexible schema storage of heterogeneous shape types.

- **Redis (Sessions + Cursors):** Backs express-session for server-side session storage with immediate revocation. Also stores ephemeral cursor positions as Redis hashes with TTLs so that late-joining users see existing collaborator positions.

- **Redis Pub/Sub (scaling path):** Not active in the single-server deployment, but the architecture anticipates adding pub/sub channels per drawing so that shape operations fan out across multiple API server instances.

## 💾 Data Model

> "I chose JSONB for elements because they're always loaded as a complete set for rendering. We never query 'find all rectangles across drawings' -- we always operate on one drawing's full element array. This avoids JOIN overhead and supports flexible element schemas where freehand shapes have a `points` array but rectangles don't."

**Users table** -- standard authentication with UUID primary keys:

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | Auto-generated |
| username | VARCHAR(30) | Unique, used for display |
| email | VARCHAR(255) | Unique, used for login |
| password_hash | VARCHAR(255) | bcrypt hashed |
| display_name | VARCHAR(100) | Optional display name |
| avatar_url | VARCHAR(500) | Optional profile image |
| created_at | TIMESTAMP | Auto-set |
| updated_at | TIMESTAMP | Auto-updated |

**Drawings table** -- the core entity containing all canvas state:

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | Auto-generated |
| title | VARCHAR(255) | Defaults to 'Untitled' |
| owner_id | UUID FK | References users, cascade delete |
| elements | JSONB | Array of all shapes on the canvas |
| app_state | JSONB | Viewport, grid settings, preferences |
| is_public | BOOLEAN | Defaults to false |
| created_at | TIMESTAMP | Auto-set |
| updated_at | TIMESTAMP | Auto-updated on every save |

**Collaborators table** -- access control for shared drawings:

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | Auto-generated |
| drawing_id | UUID FK | References drawings, cascade delete |
| user_id | UUID FK | References users, cascade delete |
| permission | VARCHAR(10) | 'view' or 'edit', checked constraint |
| created_at | TIMESTAMP | Auto-set |

Unique constraint on (drawing_id, user_id) prevents duplicate entries and provides idempotent collaborator-add operations.

**Versions table** -- periodic snapshots for recovery:

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | Auto-generated |
| drawing_id | UUID FK | References drawings |
| version_number | INTEGER | Incrementing per drawing |
| elements | JSONB | Full snapshot of elements at this version |
| created_by | UUID FK | User who triggered the save |
| created_at | TIMESTAMP | Auto-set |

Capped at 50 versions per drawing. Enables recovery from accidental bulk deletes and provides an audit trail of drawing evolution.

**Operations table** -- operation log for debugging and analytics:

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | Auto-generated |
| drawing_id | UUID FK | References drawings |
| user_id | UUID FK | User who performed the operation |
| operation_type | VARCHAR(10) | 'add', 'update', 'delete', 'move' |
| element_id | VARCHAR(255) | Target element identifier |
| element_data | JSONB | Element state after operation |
| version | INTEGER | Element version at operation time |
| created_at | TIMESTAMP | Auto-set |

**Element schema** (stored inside the JSONB elements array): Each element carries an id, type (rectangle, ellipse, diamond, arrow, line, freehand, text), position (x, y), dimensions (width, height), optional points array for freehand and line shapes, styling properties (strokeColor, fillColor, strokeWidth, opacity), a version counter, an updatedAt timestamp for LWW resolution, an isDeleted flag for soft deletes, and a createdBy user reference.

## 🔌 API Design

### Authentication Endpoints

```
POST /api/v1/auth/register    Create new user account
POST /api/v1/auth/login       Authenticate and create session
POST /api/v1/auth/logout      Destroy session
GET  /api/v1/auth/me          Return current authenticated user
```

### Drawing Endpoints

```
GET    /api/v1/drawings              List authenticated user's drawings
GET    /api/v1/drawings/public       List public drawings (paginated)
POST   /api/v1/drawings              Create a new drawing
GET    /api/v1/drawings/:id          Get drawing with full elements array
PUT    /api/v1/drawings/:id          Update drawing metadata or elements
DELETE /api/v1/drawings/:id          Delete drawing (owner only)
```

### Collaborator Endpoints

```
POST   /api/v1/drawings/:id/collaborators           Add collaborator with permission
DELETE /api/v1/drawings/:id/collaborators/:userId    Remove collaborator
GET    /api/v1/drawings/:id/collaborators            List collaborators for drawing
```

### Health and Metrics

```
GET /api/health            Simple liveness check
GET /api/health/detailed   Component-level health (DB, Redis, WS)
GET /metrics               Prometheus metrics endpoint
```

### WebSocket Protocol

All real-time communication uses JSON messages over a single `/ws` endpoint. Client-to-server messages include: join-room (with drawingId, userId, username), leave-room, shape-add (with element data), shape-update, shape-delete (with elementId), shape-move, elements-sync (full state push), and cursor-move (with x, y coordinates). Server-to-client messages include: connected (with assigned cursor color), room-state (full elements array on join), user-joined, user-left, shape operation broadcasts to other room members, cursor-move broadcasts with username and color, and error messages.

## 🔧 Deep Dive 1: Real-Time Collaboration Protocol

### WebSocket Room Management

```
Server maintains: rooms = Map<drawingId, Set<WebSocket>>

join-room:
  1. Client sends { type: 'join-room', drawingId, userId, username }
  2. Server validates user has view or edit permission
  3. Server adds client to room set
  4. Server loads elements from memory (or DB if first joiner)
  5. Server sends { type: 'room-state', elements } to joiner
  6. Server broadcasts { type: 'user-joined' } to other room members

shape-add/update/delete:
  1. Client sends operation with element data
  2. Server validates user has edit permission
  3. Server applies CRDT merge to in-memory state
  4. Server broadcasts to all room members except sender
  5. Server resets debounced DB save timer (2s idle)
```

When the last user leaves a room, the server flushes the in-memory state to PostgreSQL immediately before cleaning up the room entry. This ensures no data loss during graceful departures.

### Trade-off: WebSocket Rooms vs Redis Pub/Sub

| Approach | Pros | Cons |
|----------|------|------|
| ✅ In-memory rooms | Zero-latency broadcast, simple | Single-server only |
| ❌ Redis Pub/Sub | Multi-server fan-out | Added latency (~1ms), complexity |

> "For a single-server deployment, in-memory rooms give the lowest possible broadcast latency. When scaling horizontally, I'd add Redis Pub/Sub: each server subscribes to channels for its active drawing rooms, and operations publish to the channel. The trade-off is ~1ms added latency per message, but this is well within our 50ms target. Sticky sessions ensure a user's WebSocket typically stays on one server, reducing cross-server traffic."

### Message Ordering and Delivery

WebSocket over TCP guarantees in-order delivery per connection, but messages from different users arrive in nondeterministic order at the server. The CRDT merge function handles this: because it is commutative and associative, the final state is the same regardless of arrival order. The server does not buffer or reorder messages -- it applies each operation immediately and broadcasts the result. This keeps latency minimal at the cost of transient inconsistency windows where two clients may briefly see different states until the next message arrives.

## 🔧 Deep Dive 2: Conflict Resolution with Shape-Level LWW

### The Core Problem

Two users simultaneously edit the same rectangle -- User A changes its color while User B moves it. Without conflict resolution, one update overwrites the other entirely, losing either the color change or the position change.

### Shape-Level Last-Writer-Wins

Each element carries: `id`, `version` (integer), `updatedAt` (timestamp)

```
mergeElements(existing[], incoming[]):
  for each incoming element:
    current = existing[element.id]
    if !current                                       ──▶ add element
    if element.version > current.version              ──▶ replace
    if same version, element.updatedAt > current.updatedAt ──▶ replace
    else                                              ──▶ keep existing
```

### Trade-off: LWW vs Full CRDT (Yjs/Automerge) vs OT

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Shape-level LWW | Simple, low overhead, 50 LOC | Loses one edit on same-element conflict |
| ❌ Full CRDT (Yjs) | True conflict-free merging | 100KB+ library, complex data structures |
| ❌ OT (Operational Transform) | Precise character-level merges | Requires centralized transform server, hard to implement correctly |

> "I chose LWW because whiteboard users typically work on different shapes. The probability of two users editing the exact same rectangle at the exact same moment is low. When it happens, the user whose edit 'loses' sees their change replaced -- which feels natural ('someone else moved the box I was editing'). For text elements where character-level merging matters, I'd integrate Yjs, but for geometric shapes, LWW provides 90% of the value at 10% of the complexity."

> "OT is what Google Docs uses and it provides mathematically precise merging of concurrent operations. But OT requires a centralized transform server that sequences all operations and computes the transformed indices. This adds a single point of failure and increases latency because every operation must round-trip through the sequencer. For a whiteboard where operations are at the shape level rather than the character level, OT's precision is unnecessary overhead."

### Why Version + Timestamp (Not Just Timestamp)

Using timestamps alone for conflict resolution has a subtle failure mode: clock skew between clients can cause a slower machine's edits to always lose, regardless of actual recency. The version counter provides a reliable ordering that does not depend on clock synchronization. Timestamps serve only as a tiebreaker when versions match, which should only happen when two clients increment from the same base version simultaneously.

### Soft Deletes for CRDT Correctness

Deleted elements are marked `isDeleted: true` rather than removed. This prevents a subtle bug: if User A deletes element X while User B concurrently updates element X, User B's update would "resurrect" the element if the delete had physically removed it from the array. With soft deletes, the CRDT merge sees the higher-version delete and keeps it deleted. The renderer filters out soft-deleted elements during display.

### Vector Clocks as an Alternative

A more sophisticated approach would assign each client a logical clock and use vector clocks to detect true concurrency (where neither operation causally precedes the other). This would allow the system to present concurrent edits to the user for manual resolution rather than silently discarding one. The cost is significant: vector clocks grow linearly with the number of participants, and the merge logic becomes substantially more complex. For a whiteboard where "last write wins" is an acceptable UX, the simpler version-plus-timestamp approach is justified.

## 🔧 Deep Dive 3: Persistence Strategy

### Debounced Auto-Save

Rather than writing every operation to the database (which would generate thousands of writes during freehand drawing at 60 points/second), the server uses a debounced save:

1. After each shape operation, reset a 2-second timer
2. When the timer fires, write the full element array to PostgreSQL in a single atomic transaction
3. On room empty (last user leaves), flush immediately
4. On server shutdown (SIGTERM), flush all active rooms before exit

The full-state write is inherently idempotent: if the database write fails and retries, writing the same snapshot twice produces the same result. There is no risk of partial application or double-counting.

### Write-Ahead Strategy

For scenarios where the 2-second data loss window is unacceptable, a write-ahead log (WAL) approach would persist each operation to a lightweight append-only store (Redis Streams or a dedicated operations table) before broadcasting. On server crash, the WAL is replayed to reconstruct the state since the last snapshot. This reduces the data loss window to effectively zero at the cost of one additional write per operation. For a whiteboard application where losing 2 seconds of strokes is tolerable, the debounced approach is the pragmatic choice.

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

Old snapshots beyond the cap are pruned on a FIFO basis. The version number increments monotonically per drawing, providing a clear timeline.

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

The server throttles cursor broadcasts from 60fps (the rate at which the browser fires mousemove events) down to 10fps. This reduces WebSocket message volume by 6x while maintaining a smooth visual experience for other users. The throttle is applied per-user on the server side so that a misbehaving client cannot flood the room.

## 🗄️ Caching Strategy

Drawing metadata (title, owner, collaborator list, permissions) is cached in Redis with a 5-minute TTL. When a user opens the drawing list page, the API reads from cache rather than querying PostgreSQL. Cache invalidation occurs on write: creating, updating, or deleting a drawing evicts the relevant cache keys.

The full elements array is not cached in Redis because it lives in the server's in-memory room state during active collaboration. When no users are in a room, the elements are only in PostgreSQL. Loading a drawing from the database into memory when the first user joins takes 10-50ms depending on element count, which is acceptable since it happens once per room activation.

Session data uses Redis with a 24-hour TTL. This provides immediate revocation (deleting the session key logs the user out instantly) and avoids storing session state on the API server, which would break horizontal scaling.

## 🛡️ Failure Handling

**WebSocket disconnection:** When a client disconnects unexpectedly, the server removes them from the room set, broadcasts a user-left message to remaining participants, and updates the Redis cursor hash by removing their entry. If the room becomes empty, it triggers an immediate flush to PostgreSQL.

**WebSocket reconnection:** The client implements exponential backoff with jitter, starting at 500ms and capping at 30 seconds. On reconnection, the client re-sends a join-room message. The server responds with the current room-state, and the client reconciles its local elements with the server's authoritative copy using the same CRDT merge function. Any local changes made during the disconnection window are re-sent to the server.

**Database failure:** Database operations are wrapped in a circuit breaker. When PostgreSQL becomes unavailable, the circuit opens after 5 consecutive failures. In-memory room state continues to serve active collaborators without interruption. The debounced save retries accumulate, and once the circuit closes (half-open probe succeeds), all pending saves flush. During the outage, new drawing creation and listing fail gracefully with 503 responses.

**Redis failure:** If Redis becomes unavailable, sessions degrade (users may need to re-authenticate), cursor persistence is lost (but WebSocket broadcast cursors continue working), and rate limiting falls back to in-memory counters per server. The circuit breaker pattern prevents Redis connection attempts from blocking request processing.

**Server crash recovery:** On startup, the server has no in-memory room state. The first user to join a drawing triggers a load from PostgreSQL, which represents the last debounced save. Up to 2 seconds of operations may be lost. This is mitigated by the client holding its own local state and re-sending it during the reconnection reconciliation.

## 📡 Observability

**Prometheus metrics** track HTTP request duration (histogram), total HTTP requests (counter by method, path, status), active WebSocket connections (gauge), WebSocket messages by type (counter), drawings created (counter), active sessions (gauge), authentication attempts by result (counter), and circuit breaker state transitions (gauge).

**Structured logging** uses Pino with JSON output. Each log entry includes a request trace ID (from the x-trace-id header), user context (userId if authenticated), query timing for database operations, and WebSocket room events (join, leave, flush). Log levels follow standard severity: error for failures requiring attention, warn for degraded states (circuit breaker open), info for business events (drawing created, collaborator added), debug for protocol-level detail (individual shape operations).

**Health checks** expose three levels: a simple liveness check at `/api/health` that returns 200 if the process is running, a readiness check that verifies PostgreSQL and Redis connectivity, and a detailed check at `/api/health/detailed` that reports component-level status with latency measurements for each dependency.

## 📊 Scaling Path

1. **Phase 1 (Current):** Single server, in-memory rooms, debounced PostgreSQL saves
2. **Phase 2 (10K users):** Add Redis Pub/Sub for cross-server WebSocket fan-out, sticky sessions via nginx IP hash, read replicas for drawing list queries
3. **Phase 3 (100K users):** Shard drawings by ID hash across database nodes, dedicated WebSocket gateway layer separated from REST API servers, CDN for frontend static assets
4. **Phase 4 (1M users):** Element-level JSONB updates via `jsonb_set()` to reduce write amplification on large drawings, distributed CRDT via Yjs for text elements, connection pooling with PgBouncer, regional deployment with cross-region CRDT sync

### What Breaks First

**WebSocket connections** are the first bottleneck. Each connection consumes approximately 50KB of memory for the socket buffer plus the room state reference. A single server with 8GB of RAM can handle roughly 50K-100K concurrent connections before memory pressure causes degradation. Horizontal scaling with Redis Pub/Sub is the primary mitigation.

**PostgreSQL write throughput** becomes a concern with thousands of active drawings. Each debounced save writes a full JSONB column, which for large drawings (10K elements) can be several megabytes. At 1,000 concurrent active rooms with 2-second debounce, the database sees 500 writes/second, each potentially writing 1-5MB of JSONB. Connection pooling, batched writes, and eventual sharding address this.

**Redis cursor write rate** scales with the number of active users times the cursor update frequency. At 100K users updating at 10fps, Redis sees 1M writes/second for cursor data alone. Redis can handle this throughput, but the network bandwidth becomes significant. Throttling cursor updates further (to 5fps) or moving cursor persistence to an in-memory data structure with periodic Redis syncs would reduce the load.

## ⚖️ Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Conflict resolution | Shape-level LWW | Full CRDT (Yjs) | Simple, sufficient for shapes |
| Element storage | JSONB column | Normalized table | Single read/write, flexible schema |
| Real-time transport | WebSocket | SSE / Long polling | Bidirectional, low latency |
| Persistence | Debounced save | Event sourcing | Lower write amplification |
| Room management | In-memory Map | Redis Pub/Sub | Zero-latency for single server |
| Cursor storage | Redis hash + WS | WS only | Late-joiner cursor persistence |
| Session storage | Redis + cookie | JWT | Immediate revocation, simpler |
| Conflict ordering | Version + timestamp | Vector clocks | Simpler, acceptable UX for whiteboards |
| Database writes | Full JSONB rewrite | Element-level jsonb_set | Simpler, sufficient at current scale |
| Cache strategy | Redis metadata cache | Full element caching | Elements live in-memory during collaboration |
