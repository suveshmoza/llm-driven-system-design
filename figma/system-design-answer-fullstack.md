# Figma - System Design Answer (Full-Stack Focus)

## 45-minute system design interview format - Full-Stack Engineer Position

## Opening Statement

"Today I'll design Figma, a real-time collaborative design platform, from a full-stack perspective. I'll focus on the integration points between frontend and backend: the WebSocket protocol for real-time sync, shared TypeScript types for type safety across the stack, the API contract for file management, and how frontend state changes flow through to PostgreSQL persistence with CRDT conflict resolution."

---

## Step 1: Requirements Clarification (3-5 minutes)

### Functional Requirements

1. **Real-time Collaborative Editing** - Multiple users editing the same canvas simultaneously
2. **Vector Graphics Canvas** - Create and manipulate rectangles, ellipses, text
3. **Presence System** - See collaborators' cursors and selections
4. **Version History** - Save snapshots, restore previous versions
5. **File Management** - Create, list, update, delete design files

### Non-Functional Requirements

- **Latency**: < 50ms for local operations, < 200ms for sync to collaborators
- **Consistency**: All clients converge to same state via CRDT
- **Reliability**: No data loss even with network interruptions
- **Type Safety**: Shared types prevent API contract drift

### Out of Scope

- Component library
- Prototyping/interactions
- Export functionality
- Plugin system

---

## Step 2: Full-Stack Architecture Overview (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Frontend (React + PixiJS)                       │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌──────────────┐  │
│  │ editorStore   │  │ Canvas.tsx    │  │ useWebSocket  │  │ api.ts       │  │
│  │ (Zustand)     │  │ (PixiJS)      │  │ (Real-time)   │  │ (REST)       │  │
│  └───────┬───────┘  └───────────────┘  └───────┬───────┘  └──────┬───────┘  │
│          │                                     │                  │          │
└──────────┼─────────────────────────────────────┼──────────────────┼──────────┘
           │                                     │                  │
           │  @figma/shared-types                │ WebSocket        │ HTTP
           │  (Shared TypeScript)                │                  │
           │                                     │                  │
┌──────────┼─────────────────────────────────────┼──────────────────┼──────────┐
│          │                                     │                  │          │
│  ┌───────▼───────┐                     ┌───────▼───────┐  ┌──────▼───────┐  │
│  │ Type Imports  │                     │ wsHandler.ts  │  │ routes/      │  │
│  │ (Validation)  │                     │ (WS Server)   │  │ files.ts     │  │
│  └───────────────┘                     └───────┬───────┘  └──────┬───────┘  │
│                                                │                  │          │
│                         ┌──────────────────────┴──────────────────┤          │
│                         │                                         │          │
│                  ┌──────▼──────┐                          ┌───────▼───────┐  │
│                  │ CRDTEngine  │                          │ FileService   │  │
│                  │ (LWW Merge) │                          │               │  │
│                  └──────┬──────┘                          └───────┬───────┘  │
│                         │                                         │          │
│                         └─────────────────────┬───────────────────┘          │
│                                               │                              │
│                                       ┌───────▼───────┐                      │
│                                       │ PostgreSQL    │                      │
│                                       │ (files,       │                      │
│                                       │  operations)  │                      │
│                                       └───────────────┘                      │
│                              Backend (Express + ws)                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 3: Deep Dive - Shared Types Package (8 minutes)

### Package Structure

The shared types package lives in a monorepo structure with `packages/shared-types/src/` containing separate files for canvas types, operations, presence, WebSocket messages, and API contracts.

### Canvas Data Types

Using Zod, we define the core design object schema:

```
┌─────────────────────────────────────────────────────────────────┐
│                       DesignObject Schema                        │
├─────────────────────────────────────────────────────────────────┤
│  id: UUID                                                        │
│  type: 'rectangle' | 'ellipse' | 'text' | 'frame' | 'group'     │
│  name: string (1-255 chars)                                      │
│  ├── Position: x, y (numbers)                                    │
│  ├── Size: width, height (non-negative)                          │
│  ├── Transform: rotation (-360 to 360)                           │
│  ├── Style: fill, stroke (strings), strokeWidth, opacity         │
│  ├── State: visible, locked (booleans)                           │
│  └── Text-specific: text, fontSize, fontFamily (optional)        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       CanvasData Schema                          │
├─────────────────────────────────────────────────────────────────┤
│  objects: DesignObject[]                                         │
│  pages: { id: UUID, name: string }[]                             │
└─────────────────────────────────────────────────────────────────┘
```

The `DesignObjectUpdateSchema` is a partial version (excluding `id` and `type`) for property changes.

### Operation Types

Operations use a discriminated union with four types:

