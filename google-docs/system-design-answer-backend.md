# Google Docs - System Design Interview Answer (Backend Focus)

> **Role Focus**: Backend Engineer - Databases, APIs, OT Algorithm, Caching, Message Queues, Scalability

## Opening Statement

"Today I'll design Google Docs, a real-time collaborative document editing platform. As a backend engineer, I'll focus on the Operational Transformation algorithm for concurrent editing, the storage model for documents and version history, the WebSocket protocol for real-time sync, and the caching strategy that enables sub-100ms operation latency."

---

## Step 1: Requirements Clarification (3-5 minutes)

### Functional Requirements

1. **Document creation and editing** - Rich text with formatting (bold, italic, headings, lists)
2. **Real-time collaboration** - Multiple users editing simultaneously
3. **Cursor and selection sharing** - See where others are typing
4. **Version history** - View and restore previous versions
5. **Comments and suggestions** - Threaded comments, suggestion mode
6. **Sharing and permissions** - View, comment, edit access levels

### Non-Functional Requirements (Backend-Specific)

- **Latency**: < 100ms for operation sync to collaborators, < 500ms document load
- **Consistency**: Strong consistency for document state via OT
- **Throughput**: 5M operations/second at scale
- **Durability**: Zero data loss - operations persisted before acknowledgment
- **Availability**: 99.99% uptime

### Backend Challenges I'll Focus On

1. **OT Algorithm**: Transform concurrent operations for consistent state
2. **Storage Model**: Snapshots + operation logs for efficient versioning
3. **WebSocket Protocol**: Bidirectional real-time communication
4. **Caching Strategy**: Redis for sessions, presence, and operation buffering
5. **Horizontal Scaling**: Sticky sessions with Redis pub/sub coordination

---

## Step 2: Scale Estimation (2-3 minutes)

**Traffic patterns:**
- 100 million DAU, average 30 edits/minute when active
- Peak concurrent users: 10M
- Peak operations: 5M ops/second

**Storage calculations:**
- 1B documents * 50KB average = 50 TB base storage
- Version history (10x): 500 TB
- Operations log: 200 bytes/op * 10B ops/day = 2 TB/day

**Connection estimates:**
- 10M concurrent WebSocket connections
- ~10K connections per server = 1,000 servers
- Each document served by single server (sticky sessions)

---

## Step 3: High-Level Architecture (5 minutes)

```
                              +------------------+
                              |   Web Browser    |
                              |   (TipTap/PM)    |
                              +--------+---------+
                                       |
                            HTTP REST + WebSocket
                                       |
              +------------------------v------------------------+
              |              Load Balancer (nginx)              |
              |       Sticky sessions by document_id hash       |
              +----+--------+--------+--------+--------+--------+
                   |        |        |        |        |
              +----v---+ +--v----+ +-v-----+ +-v-----+ +-v-----+
              | API-1  | | API-2 | | API-3 | | API-4 | | API-5 |
              | OT Eng | | OT Eng| | OT Eng| | OT Eng| | OT Eng|
              +---+----+ +---+---+ +---+---+ +---+---+ +---+---+
                  |          |         |         |         |
                  +----------+---------+---------+---------+
                             |                   |
              +--------------v---+   +-----------v-----------+
              |      Redis       |   |      PostgreSQL       |
              |  (sessions,      |   |  (documents, users,   |
              |   pub/sub,       |   |   versions, ops,      |
              |   presence)      |   |   comments)           |
              +------------------+   +-----------------------+
```

### Core Components

| Component | Responsibility | Technology |
|-----------|---------------|------------|
| **API Server** | REST + WebSocket, OT processing | Node.js, Express, ws library |
| **OT Engine** | Transform concurrent operations | Custom TypeScript implementation |
| **Session Store** | User sessions, connection tracking | Redis with 24h TTL |
| **Pub/Sub Bus** | Cross-server operation broadcast | Redis pub/sub |
| **Primary Database** | Documents, permissions, versions | PostgreSQL 16 with JSONB |

