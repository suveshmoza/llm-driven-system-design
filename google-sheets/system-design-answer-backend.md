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

```typescript
import { WebSocketServer, WebSocket } from 'ws'
import { redis, redisSubscriber } from './shared/redis'
import { pool } from './shared/db'

interface ClientConnection {
  ws: WebSocket
  userId: string
  spreadsheetId: string
  lastPing: number
}

class CollaborationServer {
  private connections = new Map<string, ClientConnection>()
  private rooms = new Map<string, Set<string>>() // spreadsheetId -> connectionIds

  async handleConnection(ws: WebSocket, spreadsheetId: string, userId: string) {
    const connectionId = `${userId}:${Date.now()}`

    this.connections.set(connectionId, {
      ws,
      userId,
      spreadsheetId,
      lastPing: Date.now()
    })

    // Add to room
    if (!this.rooms.has(spreadsheetId)) {
      this.rooms.set(spreadsheetId, new Set())
      // Subscribe to Redis channel for this spreadsheet
      await redisSubscriber.subscribe(`spreadsheet:${spreadsheetId}`)
    }
    this.rooms.get(spreadsheetId)!.add(connectionId)

    // Update presence in database
    await pool.query(`
      INSERT INTO collaborators (spreadsheet_id, user_id, joined_at, last_seen)
      VALUES ($1, $2, NOW(), NOW())
      ON CONFLICT (spreadsheet_id, user_id)
      DO UPDATE SET last_seen = NOW()
    `, [spreadsheetId, userId])

    // Broadcast user joined
    await this.broadcastToRoom(spreadsheetId, {
      type: 'USER_JOINED',
      userId,
      name: await this.getUserName(userId),
      color: await this.getUserColor(userId)
    }, connectionId)

    // Send current state to new user
    const state = await this.getSpreadsheetState(spreadsheetId)
    ws.send(JSON.stringify({ type: 'STATE_SYNC', ...state }))
  }

  async handleMessage(connectionId: string, message: any) {
    const conn = this.connections.get(connectionId)
    if (!conn) return

    switch (message.type) {
      case 'CELL_EDIT':
        await this.handleCellEdit(conn, message)
        break
      case 'CURSOR_MOVE':
        await this.handleCursorMove(conn, message)
        break
      case 'SELECTION_CHANGE':
        await this.handleSelectionChange(conn, message)
        break
      case 'UNDO':
        await this.handleUndo(conn, message)
        break
      case 'REDO':
        await this.handleRedo(conn, message)
        break
    }
  }

  async handleCellEdit(conn: ClientConnection, message: any) {
    const { sheetId, row, col, value, requestId } = message

    // Check idempotency
    if (requestId) {
      const cached = await redis.get(`idempotent:${requestId}`)
      if (cached) {
        conn.ws.send(cached)
        return
      }
    }

    // Update database
    let computedValue = value
    if (value?.startsWith('=')) {
      // Formula - compute result
      computedValue = await this.computeFormula(sheetId, row, col, value)
    }

    await pool.query(`
      INSERT INTO cells (sheet_id, row_index, col_index, raw_value, computed_value, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (sheet_id, row_index, col_index)
      DO UPDATE SET
        raw_value = EXCLUDED.raw_value,
        computed_value = EXCLUDED.computed_value,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
    `, [sheetId, row, col, value, computedValue, conn.userId])

    // Record in edit history
    const oldValue = await this.getCellValue(sheetId, row, col)
    await pool.query(`
      INSERT INTO edit_history (sheet_id, user_id, operation_type, operation_data, inverse_data)
      VALUES ($1, $2, 'SET_CELL', $3, $4)
    `, [
      sheetId,
      conn.userId,
      JSON.stringify({ row, col, newValue: value }),
      JSON.stringify({ row, col, oldValue })
    ])

    // Broadcast to all clients via Redis pub/sub
    const update = {
      type: 'CELL_UPDATED',
      sheetId,
      row,
      col,
      value,
      computedValue,
      userId: conn.userId
    }

    await redis.publish(`spreadsheet:${conn.spreadsheetId}`, JSON.stringify(update))

    // Store for idempotency
    if (requestId) {
      await redis.set(`idempotent:${requestId}`, JSON.stringify(update), 'EX', 86400)
    }
  }

  async broadcastToRoom(spreadsheetId: string, message: any, excludeConnectionId?: string) {
    const room = this.rooms.get(spreadsheetId)
    if (!room) return

    const messageStr = JSON.stringify(message)
    for (const connectionId of room) {
      if (connectionId === excludeConnectionId) continue
      const conn = this.connections.get(connectionId)
      if (conn?.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(messageStr)
      }
    }
  }
}
```

### Multi-Server Synchronization with Redis Pub/Sub

```typescript
class RedisSubscriptionManager {
  private subscriber: Redis

  constructor() {
    this.subscriber = new Redis(process.env.REDIS_URL)
    this.subscriber.on('message', this.handleMessage.bind(this))
  }

  private handleMessage(channel: string, message: string) {
    // Channel format: spreadsheet:{id}
    const spreadsheetId = channel.split(':')[1]
    const data = JSON.parse(message)

    // Broadcast to all local WebSocket clients in this room
    collaborationServer.broadcastToRoom(spreadsheetId, data)
  }

  async subscribeToSpreadsheet(spreadsheetId: string) {
    await this.subscriber.subscribe(`spreadsheet:${spreadsheetId}`)
  }

  async unsubscribeFromSpreadsheet(spreadsheetId: string) {
    await this.subscriber.unsubscribe(`spreadsheet:${spreadsheetId}`)
  }
}
```

## Deep Dive: Caching Strategy (5 minutes)

### Multi-Layer Cache Architecture

```typescript
import Redis from 'ioredis'

const redis = new Redis(process.env.REDIS_URL)

class SpreadsheetCache {
  // Layer 1: Spreadsheet metadata (30 min TTL)
  async getSpreadsheetMeta(id: string): Promise<SpreadsheetMeta | null> {
    const cached = await redis.get(`spreadsheet:${id}:meta`)
    if (cached) return JSON.parse(cached)

    const result = await pool.query(
      'SELECT * FROM spreadsheets WHERE id = $1',
      [id]
    )
    if (result.rows[0]) {
      await redis.set(
        `spreadsheet:${id}:meta`,
        JSON.stringify(result.rows[0]),
        'EX', 1800
      )
      return result.rows[0]
    }
    return null
  }

  // Layer 2: Cell data using Redis Hashes
  async getCells(sheetId: string): Promise<Map<string, CellData>> {
    const cells = new Map<string, CellData>()

    // Try cache first
    const cached = await redis.hgetall(`sheet:${sheetId}:cells`)
    if (Object.keys(cached).length > 0) {
      for (const [key, value] of Object.entries(cached)) {
        cells.set(key, JSON.parse(value))
      }
      return cells
    }

    // Fall back to database
    const result = await pool.query(
      'SELECT row_index, col_index, raw_value, computed_value, format FROM cells WHERE sheet_id = $1',
      [sheetId]
    )

    const pipeline = redis.pipeline()
    for (const row of result.rows) {
      const key = `${row.row_index}:${row.col_index}`
      const cellData = {
        rawValue: row.raw_value,
        computedValue: row.computed_value,
        format: row.format
      }
      cells.set(key, cellData)
      pipeline.hset(`sheet:${sheetId}:cells`, key, JSON.stringify(cellData))
    }
    pipeline.expire(`sheet:${sheetId}:cells`, 900) // 15 min TTL
    await pipeline.exec()

    return cells
  }

  // Write-through for cell updates
  async updateCell(sheetId: string, row: number, col: number, data: CellData) {
    const key = `${row}:${col}`

    await Promise.all([
      // Update cache
      redis.hset(`sheet:${sheetId}:cells`, key, JSON.stringify(data)),
      // Update database
      pool.query(`
        INSERT INTO cells (sheet_id, row_index, col_index, raw_value, computed_value, format)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (sheet_id, row_index, col_index)
        DO UPDATE SET raw_value = $4, computed_value = $5, format = $6, updated_at = NOW()
      `, [sheetId, row, col, data.rawValue, data.computedValue, data.format])
    ])

    // Invalidate on other servers via pub/sub
    await redis.publish(`invalidate:${sheetId}`, JSON.stringify({ row, col }))
  }

  // Layer 3: Collaborator presence (5 min TTL)
  async getCollaborators(spreadsheetId: string): Promise<Collaborator[]> {
    const cached = await redis.get(`spreadsheet:${spreadsheetId}:collaborators`)
    if (cached) return JSON.parse(cached)

    const result = await pool.query(`
      SELECT c.user_id, c.cursor_row, c.cursor_col,
             c.selection_start_row, c.selection_start_col,
             c.selection_end_row, c.selection_end_col,
             u.name, u.color
      FROM collaborators c
      JOIN users u ON c.user_id = u.id
      WHERE c.spreadsheet_id = $1
        AND c.last_seen > NOW() - INTERVAL '5 minutes'
    `, [spreadsheetId])

    await redis.set(
      `spreadsheet:${spreadsheetId}:collaborators`,
      JSON.stringify(result.rows),
      'EX', 300
    )

    return result.rows
  }
}
```

## Deep Dive: Conflict Resolution (5 minutes)

### Last-Write-Wins Strategy

The backend uses a simple but effective last-write-wins strategy at the cell level:

```typescript
class ConflictResolver {
  // Server is the source of truth
  // All edits go through server, which determines final order
  async handleConcurrentEdits(sheetId: string, edits: CellEdit[]): Promise<CellEdit[]> {
    // Sort by server receive time
    edits.sort((a, b) => a.serverTimestamp - b.serverTimestamp)

    const resolvedEdits: CellEdit[] = []
    const cellVersions = new Map<string, number>()

    for (const edit of edits) {
      const cellKey = `${edit.row}:${edit.col}`
      const currentVersion = cellVersions.get(cellKey) || 0

      // Last write wins - accept if newer
      if (edit.serverTimestamp > currentVersion) {
        cellVersions.set(cellKey, edit.serverTimestamp)
        resolvedEdits.push(edit)
      }
    }

    return resolvedEdits
  }
}

// Why this works for spreadsheets:
// 1. Each cell is an independent unit
// 2. Real conflicts (two users editing same cell) are rare
// 3. Server ordering provides deterministic resolution
// 4. Much simpler than Operational Transformation (OT) or CRDTs
```

### Optimistic Updates with Rollback

```typescript
// Server-side validation
async function validateAndApplyEdit(edit: CellEdit): Promise<EditResult> {
  // Validate cell coordinates
  if (edit.row < 0 || edit.col < 0) {
    return { success: false, error: 'Invalid cell coordinates' }
  }

  // Validate value size
  if (edit.value && edit.value.length > 32768) {
    return { success: false, error: 'Cell value too large' }
  }

  // Apply edit
  const result = await applyEdit(edit)

  if (!result.success) {
    // Tell client to rollback
    return {
      success: false,
      error: result.error,
      rollback: { row: edit.row, col: edit.col, originalValue: result.originalValue }
    }
  }

  return { success: true, computedValue: result.computedValue }
}
```

## Deep Dive: Formula Engine Integration (5 minutes)

### Server-Side Formula Computation

```typescript
import { HyperFormula } from 'hyperformula'

class ServerFormulaEngine {
  private engines = new Map<string, HyperFormula>() // sheetId -> engine

  getOrCreateEngine(sheetId: string): HyperFormula {
    if (!this.engines.has(sheetId)) {
      const hf = HyperFormula.buildEmpty({ licenseKey: 'gpl-v3' })
      hf.addSheet('Sheet1')
      this.engines.set(sheetId, hf)
    }
    return this.engines.get(sheetId)!
  }

  async computeFormula(
    sheetId: string,
    row: number,
    col: number,
    formula: string
  ): Promise<{ computedValue: any; dependents: Array<{ row: number; col: number }> }> {
    const hf = this.getOrCreateEngine(sheetId)

    // Set the formula
    hf.setCellContents({ sheet: 0, row, col }, formula)

    // Get computed value
    const computedValue = hf.getCellValue({ sheet: 0, row, col })

    // Get dependent cells that need recalculation
    const dependents = hf.getCellDependents({ sheet: 0, row, col })
      .map(addr => ({ row: addr.row, col: addr.col }))

    return { computedValue, dependents }
  }

  // Bulk recalculation when a cell changes
  async recalculateDependents(
    sheetId: string,
    changedCell: { row: number; col: number }
  ): Promise<CellUpdate[]> {
    const hf = this.getOrCreateEngine(sheetId)

    // Get all cells that depend on the changed cell
    const dependents = hf.getCellDependents({
      sheet: 0,
      row: changedCell.row,
      col: changedCell.col
    })

    const updates: CellUpdate[] = []

    for (const dep of dependents) {
      const newValue = hf.getCellValue(dep)
      updates.push({
        row: dep.row,
        col: dep.col,
        computedValue: newValue
      })
    }

    return updates
  }

  // Clean up when spreadsheet is closed
  destroyEngine(sheetId: string) {
    const hf = this.engines.get(sheetId)
    if (hf) {
      hf.destroy()
      this.engines.delete(sheetId)
    }
  }
}
```

## Deep Dive: Circuit Breaker for Redis (4 minutes)

```typescript
import CircuitBreaker from 'opossum'

// Circuit breaker for Redis pub/sub operations
const redisPubSubBreaker = new CircuitBreaker(
  async (channel: string, message: string) => {
    await redis.publish(channel, message)
  },
  {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 10000,
    volumeThreshold: 5
  }
)

// Fallback: continue in single-server mode
redisPubSubBreaker.fallback(() => {
  logger.warn('Redis pub/sub unavailable, operating in single-server mode')
  return Promise.resolve()
})

redisPubSubBreaker.on('open', () => {
  metrics.circuitBreakerState.set({ name: 'redis_pubsub' }, 2)
  logger.error('Redis pub/sub circuit breaker OPEN')
})

redisPubSubBreaker.on('close', () => {
  metrics.circuitBreakerState.set({ name: 'redis_pubsub' }, 0)
  logger.info('Redis pub/sub circuit breaker CLOSED')
})

// Usage in broadcast
async function broadcastEdit(spreadsheetId: string, update: CellUpdate) {
  await redisPubSubBreaker.fire(
    `spreadsheet:${spreadsheetId}`,
    JSON.stringify(update)
  )
}
```

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

```typescript
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,              // Maximum connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000  // Kill queries over 5 seconds
})

// Track pool metrics
pool.on('acquire', () => {
  metrics.dbPoolActive.inc()
})

pool.on('release', () => {
  metrics.dbPoolActive.dec()
})
```

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
