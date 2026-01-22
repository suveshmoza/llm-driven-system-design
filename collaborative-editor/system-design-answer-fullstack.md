# Collaborative Editor - System Design Answer (Fullstack Focus)

## 45-minute system design interview format - Fullstack Engineer Position

## Opening Statement (1 minute)

"I'll design a real-time collaborative document editor like Google Docs, where multiple users can simultaneously edit the same document and see each other's changes instantly. As a fullstack engineer, I'll focus on the end-to-end implementation: shared type definitions, the WebSocket sync protocol connecting frontend and backend, and the Operational Transformation algorithm that runs on both sides. The key challenges are ensuring type safety across the stack, maintaining consistent document state with concurrent edits, and providing instant feedback while handling network unreliability."

## Requirements Clarification (3 minutes)

### Functional Requirements
- **Edit**: Multiple users edit document simultaneously
- **Sync**: Real-time updates visible to all editors with < 50ms local latency
- **History**: Version history with restore capability
- **Presence**: See who's editing and their cursor positions
- **Share**: Control document access and permissions

### Non-Functional Requirements
- **Latency**: < 50ms for local changes to appear
- **Consistency**: All clients converge to same state
- **Scale**: Support 50+ simultaneous editors per document
- **Durability**: Never lose user edits

### Integration Points (Fullstack Focus)
- WebSocket protocol with typed messages
- Shared OT types running on both client and server
- API contracts with runtime validation
- Optimistic updates with server reconciliation

## High-Level Architecture (5 minutes)

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Shared Types Layer                            │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────────┐ │
│  │  types/          │  │  validation/     │  │  ot/                │ │
│  │  operations.ts   │  │  schemas.ts      │  │  transform.ts       │ │
│  │  messages.ts     │  │  (Zod schemas)   │  │  compose.ts         │ │
│  │  document.ts     │  │                  │  │  apply.ts           │ │
│  └──────────────────┘  └──────────────────┘  └─────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
            │                      │                      │
            v                      v                      v
┌───────────────────────────────┐       ┌───────────────────────────────┐
│          Frontend             │       │           Backend             │
│  ┌───────────────────────┐    │       │    ┌───────────────────────┐  │
│  │  CollaborativeEditor  │    │  WS   │    │  SyncServer           │  │
│  │  - ContentEditable    │<──────────>│    │  - DocumentState      │  │
│  │  - useSyncEngine      │    │       │    │  - OTTransformer      │  │
│  └───────────────────────┘    │       │    └───────────────────────┘  │
│                               │       │              │                │
│  ┌───────────────────────┐    │       │    ┌───────────────────────┐  │
│  │  editorStore          │    │       │    │  PostgreSQL           │  │
│  │  (Zustand + OT)       │    │       │    │  + Redis              │  │
│  └───────────────────────┘    │       │    └───────────────────────┘  │
└───────────────────────────────┘       └───────────────────────────────┘
```

## Deep Dive: Shared Type Definitions (6 minutes)

### Operation Types

Operations represent atomic text changes:

| Type | Fields | Purpose |
|------|--------|---------|
| `retain` | `n: number` | Skip n characters unchanged |
| `insert` | `str: string, attributes?: Record` | Insert text at position |
| `delete` | `n: number` | Delete n characters |

A `TextOperation` contains:
- `ops: Op[]` - Array of operations
- `baseLength: number` - Document length before applying
- `targetLength: number` - Document length after applying

### WebSocket Message Protocol

**Client -> Server Messages:**

| Type | Fields | Purpose |
|------|--------|---------|
| `operation` | version, operationId, operation | Submit an edit |
| `cursor` | position | Update cursor position |
| `selection` | start, end | Update text selection |
| `ping` | - | Heartbeat |

**Server -> Client Messages:**

| Type | Fields | Purpose |
|------|--------|---------|
| `init` | clientId, version, content, clients | Initial document state |
| `ack` | operationId, version | Operation accepted |
| `operation` | clientId, version, operation | Remote user's edit |
| `cursor` | clientId, position | Remote cursor update |
| `client_join/leave` | clientId, userId, color | Presence updates |
| `resync` | version, content | Full resync on error |
| `error` | code, message | Error notification |

### Document Types

| Type | Fields | Purpose |
|------|--------|---------|
| `Document` | id, title, ownerId, timestamps | Core document metadata |
| `DocumentAccess` | documentId, userId, permission | Sharing permissions |
| `DocumentVersion` | version, content, createdAt, author | Version history entry |

## Deep Dive: Zod Validation Schemas (5 minutes)

All messages are validated at runtime using Zod schemas on both client and server:

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Client Input   │────>│  Zod Validation  │────>│  Type-Safe Data │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               v (if invalid)
                        ┌──────────────────┐
                        │  Error Response  │
                        │  code + message  │
                        └──────────────────┘
```

