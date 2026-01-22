# Design Notion (Full-Stack Focus)

## 45-Minute Full-Stack Interview Answer

### 1. Requirements Clarification (3 minutes)

**Interviewer:** Design a block-based collaboration tool like Notion.

**Candidate:** I'll focus on the full-stack integration. Let me clarify:

**Core Requirements:**
- Block-based document editor with real-time collaboration
- Hierarchical page organization in workspaces
- Database views with filtering, sorting, and grouping
- Offline-first editing with sync

**Technical Focus Areas:**
- WebSocket sync protocol between frontend and backend
- Optimistic updates with conflict resolution
- Shared type definitions across the stack
- End-to-end data flow for collaborative editing

---

### 2. Shared Type Definitions (5 minutes)

"I'm using a shared types package imported by both frontend and backend. This ensures compile-time type safety and catches API contract violations before runtime."

#### Block Types

BlockType enumeration includes: text, heading1-3, bulleted_list, numbered_list, toggle, quote, code, callout, divider, image, table, database.

RichText contains text string, annotations object (bold, italic, underline, strikethrough, code, color), and optional href for links.

Block structure: id, type (BlockType), parentId (nullable), pageId, position (fractional index string), properties (Record), content (RichText array), optional children array, timestamps (createdAt, updatedAt), createdBy, version number.

#### Hybrid Logical Clock

HLC interface: timestamp (number), counter (number), nodeId (string). This enables distributed ordering of concurrent operations.

#### Operations for CRDT

OperationType: 'insert' | 'update' | 'delete' | 'move'.

Operation structure: id, type, blockId, pageId, payload (union type based on operation), hlc (HLC), authorId.

OperationPayload variants:
- insert: parentId, position, blockType, content
- update: optional properties, optional content
- delete: (empty)
- move: newParentId, newPosition

#### Page Types

Page: id, workspaceId, parentId (nullable for nesting), title, icon, coverUrl, position (fractional), isDatabase boolean, optional databaseSchema, createdBy, timestamps.

#### Database Types

DatabaseSchema contains properties (Record of PropertyDefinition).

PropertyDefinition: id, name, type (PropertyType), optional options (for select types), dateFormat, numberFormat.

PropertyType enumeration: title, text, number, select, multi_select, date, checkbox, url, email, phone, person, relation, rollup, formula.

SelectOption: id, name, color.

DatabaseRow: id, databaseId, properties (Record of PropertyValue), position, timestamps.

PropertyValue is a discriminated union by type with corresponding value shapes.

#### View Types

DatabaseView: id, databaseId, name, type ('table' | 'board' | 'list' | 'calendar' | 'gallery'), config (ViewConfig), position.

ViewConfig: filters array, sorts array, optional groupBy (property ID for board view), visibleProperties array, propertyWidths record.

Filter: propertyId, operator (FilterOperator), value.

FilterOperator: equals, not_equals, contains, not_contains, greater_than, less_than, is_empty, is_not_empty.

Sort: propertyId, direction ('asc' | 'desc').

#### WebSocket Messages

WSClientMessage union:
- subscribe: pageId
- unsubscribe
- operation: Operation
- cursor: CursorPosition
- sync: since (HLC)

WSServerMessage union:
- subscribed: pageId, presence array
- operation: Operation
- ack: operationId
- presence: PresenceEvent
- sync: operations array
- error: message

CursorPosition: blockId, offset.

PresenceInfo: userId, name, color, optional cursor.

PresenceEvent: action ('join' | 'leave' | 'cursor') with corresponding fields.

#### API Response Types

ApiResponse<T>: success boolean, optional data (T), optional error string.

PaginatedResponse<T>: items array, optional cursor, hasMore boolean.

---

### 3. High-Level Architecture (4 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Frontend (React)                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ BlockEditor │  │  PageTree   │  │DatabaseView │  │  Presence   │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │               │
│  ┌──────┴────────────────┴────────────────┴────────────────┴──────┐        │
│  │                         Zustand Stores                          │        │
│  │  (blockStore, pageStore, presenceStore, syncStore)             │        │
│  └────────────────────────────┬───────────────────────────────────┘        │
│                               │                                            │
│  ┌────────────────────────────┴───────────────────────────────────┐        │
│  │                     Sync Engine (useSync hook)                  │        │
│  │  - Operation queue    - HLC management    - Optimistic updates │        │
│  └───────────────┬─────────────────────────┬──────────────────────┘        │
│                  │                         │                               │
│          ┌───────┴───────┐         ┌───────┴───────┐                       │
│          │  REST Client  │         │ WebSocket     │                       │
│          │  (api.ts)     │         │ Client        │                       │
│          └───────────────┘         └───────────────┘                       │
└──────────────────┼─────────────────────────┼───────────────────────────────┘
                   │                         │
                   ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Backend (Node.js)                               │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Express + WebSocket Server                     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                      │                                       │
