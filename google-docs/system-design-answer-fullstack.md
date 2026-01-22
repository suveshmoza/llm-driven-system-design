# Google Docs - System Design Interview Answer (Full-Stack Focus)

> **Role Focus**: Full-Stack Engineer - End-to-End Integration, Shared Types, API Design, Real-Time Sync, State Synchronization

## Opening Statement

"Today I'll design Google Docs, a real-time collaborative document editing platform. As a full-stack engineer, I'll focus on the end-to-end architecture connecting the rich text editor to the OT backend, shared type definitions for type-safe collaboration, WebSocket protocol design, and optimistic updates that provide instant feedback while ensuring eventual consistency."

---

## Step 1: Requirements Clarification (3-5 minutes)

### Functional Requirements

1. **Document creation and editing** - Rich text with formatting
2. **Real-time collaboration** - Multiple users editing simultaneously
3. **Cursor and selection sharing** - See where others are typing
4. **Version history** - View and restore previous versions
5. **Comments and suggestions** - Threaded comments, track changes
6. **Sharing and permissions** - View, comment, edit access levels

### Non-Functional Requirements

- **Latency**: < 50ms local response, < 100ms sync to collaborators
- **Consistency**: Strong consistency via OT, eventual consistency for presence
- **Offline**: Continue editing without network, sync on reconnect
- **Type Safety**: Shared schemas between frontend and backend

### Full-Stack Challenges I'll Focus On

1. **Shared Type Definitions**: Zod schemas for operations, documents, and messages
2. **API Design**: REST for CRUD, WebSocket for real-time sync
3. **Optimistic Updates**: Immediate UI feedback with server reconciliation
4. **State Synchronization**: TanStack Query for server state, Zustand for UI state
5. **Error Handling**: Graceful degradation across the stack

---

## Step 2: System Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                  Frontend                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                  │
│  │   TipTap Editor │  │  Zustand Store  │  │ TanStack Query  │                  │
│  │  (ProseMirror)  │  │   (UI State)    │  │ (Server State)  │                  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘                  │
│           │                    │                    │                            │
│           └────────────────────┼────────────────────┘                            │
│                                │                                                 │
│                    ┌───────────▼───────────┐                                     │
│                    │   WebSocket Client    │ ◄──── Shared Types (Zod)           │
│                    │   + API Client        │                                     │
│                    └───────────┬───────────┘                                     │
└────────────────────────────────┼────────────────────────────────────────────────┘
                                 │
                    WebSocket + REST (JSON)
                                 │
┌────────────────────────────────┼────────────────────────────────────────────────┐
│                                │          Backend                                │
├────────────────────────────────┼────────────────────────────────────────────────┤
│                    ┌───────────▼───────────┐                                     │
│                    │   Express + WS        │ ◄──── Shared Types (Zod)           │
│                    │   Route Handlers      │                                     │
│                    └───────────┬───────────┘                                     │
│                                │                                                 │
│           ┌────────────────────┼────────────────────┐                            │
│           │                    │                    │                            │
│  ┌────────▼────────┐  ┌────────▼────────┐  ┌───────▼───────┐                    │
│  │    OT Engine    │  │   Services      │  │   Middleware  │                    │
│  │  (transforms)   │  │  (docs, users)  │  │  (auth, rbac) │                    │
│  └────────┬────────┘  └────────┬────────┘  └───────────────┘                    │
│           │                    │                                                 │
│           └────────────────────┼────────────────────┘                            │
│                                │                                                 │
│           ┌────────────────────┼────────────────────┐                            │
│           │                    │                    │                            │
│  ┌────────▼────────┐  ┌────────▼────────┐  ┌───────▼───────┐                    │
│  │   PostgreSQL    │  │      Redis      │  │   Pub/Sub     │                    │
│  │  (documents)    │  │   (sessions)    │  │  (broadcast)  │                    │
│  └─────────────────┘  └─────────────────┘  └───────────────┘                    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 3: Deep Dive - Shared Type Definitions (10 minutes)

### Operation Types with Zod

Operations use a discriminated union with three types:

```
┌───────────────────────────────────────────────────────────────────────────┐
│                           Base Operation                                   │
├───────────────────────────────────────────────────────────────────────────┤
│  id: UUID, documentId: UUID, userId: UUID                                  │
│  version: non-negative integer, timestamp: number                          │
└───────────────────────────────────────────────────────────────────────────┘
        │
        ├──► InsertOperation: type='insert'
        │    position: non-negative int, text: string (min 1)
        │    attributes: Record<string, unknown> (optional, for formatting)
        │
        ├──► DeleteOperation: type='delete'
        │    position: non-negative int, length: positive int
        │
        └──► FormatOperation: type='format'
             position: non-negative int, length: positive int
             attributes: Record<string, unknown>
```

### Document and User Schemas

**ProseMirrorNodeSchema** uses `z.lazy()` for recursive structure:
- type: string
- content: array of nodes (optional)
- text: string (optional)
- marks: array of `{ type, attrs }` (optional)
- attrs: Record (optional)

**DocumentContentSchema**: `{ type: 'doc', content: ProseMirrorNode[] }`

```
┌─────────────────────────────────────────────────────────────────┐
│                       Document Schema                            │
├─────────────────────────────────────────────────────────────────┤
│  id: UUID                                                        │
│  title: string (max 500)                                         │
│  ownerId: UUID                                                   │
│  currentVersion: non-negative int                                │
│  content: DocumentContent                                        │
│  createdAt, updatedAt: ISO datetime strings                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   DocumentListItem Schema                        │
├─────────────────────────────────────────────────────────────────┤
│  id, title, ownerId, updatedAt (picked from Document)            │
│  ownerName: string                                               │
│  permission: 'owner' | 'edit' | 'comment' | 'view'               │
└─────────────────────────────────────────────────────────────────┘
```

### WebSocket Message Schemas

**Client to Server Messages** (discriminated on `type`):
- `join`: documentId, version (to catch up from)
- `leave`: documentId
- `operation`: documentId, operationId (for idempotency), version, operation
- `cursor`: documentId, position `{ from, to }`

**Server to Client Messages**:
- `joined`: documentId, version, operations (missed), users (with color, cursor)
- `ack`: documentId, operationId, version
- `operation`: documentId, version, operation, userId
- `presence`: documentId, userId, action ('join'|'leave'|'cursor'), user
- `error`: code, message, documentId (optional)

---

## Step 4: Deep Dive - Validation Middleware (5 minutes)

### Express Validation Middleware

Three validation functions for different parts of the request:

**validateBody(schema)**: Parses `req.body` with schema. On ZodError, returns 400 with error details as `{ path, message }` array.

**validateQuery(schema)**: Parses `req.query`. Returns 400 on validation failure.

**validateParams(schema)**: Parses `req.params`. Returns 400 on validation failure.

All middleware call `next()` on success, passing parsed values through.

### WebSocket Message Validation

The message handler:
1. Parses raw JSON from buffer
2. Validates with `ClientMessageSchema.parse()`
3. Routes to appropriate handler based on `message.type`
4. On ZodError: sends `INVALID_MESSAGE` error
5. On SyntaxError: sends `PARSE_ERROR` error
6. On other errors: logs and sends `INTERNAL_ERROR`

Error messages use the ServerMessage error format: `{ type: 'error', code, message }`.

---

## Step 5: Deep Dive - API Routes (7 minutes)

### Document Routes