---

## Step 4: Deep Dive - Operational Transformation Engine (10 minutes)

### The Fundamental Problem

Two users typing simultaneously:

```
Initial: "Hello"

User A: Insert "!" at position 5 -> "Hello!"
User B: Insert " World" at position 5 -> "Hello World"

If both apply naively:
A applies B's op: "Hello World!" - CORRECT
B applies A's op at pos 5: "Hello! World" - WRONG!
```

The same operation produces different results depending on order.

### OT Transform Functions

```typescript
interface InsertOp {
  type: 'insert';
  position: number;
  text: string;
  clientId: string;
  version: number;
}

interface DeleteOp {
  type: 'delete';
  position: number;
  length: number;
  clientId: string;
  version: number;
}

type Operation = InsertOp | DeleteOp;

// Transform Insert against Insert
function transformII(op1: InsertOp, op2: InsertOp): InsertOp {
  if (op1.position < op2.position) {
    // op1 happens before op2, shift op2 right
    return { ...op2, position: op2.position + op1.text.length };
  } else if (op1.position > op2.position) {
    // op2 happens before op1, no change needed
    return op2;
  } else {
    // Same position - use clientId for deterministic ordering
    if (op1.clientId < op2.clientId) {
      return { ...op2, position: op2.position + op1.text.length };
    }
    return op2;
  }
}

// Transform Delete against Insert
function transformDI(del: DeleteOp, ins: InsertOp): DeleteOp | DeleteOp[] {
  if (del.position >= ins.position) {
    // Delete after insert - shift delete right
    return { ...del, position: del.position + ins.text.length };
  } else if (del.position + del.length <= ins.position) {
    // Delete entirely before insert - no change
    return del;
  } else {
    // Delete range spans insert point - split into two deletes
    const leftLength = ins.position - del.position;
    const rightLength = del.length - leftLength;
    return [
      { ...del, length: leftLength },
      { ...del, position: ins.position + ins.text.length, length: rightLength }
    ];
  }
}

// Transform Insert against Delete
function transformID(ins: InsertOp, del: DeleteOp): InsertOp {
  if (ins.position <= del.position) {
    // Insert before delete - no change
    return ins;
  } else if (ins.position >= del.position + del.length) {
    // Insert after delete - shift left
    return { ...ins, position: ins.position - del.length };
  } else {
    // Insert inside deleted region - place at delete start
    return { ...ins, position: del.position };
  }
}

// Transform Delete against Delete
function transformDD(op1: DeleteOp, op2: DeleteOp): DeleteOp | null {
  const op1End = op1.position + op1.length;
  const op2End = op2.position + op2.length;

  if (op2End <= op1.position) {
    // op2 entirely before op1 - shift op1 left
    return { ...op1, position: op1.position - op2.length };
  } else if (op2.position >= op1End) {
    // op2 entirely after op1 - no change
    return op1;
  } else {
    // Overlapping deletes - compute remaining range
    const newStart = Math.max(op1.position, op2.position) -
                     Math.min(op2.length, op2.position - op1.position);
    const overlapStart = Math.max(op1.position, op2.position);
    const overlapEnd = Math.min(op1End, op2End);
    const overlap = overlapEnd - overlapStart;

    if (overlap >= op1.length) {
      return null; // op1 completely covered by op2
    }

    return {
      ...op1,
      position: op1.position < op2.position ? op1.position : op1.position - op2.length,
      length: op1.length - overlap
    };
  }
}
```

### Server-Side Operation Processing