**Key Validation Schemas:**
- `textOperationSchema` - Validates ops array, baseLength, targetLength
- `clientMessageSchema` - Discriminated union by message type
- `createDocumentSchema` - Title (1-500 chars), optional content
- `shareDocumentSchema` - userId (UUID), permission enum

> "Using Zod gives us TypeScript type inference from the same schema used for runtime validation - single source of truth."

## Deep Dive: Shared OT Implementation (7 minutes)

### TextOperation Class

The `TextOperation` class runs identically on client and server:

```
┌─────────────────────────────────────────────────────────┐
│  TextOperation                                          │
├─────────────────────────────────────────────────────────┤
│  ops: Op[]        - Array of retain/insert/delete       │
│  baseLength       - Input document length               │
│  targetLength     - Output document length              │
├─────────────────────────────────────────────────────────┤
│  retain(n)        - Add retain operation                │
│  insert(str)      - Add insert operation                │
│  delete(n)        - Add delete operation                │
│  apply(doc)       - Apply to document string            │
│  toJSON()         - Serialize for transmission          │
│  fromJSON(json)   - Deserialize from transmission       │
└─────────────────────────────────────────────────────────┘
```

### OT Transform Function

The transform function ensures convergence when two users edit simultaneously:

```
        Document State A
             /    \
         op1/      \op2
           /        \
     State B         State C
           \        /
       op2' \      / op1'
             \    /
        Converged State D

transform(op1, op2) => [op1', op2']
apply(apply(doc, op1), op2') === apply(apply(doc, op2), op1')
```

**Transform Rules:**
1. Inserts from op1 go first (consistent ordering)
2. Inserts from op2 go next
3. Matching retains consume each other
4. Matching deletes cancel out
5. Delete vs retain: deleter wins

### OT Compose Function

Compose combines sequential operations into one:

```
compose(op1, op2) => combined

Such that: apply(apply(doc, op1), op2) === apply(doc, combined)
```

This reduces network traffic by combining pending edits.

## Deep Dive: API Client Layer (5 minutes)

### Type-Safe API Client

```
┌────────────────────────────────────────────────────────────────┐
│  api.documents                                                  │
├────────────────────────────────────────────────────────────────┤
│  list()                    -> Document[]                        │
│  get(id)                   -> Document                          │
│  create(data)              -> Document                          │
│  update(id, data)          -> Document                          │
│  delete(id)                -> void                              │
│  share(id, data)           -> void                              │
│  getVersions(id, limit)    -> DocumentVersion[]                 │
│  getVersion(id, version)   -> DocumentVersion                   │
│  restoreVersion(id, ver)   -> { newVersion: number }            │
└────────────────────────────────────────────────────────────────┘
```

**Error Handling:**
- `ApiError` class with status, code, and message
- Credentials included for session auth
- JSON content type by default

## Deep Dive: End-to-End Sync Flow (6 minutes)

### Client Sync Engine

```
┌─────────────────────────────────────────────────────────────────┐
│  Client State Machine                                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────┐   send op   ┌─────────────────┐              │
│   │ SYNCHRONIZED │────────────>│ AWAITING ACK    │              │
│   └──────────────┘             └─────────────────┘              │
│          ^                            │                          │
│          │ ack                        │ local edit               │
│          │                            v                          │
│   ┌──────┴───────┐             ┌─────────────────┐              │
│   │  flush       │<────────────│ AWAITING + BUFFER│             │
│   │  pending     │   ack       └─────────────────┘              │
│   └──────────────┘                                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**State Fields:**
- `content` - Current local document
- `version` - Last acknowledged server version
- `inflightOp` - Operation sent, awaiting ack
- `pendingOps` - Operations applied locally, not yet sent

**Receiving Remote Operations:**
1. Transform against inflight operation
2. Transform against all pending operations
3. Apply transformed operation to local content
4. Update remote user's cursor position

### Server WebSocket Handler

```
┌─────────────────────────────────────────────────────────────────┐
│  Server Processing Flow                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  WebSocket ───> Validate ───> DocumentState.applyOperation       │
│     │             (Zod)              │                           │
│     │                                v                           │
│     │                    ┌───────────────────┐                   │
│     │                    │ Transform against │                   │
│     │                    │ concurrent ops    │                   │
│     │                    └───────────────────┘                   │
│     │                                │                           │
│     v                                v                           │
│  Send ACK <────────────── Assign version, persist                │
│     │                                │                           │
│     │                                v                           │
│     │                    Broadcast to other clients              │
│     │                                │                           │
│     v                                v                           │
│  Publish to RabbitMQ (cross-server sync)                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Connection Lifecycle:**
1. Authenticate via session cookie
2. Load/create DocumentState for document ID
3. Send `init` message with current state
4. Broadcast `client_join` to others
5. Process messages in loop
6. On disconnect: broadcast `client_leave`, cleanup