**GET /** - List documents (owned + shared):
- Query params validated: page (default 1), limit (default 20, max 100), sort ('updated'|'title'|'created')
- Returns documents with pagination: `{ documents, pagination: { page, limit, total, totalPages } }`
- Response validated against `DocumentListItemSchema` array

**GET /:id** - Get single document:
- Params validated: id as UUID
- Requires 'view' permission via middleware
- Returns 404 if not found, otherwise `{ document }`

**POST /** - Create document:
- Body validated: title (optional, defaults to 'Untitled Document'), content (optional)
- Initializes content as `{ type: 'doc', content: [{ type: 'paragraph' }] }` if not provided
- Returns 201 with created document

**PATCH /:id** - Update metadata:
- Requires 'edit' permission
- Body validated: title (optional)
- Returns updated document

**DELETE /:id** - Delete document:
- Requires 'delete' permission
- Returns 204 on success

### Permission Routes

**POST /:id/share** - Share document:
- Body validated: email, permission ('view'|'comment'|'edit')
- Requires 'share' permission
- Returns `{ shared: true, user: {...} | null, pendingInvite: boolean }`

**GET /:id/permissions** - List permissions:
- Requires 'view' permission
- Returns `{ permissions: [{ id, userId, email, permission, userName, createdAt }] }`

---

## Step 6: Deep Dive - TanStack Query Hooks (8 minutes)

### Document Queries and Mutations

**Query Keys Factory:**
```
┌─────────────────────────────────────────────────────────────────┐
│  documentKeys = {                                                │
│    all: ['documents']                                            │
│    lists: () → [...all, 'list']                                  │
│    list: (filters) → [...lists(), filters]                       │
│    details: () → [...all, 'detail']                              │
│    detail: (id) → [...details(), id]                             │
│    versions: (id) → [...detail(id), 'versions']                  │
│    comments: (id) → [...detail(id), 'comments']                  │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

**useDocuments(filters)**: Lists documents with 30-second staleTime.

**useDocument(id)**: Gets single document, enabled when id is truthy.

**useCreateDocument()**: Creates with optimistic update:
1. Cancel outgoing refetches on lists
2. Snapshot previous docs
3. Add optimistic doc with temp ID to list
4. On error: rollback to snapshot
5. On settled: invalidate lists to refetch

**useUpdateDocument()**: Updates with optimistic update:
1. Cancel queries for detail
2. Snapshot previous doc
3. Merge new data optimistically
4. On error: rollback
5. On settled: invalidate detail and lists

**useDeleteDocument()**: Deletes with optimistic removal:
1. Cancel queries on lists
2. Snapshot previous docs
3. Filter out deleted doc
4. On error: rollback
5. On settled: invalidate lists

### Share Document Hook

**useShareDocument(documentId)**: Mutation that invalidates permissions list on success.

**useDocumentPermissions(documentId)**: Query for permissions, enabled when documentId is truthy.

---

## Step 7: Deep Dive - WebSocket Sync Hook (8 minutes)

### WebSocket Client with Type Safety

**useCollaborationSync** hook manages:
- Connection state: 'connecting' | 'connected' | 'disconnected'
- Local version tracking
- Pending operations map (for deduplication)

**Connection Flow:**
1. Create WebSocket to `${VITE_WS_URL}/ws`
2. On open: set status to 'connected', send join message with documentId and version
3. On close: set status to 'disconnected'
4. On message: parse as ServerMessage, route to handler
5. On unmount: send leave message, close connection

**Server Message Handling:**
- `joined`: Apply missed operations, update version, set presence
- `ack`: Remove from pending, update version
- `operation`: Apply if not in pending (from self), update version, invalidate cache
- `presence`: Invalidate presence query on join/leave
- `error`: Log to console

**Sending Operations:**
1. Check WebSocket is open (queue for offline if not)
2. Generate operationId
3. Add to pending map
4. Send operation message with documentId, operationId, version

**Sending Cursor:**
Sends cursor message with documentId and position `{ from, to }` when WebSocket is open.

### Editor Integration with Sync

The `CollaborativeEditor` component:
1. Uses `useDocument()` to load initial document
2. Creates TipTap editor instance
3. Connects `useCollaborationSync` with document version
4. Handles remote operations by applying to editor via `tr.insertText()` or `tr.delete()`
5. Listens to editor transactions, converts to operations, sends via `sendOperation()`
6. Listens to selection updates, sends cursor position via `sendCursor()`
7. Displays connection status indicator

---

## Step 8: Deep Dive - Comments Integration (5 minutes)

### Comments Schema

```
┌─────────────────────────────────────────────────────────────────┐
│                       Comment Schema                             │
├─────────────────────────────────────────────────────────────────┤
│  id, documentId, parentId (nullable for top-level)               │
│  anchorStart, anchorEnd, anchorVersion (text range + version)    │
│  content: string (1-10000 chars)                                 │
│  authorId, authorName, authorColor                               │
│  resolved: boolean                                               │
│  createdAt: ISO datetime                                         │
│  replies: Comment[] (recursive)                                  │
└─────────────────────────────────────────────────────────────────┘
```

### useComments Hook

**commentsQuery**: Fetches comments for documentId using `documentKeys.comments()`.

**addCommentMutation**:
1. Optimistically adds comment with temp ID and current user info
2. On error: rollback to previous
3. On settled: invalidate comments

**resolveCommentMutation**:
1. Optimistically sets `resolved: true` on matching comment
2. On error: rollback

Returns `{ comments, isLoading, addComment, resolveComment }`.

---

## Step 9: Version History Integration (4 minutes)

### Version Schema

```
┌─────────────────────────────────────────────────────────────────┐
│                       Version Schema                             │
├─────────────────────────────────────────────────────────────────┤
│  id, documentId, versionNumber                                   │
│  createdBy, createdByName                                        │
│  isNamed: boolean, name (nullable)                               │
│  createdAt: ISO datetime                                         │
└─────────────────────────────────────────────────────────────────┘
```

### Version Hooks

**useVersions(documentId)**: Lists versions with 1-minute staleTime.

**useVersionContent(documentId, versionId)**: Gets version content, enabled when versionId is truthy.

**useRestoreVersion()**: Mutation that:
1. Calls `api.versions.restore(documentId, versionId)`
2. On success: invalidates detail and versions queries

---

## Step 10: Error Handling Across the Stack (3 minutes)

### API Error Types

```
┌─────────────────────────────────────────────────────────────────┐
│                      ApiError Schema                             │
├─────────────────────────────────────────────────────────────────┤
│  error: string                                                   │
│  code: string (optional)                                         │
│  details: { path, message }[] (optional)                         │
└─────────────────────────────────────────────────────────────────┘
```

**ApiClientError** class extends Error with:
- status: HTTP status code
- code: error code string
- details: validation error details

**apiRequest** function:
1. Adds Content-Type and credentials headers
2. On non-OK response: parse error, throw ApiClientError
3. Validates error shape with ApiErrorSchema.safeParse()

### Global Error Boundary

Uses `QueryErrorResetBoundary` from TanStack Query with `react-error-boundary`:
- Shows error message (formatted for ApiClientError)
- Provides "Try again" button that calls `resetErrorBoundary()`
- Resets query error state via TanStack's reset function

---

## Step 11: Trade-offs (2 minutes)

| Decision | Alternative | Trade-off |
|----------|-------------|-----------|
| **Zod shared schemas** | TypeScript interfaces only | Runtime validation + type inference, larger bundle |
| **TanStack Query** | SWR, Redux | More features (optimistic updates), steeper learning curve |
| **WebSocket + REST** | WebSocket only | REST better for CRUD, WS for real-time |
| **Optimistic updates** | Wait for server | Better UX, more complex rollback logic |
| **Separate presence** | Combine with ops | Presence can be lossy, ops must be reliable |
| **Query key factory** | String keys | Type-safe, refactor-friendly, more boilerplate |

---

## Closing Summary

"I've designed a collaborative document editor with full-stack integration:

1. **Shared Zod schemas** for type-safe operations, documents, and messages across frontend and backend
2. **Validation middleware** that parses and validates all API requests and WebSocket messages
3. **TanStack Query hooks** with optimistic updates for instant feedback and automatic cache invalidation
4. **WebSocket sync hook** that handles operations, acknowledgments, and presence with proper error handling
5. **End-to-end error handling** with typed errors, global boundaries, and graceful degradation

The key insight is that shared type definitions eliminate an entire class of bugs (schema drift), while optimistic updates with proper rollback logic provide a responsive UX without sacrificing consistency. The separation of REST (for CRUD) and WebSocket (for real-time) allows each protocol to excel at what it does best."

---

## Potential Follow-up Questions

1. **How would you handle schema versioning?**
   - Version schemas in URL path (/v1/, /v2/)
   - Use discriminated unions for backward compatibility
   - Transform old formats at API boundary

2. **How would you test the WebSocket integration?**
   - Mock WebSocket with fake-socket library
   - Integration tests with real server
   - E2E tests with Playwright

3. **How would you handle very high latency connections?**
   - Increase pending operation buffer
   - Show sync status indicator
   - Batch operations more aggressively