```typescript
class OTEngine {
  private pendingOps: Map<string, Operation[]> = new Map(); // docId -> ops
  private versions: Map<string, number> = new Map();

  async processOperation(
    docId: string,
    clientOp: Operation,
    clientVersion: number
  ): Promise<{ transformed: Operation; serverVersion: number }> {
    const serverVersion = this.versions.get(docId) || 0;

    // Get operations client hasn't seen
    const missedOps = await this.getOperationsSince(docId, clientVersion);

    // Transform client operation against all missed ops
    let transformed = clientOp;
    for (const serverOp of missedOps) {
      transformed = this.transform(transformed, serverOp);
    }

    // Apply to document state
    await this.applyOperation(docId, transformed);

    // Increment version atomically
    const newVersion = await redis.incr(`doc:${docId}:version`);

    // Store operation for future transforms
    await this.storeOperation(docId, newVersion, transformed);

    // Broadcast to other clients via pub/sub
    await redis.publish(`channel:doc:${docId}`, JSON.stringify({
      type: 'operation',
      version: newVersion,
      operation: transformed,
      userId: clientOp.clientId
    }));

    return { transformed, serverVersion: newVersion };
  }

  private transform(op: Operation, against: Operation): Operation {
    if (op.type === 'insert' && against.type === 'insert') {
      return transformII(against, op);
    } else if (op.type === 'delete' && against.type === 'insert') {
      const result = transformDI(op, against);
      return Array.isArray(result) ? result[0] : result; // Simplify for demo
    } else if (op.type === 'insert' && against.type === 'delete') {
      return transformID(op, against);
    } else {
      return transformDD(op, against) || op;
    }
  }
}
```

### Idempotency for Safe Retries

```typescript
// Middleware for HTTP idempotency
interface IdempotencyStore {
  get(key: string): Promise<CachedResponse | null>;
  set(key: string, response: CachedResponse, ttl: number): Promise<void>;
}

class RedisIdempotencyStore implements IdempotencyStore {
  async get(key: string): Promise<CachedResponse | null> {
    const cached = await redis.get(`idempotency:${key}`);
    return cached ? JSON.parse(cached) : null;
  }

  async set(key: string, response: CachedResponse, ttl: number): Promise<void> {
    await redis.setex(`idempotency:${key}`, ttl, JSON.stringify(response));
  }
}

// WebSocket operation idempotency
async function processWebSocketOperation(
  userId: string,
  docId: string,
  operationId: string,
  operation: Operation
): Promise<OperationResult> {
  const cacheKey = `op:${userId}:${docId}:${operationId}`;

  // Check if already processed
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached); // Return cached ACK
  }

  // Process operation
  const result = await otEngine.processOperation(docId, operation, operation.version);

  // Cache result for 1 hour (long enough for retries)
  await redis.setex(cacheKey, 3600, JSON.stringify(result));

  return result;
}
```

---

## Step 5: Deep Dive - Database Schema (7 minutes)

### PostgreSQL Schema

```sql
-- Users with avatar color for presence
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,        -- bcrypt cost=10
    avatar_color VARCHAR(7) DEFAULT '#3B82F6',  -- Hex for cursor color
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Documents with ProseMirror JSON content
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(500) NOT NULL DEFAULT 'Untitled Document',
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    current_version BIGINT DEFAULT 0,           -- OT version counter
    content JSONB NOT NULL,                     -- ProseMirror doc JSON
    is_deleted BOOLEAN DEFAULT FALSE,           -- Soft delete
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Granular permissions for sharing
CREATE TABLE document_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255),                         -- Pending invite
    permission_level VARCHAR(20) NOT NULL
        CHECK (permission_level IN ('view', 'comment', 'edit')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(document_id, user_id),
    UNIQUE(document_id, email)
);

-- Append-only operation log
CREATE TABLE operations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_number BIGINT NOT NULL,
    operation JSONB NOT NULL,                   -- {type, position, text/length}
    user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(document_id, version_number)
);

-- Periodic snapshots for fast recovery
CREATE TABLE document_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_number BIGINT NOT NULL,
    content JSONB NOT NULL,                     -- Full snapshot
    created_by UUID REFERENCES users(id),
    is_named BOOLEAN DEFAULT FALSE,             -- User-created checkpoint
    name VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(document_id, version_number)
);

-- Comments anchored to text ranges
CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    anchor_start INTEGER,                       -- Char offset
    anchor_end INTEGER,
    anchor_version BIGINT,                      -- Version when created
    content TEXT NOT NULL,
    author_id UUID NOT NULL REFERENCES users(id),
    resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_documents_owner ON documents(owner_id) WHERE NOT is_deleted;
CREATE INDEX idx_documents_updated ON documents(updated_at DESC);
CREATE INDEX idx_permissions_user ON document_permissions(user_id);
CREATE INDEX idx_operations_doc_version ON operations(document_id, version_number);
CREATE INDEX idx_versions_doc ON document_versions(document_id, version_number DESC);
CREATE INDEX idx_comments_doc ON comments(document_id);
```

