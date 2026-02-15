# Google Sheets - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Opening Statement (1 minute)

"I'll design Google Sheets, a collaborative spreadsheet application supporting real-time multi-user editing with formula calculations. As a backend engineer, I'll focus on the WebSocket infrastructure for real-time synchronization, PostgreSQL schema design with sparse cell storage, Redis pub/sub for multi-server coordination, and the conflict resolution strategy that ensures consistency across collaborators.

The key backend challenges are managing WebSocket connections at scale, implementing efficient sparse cell storage, ensuring last-write-wins consistency across distributed servers, and integrating with a formula engine for dependency tracking and recalculation."

## Requirements Clarification (3 minutes)

### Functional Requirements
- **Spreadsheet Management**: Create, open, edit, and delete spreadsheets
- **Real-time Collaboration**: Multiple users editing simultaneously with live cursor visibility
- **Formula Support**: Excel-compatible formulas with dependency tracking
- **Cell Formatting**: Bold, colors, alignment, number formats
- **Grid Operations**: Resize columns/rows, undo/redo

### Non-Functional Requirements
- **Scale**: Support 10,000+ rows/columns per sheet via sparse storage
- **Latency**: Sub-100ms for local edits, <200ms for broadcast to collaborators
- **Consistency**: Last-write-wins per cell with server as source of truth
- **Availability**: Graceful degradation (read-only mode if database unavailable)

### Scale Estimates
- 100K edits per second globally
- 2M concurrent WebSocket connections
- 600 KB average per active spreadsheet
- 100 MB/s broadcast bandwidth

## High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────┐
│                           Clients                                │
│      Browser 1 (Alice)    Browser 2 (Bob)    Browser 3 (Carol)  │
│              │                  │                  │             │
│              └──────────────────┼──────────────────┘             │
│                        WebSocket │                               │
│                                  ▼                               │
│         ┌────────────────────────────────────────┐              │
│         │        WebSocket Server Cluster         │              │
│         │   (Real-time Collaboration Hub)        │              │
│         └────────────────┬───────────────────────┘              │
│                          │                                       │
│         ┌────────────────┴───────────────────┐                  │
│         ▼                                    ▼                  │
│  ┌──────────────┐                   ┌──────────────┐           │
│  │  REST API    │                   │    Redis     │           │
│  │  (CRUD ops)  │                   │  Pub/Sub +   │           │
│  │              │                   │  Sessions +  │           │
│  │              │                   │  Cache       │           │
│  └──────┬───────┘                   └──────────────┘           │
│         │                                                       │
│         ▼                                                       │
│  ┌──────────────┐                                               │
│  │  PostgreSQL  │                                               │
│  │ (Persistence)│                                               │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **WebSocket Server** | Real-time message routing, presence management, cell edit broadcasting |
| **REST API** | CRUD for spreadsheets/sheets, initial data load, export |
| **Redis** | Session storage, pub/sub for multi-server sync, cell cache |
| **PostgreSQL** | Durable storage for all data, edit history for undo/redo |
| **Formula Engine** | HyperFormula (in-memory per server) for dependency tracking |

## Deep Dive: Database Schema (8 minutes)

### Core Tables

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **users** | id (UUID PK), session_id (unique), name (default 'Anonymous'), color (hex, default '#4ECDC4'), last_seen | idx_users_session (session_id) | Session-based auth with display color for cursor visibility |
| **spreadsheets** | id (UUID PK), title (default 'Untitled Spreadsheet'), owner_id (FK to users) | — | Top-level document container |
| **sheets** | id (UUID PK), spreadsheet_id (FK cascade), name (default 'Sheet1'), sheet_index, frozen_rows, frozen_cols | idx_sheets_spreadsheet (spreadsheet_id) | Tabs within a spreadsheet |
| **cells** | id (UUID PK), sheet_id (FK cascade), row_index, col_index, raw_value (text, formulas start with '='), computed_value (text), format (JSONB for styling) | idx_cells_sheet (sheet_id), idx_cells_position (sheet_id, row_index, col_index) | SPARSE storage -- only non-empty cells are stored; unique constraint on (sheet_id, row_index, col_index) |

### Sparse Storage Pattern

The key insight is that most cells in a spreadsheet are empty. Storing only non-empty cells provides massive efficiency:

**Cell update** uses an UPSERT pattern: insert the cell with the new value, and on conflict (same sheet_id, row_index, col_index), update the raw_value, computed_value, updated_by, and updated_at timestamp.

**Cell clear** simply deletes the row for that sheet_id, row_index, col_index combination.

**Viewport loading** uses an efficient range query: select all cells for a given sheet where row_index and col_index fall within the requested viewport boundaries. This avoids loading the entire sheet and only fetches the cells visible on screen.