## Deep Dive: Database Schema (4 minutes)

```
┌─────────────────────┐     ┌─────────────────────┐
│  users              │     │  documents          │
├─────────────────────┤     ├─────────────────────┤
│  id (PK)            │<────│  owner_id (FK)      │
│  email (UNIQUE)     │     │  id (PK)            │
│  display_name       │     │  title              │
│  password_hash      │     │  created_at         │
│  created_at         │     │  updated_at         │
│  updated_at         │     └─────────────────────┘
└─────────────────────┘              │
         │                           │
         v                           v
┌─────────────────────┐     ┌─────────────────────┐
│  sessions           │     │  document_snapshots │
├─────────────────────┤     ├─────────────────────┤
│  id (PK)            │     │  document_id (FK)   │
│  user_id (FK)       │     │  version (PK)       │
│  data (JSONB)       │     │  content (TEXT)     │
│  expires_at         │     │  created_at         │
│  created_at         │     └─────────────────────┘
└─────────────────────┘              │
                                     v
┌─────────────────────┐     ┌─────────────────────┐
│  document_access    │     │  operations         │
├─────────────────────┤     ├─────────────────────┤
│  document_id (FK)   │     │  id (PK)            │
│  user_id (FK)       │     │  document_id (FK)   │
│  permission         │     │  version (UNIQUE)   │
│  created_at         │     │  client_id          │
│  (composite PK)     │     │  user_id (FK)       │
└─────────────────────┘     │  operation_id (UNIQUE)│
                            │  operation (JSONB)  │
                            │  created_at         │
                            └─────────────────────┘
```

**Key Indexes:**
- `operations(document_id, version)` - Fast version lookup
- `operations(document_id, operation_id)` - Idempotency check
- `sessions(user_id)` - Session lookup by user
- `sessions(expires_at)` - Cleanup expired sessions

## Trade-offs and Alternatives (3 minutes)

### 1. Shared Code vs. Separate Implementations

| Aspect | Shared TypeScript Package | Generate from OpenAPI |
|--------|--------------------------|----------------------|
| Type safety | Compile-time guarantees | Generated types |
| OT algorithm | Single implementation | Must duplicate |
| Tooling | Monorepo (Turborepo, Nx) | OpenAPI generator |
| **Chose** | **Shared package** | - |

> "Single source of truth for types and OT logic. Compile-time guarantees across the stack."

### 2. Zod vs. io-ts vs. TypeBox

| Aspect | Zod | TypeBox |
|--------|-----|---------|
| TypeScript inference | Excellent | Excellent |
| Composability | Easy | Easy |
| Error messages | Good | Basic |
| Performance | Slower | Faster |
| **Chose** | **Zod** | - |

### 3. WebSocket vs. Server-Sent Events + HTTP POST

| Aspect | WebSocket | SSE + POST |
|--------|-----------|------------|
| Bidirectional | Native | Requires two connections |
| Latency | Lower | Higher |
| Complexity | Higher | Lower |
| **Chose** | **WebSocket** | - |

### 4. Monorepo with Shared Package vs. API-First

| Aspect | Monorepo Shared | API-First |
|--------|-----------------|-----------|
| OT convergence | Guaranteed identical | Risk of divergence |
| Testing | Easier | Separate test suites |
| Build complexity | Higher | Lower |
| **Chose** | **Monorepo** | - |

## Closing Summary (1 minute)

"The collaborative editor is built around three key fullstack integration points:

1. **Shared Type Definitions** - TypeScript types and Zod schemas ensure the WebSocket protocol is type-safe. The same operation types flow from user keystrokes to database storage.

2. **Shared OT Implementation** - The transform and compose functions run identically on client and server. This eliminates bugs from divergent implementations and makes testing straightforward.

3. **End-to-End Sync Protocol** - The client state machine (synchronized, awaiting ack, awaiting with buffer) combined with server-side transformation ensures all clients converge. Idempotency keys and operation IDs enable safe retries.

The main trade-off is choosing a monorepo with shared packages over an API-first approach. The shared code eliminates type drift and ensures the OT algorithm behaves identically on both sides, which is critical for convergence."