### Redis Data Structures

| Key Pattern | Type | TTL | Purpose |
|-------------|------|-----|---------|
| `session:{token}` | String (JSON) | 24h | User session data |
| `doc:{id}:version` | String (int) | None | Current OT version |
| `doc:{id}:ops` | List | 1h | Recent ops buffer for late joiners |
| `presence:{docId}` | Set | None | User IDs in document |
| `cursor:{docId}:{userId}` | Hash | 30s | Cursor position {line, col} |
| `channel:doc:{id}` | Pub/Sub | N/A | Operation broadcast |
| `channel:presence:{id}` | Pub/Sub | N/A | Presence updates |

---

## Step 6: Deep Dive - Version History and Snapshots (5 minutes)

### Snapshot Strategy

```typescript
class SnapshotService {
  private readonly OPS_THRESHOLD = 50;      // Snapshot every 50 ops
  private readonly TIME_THRESHOLD = 5 * 60 * 1000; // Or every 5 minutes

  private lastSnapshot: Map<string, { version: number; timestamp: number }> = new Map();

  async shouldSnapshot(docId: string, currentVersion: number): Promise<boolean> {
    const last = this.lastSnapshot.get(docId);
    if (!last) return true; // First snapshot

    const opsSinceSnapshot = currentVersion - last.version;
    const timeSinceSnapshot = Date.now() - last.timestamp;

    return opsSinceSnapshot >= this.OPS_THRESHOLD ||
           timeSinceSnapshot >= this.TIME_THRESHOLD;
  }

  async createSnapshot(docId: string, version: number, content: DocumentContent): Promise<void> {
    await pool.query(`
      INSERT INTO document_versions (document_id, version_number, content, created_at)
      VALUES ($1, $2, $3, NOW())
    `, [docId, version, JSON.stringify(content)]);

    // Also update documents.content for fast loading
    await pool.query(`
      UPDATE documents
      SET content = $1, current_version = $2, updated_at = NOW()
      WHERE id = $3
    `, [JSON.stringify(content), version, docId]);

    this.lastSnapshot.set(docId, { version, timestamp: Date.now() });
  }

  async restoreVersion(docId: string, targetVersion: number): Promise<DocumentContent> {
    // Find nearest snapshot at or before target
    const { rows: [snapshot] } = await pool.query(`
      SELECT version_number, content
      FROM document_versions
      WHERE document_id = $1 AND version_number <= $2
      ORDER BY version_number DESC
      LIMIT 1
    `, [docId, targetVersion]);

    if (!snapshot) throw new Error('Version not found');

    // Replay operations from snapshot to target
    const { rows: ops } = await pool.query(`
      SELECT operation
      FROM operations
      WHERE document_id = $1
        AND version_number > $2
        AND version_number <= $3
      ORDER BY version_number ASC
    `, [docId, snapshot.version_number, targetVersion]);

    let content = snapshot.content;
    for (const { operation } of ops) {
      content = applyOperation(content, operation);
    }

    return content;
  }
}
```

### Write Path with Async Persistence