│  ┌───────────────┬───────────────────┼───────────────────┬───────────────┐  │
│  │               │                   │                   │               │  │
│  ▼               ▼                   ▼                   ▼               ▼  │
│ PageService  BlockService      SyncService        CacheService   QueueService│
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                              Data Layer                                │  │
│  │  PostgreSQL (primary)  │  Redis (cache + pub/sub)  │  RabbitMQ (async)│  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 4. Sync Engine - Frontend (8 minutes)

#### Hybrid Logical Clock Implementation

"I'm implementing HLC for operation ordering because it handles clock skew between distributed clients while maintaining causal ordering. The combination of physical timestamp and logical counter ensures unique, totally ordered timestamps."

The HybridLogicalClock class maintains timestamp, counter, and nodeId (generated UUID). The now() method returns a new HLC: if physical time exceeds stored timestamp, reset counter to 0; otherwise increment counter. The receive(remote) method merges clocks by taking the maximum timestamp and incrementing counters appropriately.

#### SyncEngine Class

The SyncEngine manages WebSocket connection with reconnection logic (exponential backoff up to 5 attempts), pending operations map, and current page subscription.

Constructor takes wsUrl and handlers object with callbacks: onOperation, onPresence, onSync, onConnected, onDisconnected.

connect() establishes WebSocket, sets up onopen (reset reconnect attempts, resubscribe to page, resend pending operations), onmessage (parse and handleMessage), onclose (call handler, attemptReconnect), onerror (close socket).

handleMessage switches on message type:
- operation: receive HLC, call onOperation handler
- ack: remove from pendingOperations map
- presence: call onPresence handler
- sync: receive all HLCs, call onSync handler
- subscribed/error: log appropriately

createOperation(type, blockId, pageId, payload, authorId) generates operation with UUID and HLC timestamp, adds to pending map, sends to server, returns operation for optimistic update.

Helper methods: subscribe(pageId), unsubscribe(), updateCursor(), requestSync(since).

#### React Hook for Sync

useSync(pageId, userId) hook creates SyncEngine on mount with handlers that:
- Skip own operations in onOperation (already applied optimistically)
- Map presence events to addUser/removeUser/updateCursor store actions
- Apply all operations from onSync

The hook subscribes to pageId on change and provides operation creators:

insertBlock(parentId, position, blockType, content): Generates blockId UUID, creates operation payload, applies optimistic update via addBlockOptimistic, sends via createOperation.

updateBlock(blockId, updates): Creates update payload, applies via updateBlockOptimistic, sends operation.

deleteBlock(blockId): Creates delete payload, applies via deleteBlockOptimistic, sends operation.

moveBlock(blockId, newParentId, newPosition): Creates move payload, updates optimistically, sends operation.

sendCursor(blockId, offset): Sends cursor position via updateCursor.

Returns all operation creators plus hasPendingChanges boolean.

---

### 5. Sync Engine - Backend (8 minutes)

#### SyncService Class

"I'm implementing last-write-wins conflict resolution at the block level because it's simpler than full CRDT and sufficient for block-granularity operations. The HLC comparison in UPDATE queries ensures we don't apply stale operations."

Constructor takes database pool, Redis client, and nodeId.

applyOperation(op) wraps all work in a transaction:
1. Switch on payload type, call appropriate handler
2. persistOperation to operations table
3. COMMIT transaction
4. Invalidate cache keys (page blocks, individual block)
5. Broadcast via Redis pub/sub

handleInsert: INSERT INTO blocks with ON CONFLICT DO NOTHING for idempotency.

handleUpdate: UPDATE blocks with subquery checking no newer operation exists (comparing hlc_timestamp and hlc_counter). Returns whether update was applied.

handleDelete: Recursive CTE to soft-delete block and all children (SET deleted_at).

handleMove: UPDATE parent_id and position.

persistOperation: INSERT operation record with HLC fields for sync history.

getOperationsSince(pageId, since): Query operations WHERE hlc > since, ORDER BY hlc components, LIMIT 1000.

#### WebSocket Handler Class

Maintains clients map (clientId to Client object with ws, userId, userName, userColor, pageId, cursor), pageSubscribers map (pageId to Set of clientIds).

Uses two Redis connections: redisSub for pattern subscribe, redisPub for publishing.

setupRedisSubscription: psubscribe to 'page:*:ops' and 'page:*:presence'. On pmessage, extract pageId and type from channel, get subscribers, send to each (skipping operation originator).