### Edit History for Undo/Redo

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **edit_history** | id (UUID PK), sheet_id (FK cascade), user_id (FK), operation_type, operation_data (JSONB -- forward operation), inverse_data (JSONB -- for undo) | idx_edit_history_sheet (sheet_id, created_at DESC) | Each entry stores both the forward and inverse operation so undo/redo can be replayed. Example: operation_data stores the new value for a cell, inverse_data stores the old value. |

### Collaborators Presence Table

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **collaborators** | spreadsheet_id + user_id (composite PK, both FK cascade), cursor_row, cursor_col, selection_start_row, selection_start_col, selection_end_row, selection_end_col, joined_at, last_seen | idx_collaborators_spreadsheet (spreadsheet_id) | Tracks cursor positions and selection ranges for each active collaborator |

## Deep Dive: WebSocket Infrastructure (8 minutes)

### Connection Management

The collaboration server maintains two in-memory data structures: a map of connection IDs to client metadata (WebSocket reference, user ID, spreadsheet ID, last ping time), and a map of spreadsheet IDs to sets of connection IDs ("rooms").

**Handling a new connection:**

1. Generate a connection ID from the user ID and timestamp.
2. Register the connection in the connections map.
3. If this is the first connection to a spreadsheet, create a new room and subscribe to the Redis pub/sub channel for that spreadsheet.
4. Add the connection to the room.
5. UPSERT the collaborators table to record presence (or refresh last_seen).
6. Broadcast a USER_JOINED event (with user name and cursor color) to all other clients in the room.
7. Send the full spreadsheet state (all cells, sheets, collaborators) to the newly connected client.

**Handling incoming messages:**

The server dispatches on message type: CELL_EDIT, CURSOR_MOVE, SELECTION_CHANGE, UNDO, or REDO.

**Handling a cell edit:**

1. Check the idempotency cache in Redis using the request ID. If already processed, return the cached response.
2. If the value starts with "=", compute the formula result using the server-side formula engine.
3. UPSERT the cell in the database with the raw value and computed value.
4. Record the edit in edit_history with both forward and inverse data for undo support.
5. Publish the CELL_UPDATED event to Redis pub/sub for the spreadsheet channel (this reaches all servers).
6. Store the response in Redis for idempotency (24-hour TTL).

**Broadcasting to a room:**

Iterate all connections in the room, skip the sender (if specified), and send the serialized message to each connection whose WebSocket is in the OPEN state.

### Multi-Server Synchronization with Redis Pub/Sub

A dedicated Redis subscriber listens for messages on spreadsheet channels (format: `spreadsheet:{id}`). When a message arrives, the manager extracts the spreadsheet ID from the channel name, parses the message, and broadcasts it to all local WebSocket clients in that spreadsheet's room. This ensures that edits made on Server A are immediately visible to clients connected to Server B.

The manager subscribes to a channel when the first local client opens a spreadsheet, and unsubscribes when the last local client disconnects.

## Deep Dive: Caching Strategy (5 minutes)

### Multi-Layer Cache Architecture

The cache operates in three layers:

**Layer 1 - Spreadsheet metadata (30-minute TTL):** Check Redis for cached metadata. On miss, query PostgreSQL, cache the result, and return.

**Layer 2 - Cell data using Redis Hashes (15-minute TTL):** Cell data is stored in Redis hashes keyed by `sheet:{sheetId}:cells`, with individual cells keyed as `{row}:{col}`. On cache miss, load all cells for the sheet from PostgreSQL and populate the Redis hash using a pipeline for efficiency. For cell updates, a write-through strategy is used: the cache and database are updated in parallel. Cache invalidation events are published via Redis pub/sub to other servers.

**Layer 3 - Collaborator presence (5-minute TTL):** Active collaborators for a spreadsheet are cached in Redis. The query joins the collaborators table with users to include cursor positions, selection ranges, names, and colors. Only collaborators seen within the last 5 minutes are included.

## Deep Dive: Conflict Resolution (5 minutes)

### Last-Write-Wins Strategy

The backend uses a simple but effective last-write-wins strategy at the cell level:

All edits are routed through the server, which assigns a server-receive timestamp to determine ordering. When concurrent edits arrive for the same cell, the server sorts them by timestamp and keeps only the most recent value. Each cell is treated as an independent unit, so edits to different cells never conflict.

> "This works for spreadsheets because: (1) each cell is an independent unit, (2) real conflicts where two users edit the same cell simultaneously are rare, (3) server ordering provides deterministic resolution, and (4) this is much simpler than Operational Transformation or CRDTs."

### Optimistic Updates with Rollback