```typescript
async function handleOperation(ws: WebSocket, message: OperationMessage): Promise<void> {
  const { docId, operation, version: clientVersion, operationId } = message;

  // 1. Transform operation (synchronous, in-memory)
  const { transformed, serverVersion } = await otEngine.processOperation(
    docId, operation, clientVersion
  );

  // 2. Send ACK immediately (before persistence)
  ws.send(JSON.stringify({
    type: 'ack',
    docId,
    version: serverVersion
  }));

  // 3. Persist asynchronously (background)
  setImmediate(async () => {
    try {
      // Batch insert for efficiency
      await operationBatcher.add(docId, serverVersion, transformed);

      // Check if snapshot needed
      if (await snapshotService.shouldSnapshot(docId, serverVersion)) {
        const content = await getDocumentContent(docId);
        await snapshotService.createSnapshot(docId, serverVersion, content);
      }
    } catch (error) {
      logger.error({ docId, version: serverVersion, error }, 'Failed to persist operation');
      // Operation already broadcast - will be recovered from other clients
    }
  });
}

// Batch operations for efficient persistence
class OperationBatcher {
  private batches: Map<string, Operation[]> = new Map();
  private flushInterval: NodeJS.Timer;

  constructor() {
    // Flush every 100ms
    this.flushInterval = setInterval(() => this.flush(), 100);
  }

  async add(docId: string, version: number, operation: Operation): Promise<void> {
    const key = docId;
    const batch = this.batches.get(key) || [];
    batch.push({ version, operation });
    this.batches.set(key, batch);

    // Immediate flush if batch is large
    if (batch.length >= 10) {
      await this.flushDocument(docId);
    }
  }

  private async flush(): Promise<void> {
    for (const [docId, batch] of this.batches) {
      if (batch.length > 0) {
        await this.flushDocument(docId);
      }
    }
  }

  private async flushDocument(docId: string): Promise<void> {
    const batch = this.batches.get(docId) || [];
    if (batch.length === 0) return;

    this.batches.set(docId, []);

    // Bulk insert
    const values = batch.map((op, i) =>
      `($1, $${i * 2 + 2}, $${i * 2 + 3})`
    ).join(',');

    const params = [docId, ...batch.flatMap(op => [op.version, JSON.stringify(op.operation)])];

    await pool.query(`
      INSERT INTO operations (document_id, version_number, operation)
      VALUES ${values}
      ON CONFLICT (document_id, version_number) DO NOTHING
    `, params);
  }
}
```

---

## Step 7: Deep Dive - WebSocket Protocol (5 minutes)

### Message Types

```typescript
// Client -> Server
interface JoinMessage {
  type: 'join';
  docId: string;
  version: number; // Client's last known version
}

interface OperationMessage {
  type: 'operation';
  docId: string;
  version: number;
  operationId: string; // For idempotency
  operation: Operation;
}

interface CursorMessage {
  type: 'cursor';
  docId: string;
  position: { line: number; column: number };
  selection?: { start: Position; end: Position };
}

// Server -> Client
interface JoinedMessage {
  type: 'joined';
  docId: string;
  version: number;
  ops: Operation[];     // Missed operations
  users: PresenceUser[]; // Active collaborators
}

interface AckMessage {
  type: 'ack';
  docId: string;
  version: number;
}

interface BroadcastOperationMessage {
  type: 'operation';
  docId: string;
  version: number;
  operation: Operation;
  userId: string;
}
```

### WebSocket Connection Handler