```
┌───────────────────────────────────────────────────────────────────────────┐
│                           Base Operation                                   │
├───────────────────────────────────────────────────────────────────────────┤
│  id: UUID, fileId: UUID, objectId: UUID                                    │
│  timestamp: positive integer, clientId: string                             │
│  idempotencyKey: UUID (optional)                                           │
└───────────────────────────────────────────────────────────────────────────┘
        │
        ├──► CreateOperation: operationType='create', payload=DesignObject
        ├──► UpdateOperation: operationType='update', payload=DesignObjectUpdate
        ├──► DeleteOperation: operationType='delete', payload={}
        └──► MoveOperation: operationType='move', payload={parentId, index}
```

### WebSocket Protocol Types

**Client to Server Messages:**
- `subscribe`: Join a file room with fileId, userId, userName
- `operation`: Send operations array
- `presence`: Update cursor position and selection

**Server to Client Messages:**
- `sync`: Initial file state with canvasData, presence list, assigned color
- `operation`: Broadcast operations with fromUserId
- `presence`: Updated presence list with removed users
- `ack`: Acknowledge processed operationIds
- `error`: Error code and message

Both use `z.discriminatedUnion` on the `type` field for type-safe parsing.

### API Types

```
┌─────────────────────────────────────────────────────────────────┐
│                         File Schema                              │
├─────────────────────────────────────────────────────────────────┤
│  id, name, ownerId, thumbnailUrl, canvasData                     │
│  createdAt, updatedAt (ISO datetime strings)                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      FileVersion Schema                          │
├─────────────────────────────────────────────────────────────────┤
│  id, fileId, versionNumber, name (nullable)                      │
│  createdBy, createdAt, isAutoSave                                │
└─────────────────────────────────────────────────────────────────┘
```

API responses wrap data in `{ success: true, data: T }` or `{ success: false, error: { code, message } }`.

---

## Step 4: Deep Dive - WebSocket Handler Integration (10 minutes)

### Backend WebSocket Handler with Type Safety

The `CollaborationServer` class manages real-time connections:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CollaborationServer                               │
├─────────────────────────────────────────────────────────────────────────┤
│  clients: Map<WebSocket, Client>                                         │
│  fileClients: Map<fileId, Set<WebSocket>>                                │
│  crdtEngine: CRDTEngine                                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  Client = {                                                              │
│    ws, userId, userName, fileId,                                         │
│    color (from 6-color palette), cursor, selection                       │
│  }                                                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

**Connection Flow:**
1. On connection, create Client with empty fileId and assigned color
2. Parse incoming messages with `ClientMessageSchema.safeParse()`
3. If validation fails, send error with code `INVALID_MESSAGE`
4. Route valid messages to appropriate handler

**Subscribe Handler:**
1. Leave previous file room if any
2. Set client's userId, userName, fileId
3. Add client to fileClients set
4. Load file from PostgreSQL
5. Store presence in Redis hash `presence:{fileId}` with 1-hour TTL
6. Send sync message with file data, current presence, and assigned color
7. Broadcast presence update to other clients

**Operation Handler:**
1. Verify client is subscribed to a file
2. For each operation:
   - Check idempotency key in Redis (NX with 5-minute TTL)
   - Skip if already processed
   - Persist operation to PostgreSQL operations table
   - Apply to canvas_data via CRDTEngine
   - Update files table
3. Send ack to sender with processed operation IDs
4. Broadcast operations to other clients in file room
5. Publish to Redis `file:{fileId}:operations` for cross-server sync

**Presence Handler:**
Updates cursor and selection in Redis, broadcasts to other clients.

**Disconnect Handler:**
Removes from Redis presence, notifies others, cleans up client maps.

**Redis Pub/Sub Setup:**
Subscribes to `file:*:operations` pattern. On message from another server, broadcasts to local clients (skipping if excludeServer matches).

---

## Step 5: Deep Dive - REST API with Validation (8 minutes)

### File Routes

**GET /files** - List all non-deleted files ordered by updated_at DESC. Returns array validated against `FileSchema`.

**GET /files/:id** - Get single file by ID. Returns 404 if not found or deleted.

**POST /files** - Create new file:
- Validates body against `CreateFileRequestSchema`
- Returns 400 with validation errors if invalid
- Generates UUID for id and owner
- Initializes with empty canvasData `{ objects: [], pages: [] }`
- Returns 201 with created file

**PATCH /files/:id** - Update file metadata:
- Validates body against `UpdateFileRequestSchema`
- Builds dynamic UPDATE query for provided fields
- Returns 404 if file not found

**DELETE /files/:id** - Soft delete:
- Sets `deleted_at = NOW()`
- Returns 204 on success, 404 if not found

### Version Routes

**GET /files/:fileId/versions** - List all versions for a file ordered by version_number DESC.

**POST /files/:fileId/versions** - Create snapshot:
1. Validates body against `CreateVersionRequestSchema`
2. Gets current file canvas_data
3. Returns 404 if file not found
4. Gets next version number: `MAX(version_number) + 1`
5. Inserts version with is_auto_save=false
6. Returns 201 with created version