setupWebSocket: On connection, extract user info from headers, generate clientId, store Client. On message, parse and handleMessage. On close, handleDisconnect.

handleMessage switches on type:
- subscribe: handleSubscribe
- unsubscribe: handleUnsubscribe
- operation: handleOperation
- cursor: handleCursor
- sync: handleSync

handleSubscribe: Unsubscribe from previous page if any, add to pageSubscribers, get current presence, send subscribed message, publish join event.

handleUnsubscribe: Remove from subscribers, publish leave event, clear pageId/cursor.

handleOperation: Apply via syncService, send ack on success, send error on failure.

handleCursor: Update client cursor, publish cursor event.

handleSync: Get operations since HLC via syncService, send sync response.

getPagePresence: Collect all clients on page into PresenceInfo array.

generateColor: Deterministic color from userId hash for consistent avatars.

---

### 6. Page API - Full Stack Flow (5 minutes)

#### Backend API Routes

GET /:pageId:
1. Check Redis cache for page:${pageId}:full
2. If miss, query page with workspace join and member check
3. Query all non-deleted blocks for page, ordered by position
4. Cache result for 5 minutes
5. Return { page, blocks }

POST /:
1. Calculate position (increment max position of siblings)
2. INSERT page with workspace, parent, title, icon
3. CREATE initial empty text block
4. Invalidate workspace pages cache
5. Return created page

PATCH /:pageId:
1. UPDATE page with COALESCE for partial updates
2. Subquery validates user is workspace member
3. Invalidate page and workspace caches
4. Return updated page

Helper functions mapPage and mapBlock transform database rows to API types, converting snake_case to camelCase and dates to ISO strings.

#### Frontend API Client

fetchWithAuth<T> wrapper: Adds credentials:'include' and Content-Type header, throws on non-ok responses.

getPage(pageId): Fetch /pages/${pageId}, extract data or throw error.

createPage(params): POST /pages with body, return created page.

updatePage(pageId, updates): PATCH /pages/${pageId} with body, return updated page.

getWorkspacePages(workspaceId): GET /workspaces/${workspaceId}/pages, return pages array.

---

### 7. Offline Support (4 minutes)

#### IndexedDB Schema

"I'm using IndexedDB for offline storage because it handles structured data well, supports indexes for efficient queries, and has much larger capacity than localStorage."

NotionDB schema with three object stores:
- operations: key=id, indexes by-page (pageId) and by-synced (boolean as number)
- blocks: key=id, index by-page (pageId)
- pages: key=id, index by-workspace (workspaceId)

#### OfflineStore Class

init(): Open database, create object stores with indexes on upgrade.

queueOperation(operation): Put operation with synced=false.

getUnsyncedOperations(): getAllFromIndex where synced=0.

markSynced(operationId): Get operation, set synced=true, put back.

cacheBlocks(pageId, blocks): Transaction to put all blocks.

getCachedBlocks(pageId): getAllFromIndex by pageId.

updateCachedBlock(block): Put individual block.

cachePage/getCachedPage: Simple put/get operations.

#### useOfflineData Hook

Manages data loading with offline awareness:

State: data (page + blocks), isOffline, isLoading.

Effect for online/offline events: Listen to window events, update isOffline state.

Effect for data loading:
- If online: Fetch from server, cache to IndexedDB
- If offline: Load from IndexedDB cache
- On error: Fallback to cache

Returns { data, isOffline, isLoading }.

---

### 8. Trade-offs and Decisions

| Decision | Chosen Approach | Alternative | Rationale |
|----------|-----------------|-------------|-----------|
| ✅ WebSocket + Redis Pub/Sub | Server-Sent Events | Bidirectional needed for operations |
| ✅ HLC + Last-Write-Wins | Full CRDT (Yjs) | Simpler, sufficient for block-level ops |
| ✅ Shared types package | GraphQL codegen | Explicit, no build step dependency |
| ✅ IndexedDB via idb | localStorage | Structured data, larger capacity |
| ✅ Optimistic with rollback | Wait for server ack | Better perceived performance |
| ✅ Event-driven cache invalidation | TTL-only | Immediate consistency when online |

---

### 9. Future Full-Stack Enhancements

1. **Yjs integration** - Replace custom CRDT with production-grade library
2. **Collaborative cursors** - Real-time cursor position visualization
3. **Conflict UI** - Show conflicts and allow user resolution
4. **Background sync** - Service worker for true offline-first
5. **Operational transforms** - For character-level text editing
6. **Multi-device sync** - Sync state across user devices seamlessly