```typescript
class CollaborationServer {
  private connections: Map<string, Set<WebSocket>> = new Map(); // docId -> clients
  private userSockets: Map<WebSocket, { userId: string; docId: string }> = new Map();

  handleConnection(ws: WebSocket, userId: string): void {
    ws.on('message', async (data) => {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'join':
          await this.handleJoin(ws, userId, message);
          break;
        case 'operation':
          await this.handleOperation(ws, userId, message);
          break;
        case 'cursor':
          await this.handleCursor(ws, userId, message);
          break;
        case 'leave':
          await this.handleLeave(ws, userId, message);
          break;
      }
    });

    ws.on('close', () => this.handleDisconnect(ws));
  }

  private async handleJoin(ws: WebSocket, userId: string, msg: JoinMessage): Promise<void> {
    const { docId, version: clientVersion } = msg;

    // Verify permission
    const permission = await this.checkPermission(userId, docId);
    if (!permission) {
      ws.send(JSON.stringify({ type: 'error', code: 'FORBIDDEN', message: 'No access' }));
      return;
    }

    // Add to document room
    if (!this.connections.has(docId)) {
      this.connections.set(docId, new Set());
    }
    this.connections.get(docId)!.add(ws);
    this.userSockets.set(ws, { userId, docId });

    // Get missed operations
    const serverVersion = await redis.get(`doc:${docId}:version`) || '0';
    const missedOps = await this.getOperationsSince(docId, clientVersion, parseInt(serverVersion));

    // Get active users
    await redis.sadd(`presence:${docId}`, userId);
    const userIds = await redis.smembers(`presence:${docId}`);
    const users = await this.getUserPresence(userIds);

    // Send joined message
    ws.send(JSON.stringify({
      type: 'joined',
      docId,
      version: parseInt(serverVersion),
      ops: missedOps,
      users
    }));

    // Broadcast presence update to others
    await this.broadcastPresence(docId, users);

    // Subscribe to Redis pub/sub for cross-server updates
    await this.subscribeToDocument(docId);
  }

  private async handleOperation(ws: WebSocket, userId: string, msg: OperationMessage): Promise<void> {
    const result = await processWebSocketOperation(
      userId,
      msg.docId,
      msg.operationId,
      msg.operation
    );

    // ACK to sender
    ws.send(JSON.stringify({
      type: 'ack',
      docId: msg.docId,
      version: result.serverVersion
    }));

    // Broadcast is handled by Redis pub/sub in processWebSocketOperation
  }
}
```

### Cross-Server Coordination with Redis Pub/Sub

```typescript
class PubSubManager {
  private subscriber: Redis;
  private publisher: Redis;
  private subscriptions: Set<string> = new Set();

  constructor() {
    this.subscriber = new Redis(process.env.REDIS_URL);
    this.publisher = new Redis(process.env.REDIS_URL);
  }

  async subscribeToDocument(docId: string): Promise<void> {
    const channel = `channel:doc:${docId}`;
    if (this.subscriptions.has(channel)) return;

    this.subscriptions.add(channel);
    await this.subscriber.subscribe(channel);
  }

  async broadcast(docId: string, message: BroadcastMessage): Promise<void> {
    await this.publisher.publish(
      `channel:doc:${docId}`,
      JSON.stringify(message)
    );
  }

  handleMessage(channel: string, message: string): void {
    const docId = channel.replace('channel:doc:', '');
    const parsed = JSON.parse(message);

    // Forward to all local connections for this document
    const connections = collaborationServer.getConnections(docId);
    for (const ws of connections) {
      const userInfo = collaborationServer.getUserInfo(ws);
      // Don't echo back to original sender
      if (userInfo?.userId !== parsed.userId) {
        ws.send(message);
      }
    }
  }
}
```

---

## Step 8: Deep Dive - Comment Anchor Transformation (3 minutes)

Comments must stay attached to their text even as the document changes.