Server-side validation runs before applying each edit:

1. **Validate cell coordinates** - Reject if row or column index is negative.
2. **Validate value size** - Reject if the cell value exceeds 32,768 characters.
3. **Apply the edit** - Attempt to write to the database.
4. **Handle failure** - If the edit fails, return a rollback instruction to the client containing the original cell value so the client can revert its optimistic update.

## Deep Dive: Formula Engine Integration (5 minutes)

### Server-Side Formula Computation

The server maintains an in-memory HyperFormula engine instance per active sheet. When a formula is set in a cell:

1. **Get or create engine** - If no HyperFormula instance exists for this sheet, create one with an empty sheet.
2. **Set cell contents** - Pass the formula string to HyperFormula at the specified row and column.
3. **Get computed value** - Retrieve the calculated result from the engine.
4. **Get dependents** - Query HyperFormula for all cells that depend on this cell (for cascade recalculation).

**Bulk recalculation:** When a cell changes, the engine identifies all dependent cells (those with formulas referencing the changed cell). For each dependent, the server retrieves the new computed value and returns the list of cell updates that need to be broadcast to clients.

**Cleanup:** When a spreadsheet is closed (no active connections), the HyperFormula instance is destroyed and removed from memory to prevent leaks.

## Deep Dive: Circuit Breaker for Redis (4 minutes)

Redis pub/sub operations are wrapped in a circuit breaker with a 5-second timeout, 50% error threshold, and 10-second reset timeout (minimum 5 requests before evaluating). The fallback continues operation in single-server mode -- edits still work locally but are not broadcast to other servers.

The breaker emits events on state transitions: when it opens, a Prometheus metric is set to indicate Redis pub/sub is unavailable and an error is logged. When it closes, the metric resets and an info log is written.

For broadcasting edits, the circuit breaker wraps the Redis PUBLISH call, ensuring that Redis failures do not block cell editing on the primary server.

## Database Indexing and Query Optimization (3 minutes)

### Index Strategy

| Index | Purpose | Query Pattern |
|-------|---------|---------------|
| `idx_users_session` | Session lookup | `WHERE session_id = ?` |
| `idx_sheets_spreadsheet` | Load spreadsheet | `WHERE spreadsheet_id = ?` |
| `idx_cells_sheet` | Load all cells | `WHERE sheet_id = ?` |
| `idx_cells_position` | Viewport loading | `WHERE sheet_id = ? AND row_index BETWEEN ? AND ?` |
| `idx_collaborators_spreadsheet` | Presence list | `WHERE spreadsheet_id = ?` |
| `idx_edit_history_sheet` | Undo stack | `WHERE sheet_id = ? ORDER BY created_at DESC` |

### Connection Pool Configuration

The PostgreSQL connection pool is configured with a maximum of 20 connections, 30-second idle timeout, 2-second connection timeout, and a 5-second statement timeout to kill runaway queries. Pool metrics (active connections) are tracked via Prometheus counters on acquire and release events.

## Trade-offs Discussion (3 minutes)

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Conflict Resolution | Last-write-wins | OT/CRDT | Much simpler, good enough for cells |
| Cell Storage | Sparse (only non-empty) | Dense array | 1000x storage efficiency |
| Multi-server Sync | Redis Pub/Sub | Kafka | Lower latency, simpler for real-time |
| Formula Engine | HyperFormula | Custom | 380+ Excel functions, battle-tested |
| Session Storage | Redis | PostgreSQL | Fast lookups, natural TTL support |
| Database | PostgreSQL | MongoDB | ACID for edit history, JSONB for flexibility |

### Limitations and Future Improvements

1. **No Offline Support**: Would require CRDTs for proper offline merge
2. **Single Redis Instance**: Production would need Redis Cluster
3. **Formula Engine Per-Server**: State must be synced across servers
4. **Large Formula Graphs**: Complex dependencies may cause recalculation lag

## Closing Summary (1 minute)

"The Google Sheets backend architecture centers on three key systems:

1. **WebSocket Infrastructure**: Connection management with room-based routing, heartbeat for connection health, and full state sync on reconnect.

2. **Sparse Cell Storage**: PostgreSQL with UPSERT pattern stores only non-empty cells, reducing storage by orders of magnitude while supporting viewport-based loading.

3. **Multi-Server Synchronization**: Redis pub/sub enables real-time broadcast across server instances, with circuit breakers for graceful degradation when Redis is unavailable.

The key architectural insight is that treating each cell as an independent unit simplifies conflict resolution dramatically. Last-write-wins per cell is sufficient because real conflicts (two users editing the same cell simultaneously) are rare in practice, and the server ordering provides deterministic resolution."