**POST /files/:fileId/versions/:versionId/restore** - Restore version:
1. Gets version's canvas_data
2. Returns 404 if version not found
3. Updates file's canvas_data with version data
4. Returns `{ restored: true }`

---

## Step 6: Deep Dive - Frontend API Client (5 minutes)

### Type-Safe API Client

The API client provides type-safe methods with Zod validation on responses:

```
┌─────────────────────────────────────────────────────────────────┐
│                      API Client Structure                        │
├─────────────────────────────────────────────────────────────────┤
│  request<T>(path, options, schema?): Promise<T>                  │
│  ├── Adds Content-Type: application/json                         │
│  ├── Throws ApiError with code, message, status on failure       │
│  └── Validates response with schema if provided                  │
├─────────────────────────────────────────────────────────────────┤
│  filesApi:                                                       │
│  ├── list(): Promise<File[]>                                     │
│  ├── get(id): Promise<File>                                      │
│  ├── create(data): Promise<File>                                 │
│  ├── update(id, data): Promise<File>                             │
│  └── delete(id): Promise<void>                                   │
├─────────────────────────────────────────────────────────────────┤
│  versionsApi:                                                    │
│  ├── list(fileId): Promise<FileVersion[]>                        │
│  ├── create(fileId, data?): Promise<FileVersion>                 │
│  └── restore(fileId, versionId): Promise<{restored: boolean}>    │
└─────────────────────────────────────────────────────────────────┘
```

### Using the API in Components

The FileBrowser component demonstrates the pattern:
- Uses useState for files, loading, error
- Calls filesApi.list() on mount
- handleCreate prompts for name, creates file, navigates to editor
- handleDelete confirms, removes from local state optimistically
- Grid display with thumbnails and delete buttons

---

## Step 7: CRDT Engine Implementation (5 minutes)

### Last-Writer-Wins CRDT Engine

```
┌─────────────────────────────────────────────────────────────────┐
│                        CRDTEngine                                │
├─────────────────────────────────────────────────────────────────┤
│  applyOperation(canvasData, operation) → CanvasData              │
│  ├── 'create': Push payload to objects array                     │
│  ├── 'update': Find by objectId, Object.assign payload           │
│  ├── 'delete': Filter out objectId from objects                  │
│  └── 'move': Splice object to new index                          │
├─────────────────────────────────────────────────────────────────┤
│  mergeStates(local, remote, operations) → CanvasData             │
│  └── Sort operations by timestamp, apply sequentially            │
├─────────────────────────────────────────────────────────────────┤
│  resolveConflict(localVal, remoteVal, localTs, remoteTs,         │
│                  localClientId, remoteClientId) → value          │
│  ├── Higher timestamp wins                                       │
│  └── Tie-breaker: lexicographically higher clientId wins         │
└─────────────────────────────────────────────────────────────────┘
```

The engine deep-clones canvas data before mutations to avoid side effects. LWW provides simplicity at the cost of potentially losing concurrent edits when timestamps collide.

---

## Step 8: Trade-offs and Decisions (2 minutes)

### Key Trade-offs

| Decision | Trade-off |
|----------|-----------|
| Shared types package | Build complexity vs. type safety across stack |
| Zod validation on both ends | Runtime overhead vs. contract enforcement |
| WebSocket for all real-time | More complex than polling, but lower latency |
| LWW CRDT | Simple but can lose concurrent edits |
| JSONB for canvas data | Flexible but no referential integrity |

### Alternatives Considered

1. **GraphQL instead of REST + WebSocket**
   - Single protocol, subscriptions built-in
   - More complex setup, overkill for this use case

2. **tRPC for type sharing**
   - Automatic type inference
   - Less flexible for non-TypeScript clients

3. **Yjs/Automerge for CRDT**
   - More robust conflict resolution
   - Larger dependency, more complex

---

## Closing Summary

"I've designed the full-stack architecture for a Figma-like design tool with:

1. **Shared Types Package** - Zod schemas used for validation on frontend, backend, and WebSocket messages
2. **WebSocket Handler** - Type-safe message handling with Redis pub/sub for multi-server support
3. **REST API** - CRUD operations with request/response validation
4. **Type-Safe API Client** - Frontend client with runtime type checking
5. **CRDT Engine** - Last-Writer-Wins conflict resolution for concurrent edits

The key insight is using a shared types package with Zod to ensure type safety at runtime across the entire stack, preventing API contract drift. Happy to dive deeper into any integration point."

---

## Future Enhancements

1. **tRPC Migration** - Replace REST with tRPC for automatic type inference
2. **WebSocket Reconnection Queue** - Queue operations during disconnect
3. **Optimistic UI** - Apply operations locally before server confirmation
4. **Conflict Visualization** - Show users when their changes conflict
5. **E2E Type Testing** - Automated tests verifying API contracts