```typescript
interface CommentAnchor {
  start: number;
  end: number;
  version: number;
}

function transformAnchor(anchor: CommentAnchor, operation: Operation): CommentAnchor {
  if (operation.type === 'insert') {
    if (operation.position <= anchor.start) {
      // Insert before anchor - shift both positions
      return {
        ...anchor,
        start: anchor.start + operation.text.length,
        end: anchor.end + operation.text.length
      };
    } else if (operation.position < anchor.end) {
      // Insert within anchor - extend end
      return {
        ...anchor,
        end: anchor.end + operation.text.length
      };
    }
    // Insert after anchor - no change
    return anchor;
  }

  if (operation.type === 'delete') {
    const delEnd = operation.position + operation.length;

    if (delEnd <= anchor.start) {
      // Delete before anchor - shift left
      return {
        ...anchor,
        start: anchor.start - operation.length,
        end: anchor.end - operation.length
      };
    } else if (operation.position >= anchor.end) {
      // Delete after anchor - no change
      return anchor;
    } else if (operation.position <= anchor.start && delEnd >= anchor.end) {
      // Delete encompasses anchor - collapse
      return { ...anchor, start: operation.position, end: operation.position };
    } else if (operation.position <= anchor.start) {
      // Delete overlaps start
      const overlap = delEnd - anchor.start;
      return {
        ...anchor,
        start: operation.position,
        end: anchor.end - operation.length
      };
    } else if (delEnd >= anchor.end) {
      // Delete overlaps end
      return {
        ...anchor,
        end: operation.position
      };
    } else {
      // Delete within anchor - shrink
      return {
        ...anchor,
        end: anchor.end - operation.length
      };
    }
  }

  return anchor;
}

// Apply all operations since comment was created
async function getCurrentAnchor(
  docId: string,
  originalAnchor: CommentAnchor
): Promise<CommentAnchor> {
  const ops = await getOperationsSince(docId, originalAnchor.version);

  let anchor = originalAnchor;
  for (const op of ops) {
    anchor = transformAnchor(anchor, op);
  }

  return anchor;
}
```

---

## Step 9: Caching Strategy (3 minutes)

### Multi-Tier Caching

```typescript
class DocumentCache {
  // L1: In-memory for active documents
  private memoryCache: Map<string, { content: DocumentContent; version: number }> = new Map();

  // L2: Redis for cross-server sharing
  private redis: Redis;

  async get(docId: string): Promise<DocumentContent | null> {
    // Check L1
    const local = this.memoryCache.get(docId);
    if (local) return local.content;

    // Check L2
    const cached = await this.redis.get(`doc:${docId}:content`);
    if (cached) {
      const content = JSON.parse(cached);
      this.memoryCache.set(docId, { content, version: content.version });
      return content;
    }

    // Cache miss - load from PostgreSQL
    const { rows: [doc] } = await pool.query(
      'SELECT content, current_version FROM documents WHERE id = $1',
      [docId]
    );

    if (!doc) return null;

    // Populate both caches
    this.memoryCache.set(docId, { content: doc.content, version: doc.current_version });
    await this.redis.setex(`doc:${docId}:content`, 300, JSON.stringify(doc.content));

    return doc.content;
  }

  async invalidate(docId: string): Promise<void> {
    this.memoryCache.delete(docId);
    await this.redis.del(`doc:${docId}:content`);
  }

  // Invalidate on any operation
  async onOperation(docId: string): Promise<void> {
    await this.invalidate(docId);
  }
}
```

### TTL Configuration

| Data | TTL | Invalidation |
|------|-----|--------------|
| Document content | 5 min | On any edit operation |
| User profile | 1 hour | On profile update |
| Permission cache | 10 min | On share/unshare |
| Session | 24 hours | On logout |
| Cursor positions | 30 sec | Auto-expire |

---

## Step 10: Circuit Breakers and Failure Handling (3 minutes)

```typescript
const OT_CIRCUIT_OPTIONS: CircuitBreakerOptions = {
  timeout: 2000,              // 2s - tight for real-time
  errorThresholdPercentage: 50,
  resetTimeout: 5000,         // Quick recovery
  volumeThreshold: 3,
};

const dbCircuit = new CircuitBreaker(OT_CIRCUIT_OPTIONS);
const redisCircuit = new CircuitBreaker(OT_CIRCUIT_OPTIONS);

async function processOperationWithResilience(
  docId: string,
  operation: Operation
): Promise<OperationResult> {
  // Try primary path with circuit breakers
  try {
    const result = await dbCircuit.execute(async () => {
      return await otEngine.processOperation(docId, operation, operation.version);
    });
    return result;
  } catch (error) {
    if (dbCircuit.isOpen()) {
      // Fallback: Process in-memory, queue for persistence
      logger.warn({ docId }, 'DB circuit open, processing in-memory');
      return await inMemoryProcessor.process(docId, operation);
    }
    throw error;
  }
}

// Graceful degradation modes
const DEGRADATION_MODES = {
  NORMAL: 'normal',
  READ_ONLY: 'read_only',      // DB write issues
  LOCAL_ONLY: 'local_only',    // Redis issues, no cross-server sync
  OFFLINE: 'offline'           // Both down
};

function getDegradationMode(): string {
  if (dbCircuit.isOpen() && redisCircuit.isOpen()) return DEGRADATION_MODES.OFFLINE;
  if (dbCircuit.isOpen()) return DEGRADATION_MODES.READ_ONLY;
  if (redisCircuit.isOpen()) return DEGRADATION_MODES.LOCAL_ONLY;
  return DEGRADATION_MODES.NORMAL;
}
```

---

## Step 11: Observability (2 minutes)

### Key Metrics

```typescript
// Prometheus metrics
const otOperationsTotal = new Counter({
  name: 'google_docs_ot_operations_total',
  help: 'Total OT operations processed',
  labelNames: ['type', 'status']
});

const syncLatencyMs = new Histogram({
  name: 'google_docs_sync_latency_ms',
  help: 'Time from operation receive to broadcast',
  labelNames: ['operation_type'],
  buckets: [5, 10, 25, 50, 75, 100, 150, 200, 300, 500, 1000]
});

const activeDocuments = new Gauge({
  name: 'google_docs_active_documents',
  help: 'Documents with active collaborators'
});

const activeCollaborators = new Gauge({
  name: 'google_docs_active_collaborators',
  help: 'Total active WebSocket connections'
});

const circuitBreakerState = new Gauge({
  name: 'google_docs_circuit_breaker_state',
  help: '0=closed, 1=half-open, 2=open',
  labelNames: ['circuit']
});
```

### SLIs and Alerts

| SLI | Target | Alert |
|-----|--------|-------|
| OT sync latency p95 | < 100ms | > 250ms for 5 min |
| Operation success rate | > 99.9% | < 99% for 5 min |
| WebSocket availability | > 99.9% | < 99% for 5 min |
| Document load p95 | < 500ms | > 1s for 5 min |

---

## Step 12: Trade-offs (2 minutes)

| Decision | Alternative | Trade-off |
|----------|-------------|-----------|
| **OT over CRDT** | Yjs, Automerge | More complex transforms, but lower memory (no per-char metadata) |
| **Sticky sessions** | Distributed OT | Simpler coordination, but hot document = hot server |
| **Snapshots + ops** | Event sourcing only | More storage, but fast document loading |
| **PostgreSQL JSONB** | MongoDB | Single database, ACID for permissions/users |
| **Redis pub/sub** | RabbitMQ | Simpler for ephemeral messages, no persistence needed |
| **Batch persistence** | Sync writes | Lower durability window (100ms), but 10x throughput |

---

## Closing Summary

"I've designed a real-time collaborative document editor backend with:

1. **Operational Transformation engine** with insert/delete transforms and deterministic conflict resolution
2. **Hybrid storage** using PostgreSQL for metadata and periodic snapshots, Redis for hot data and pub/sub
3. **WebSocket protocol** with idempotent operations, cross-server coordination, and presence tracking
4. **Multi-tier caching** with in-memory L1 and Redis L2, aggressive invalidation on edits
5. **Resilience patterns** including circuit breakers, graceful degradation, and async persistence

The key insight is that OT provides the mathematical foundation for concurrent editing, while careful versioning with snapshots enables both real-time collaboration and efficient version history access."

---

## Potential Follow-up Questions

1. **How would you handle a document with 1000 concurrent editors?**
   - Partition document into sections, each with own OT stream
   - Regional servers with eventual sync between regions
   - Operational batching to reduce message volume

2. **How would you implement offline editing?**
   - Queue operations locally in IndexedDB
   - On reconnect, transform against server ops since last sync
   - Show conflicts as suggestions if auto-merge fails

3. **How would you scale the operations table?**
   - Partition by document_id and version_number ranges
   - Archive old operations to cold storage
   - Compact operation ranges into single aggregate ops
