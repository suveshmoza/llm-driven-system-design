# Dropbox (Cloud File Storage) - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## Introduction

"Today I'll design a cloud file storage and synchronization service like Dropbox. I'll focus on the complete system integration - how the chunked upload protocol connects frontend to backend, real-time sync via WebSockets, and the end-to-end data flow from drag-and-drop upload to distributed chunk storage. The key challenge is creating a seamless user experience while handling complex backend operations like deduplication, versioning, and conflict resolution."

---

## Step 1: Requirements Clarification

### Functional Requirements

"Let me confirm what we're building:

1. **File Upload/Download**: Chunked resumable uploads for large files, streaming downloads
2. **Sync Across Devices**: Real-time sync notifications via WebSocket
3. **File Sharing**: Share links with passwords and expiration, folder sharing with users
4. **Version History**: Track and restore previous versions
5. **Folder Hierarchy**: Create, rename, move folders with nested structure support

Should I also consider offline support or focus on the web experience?"

### Non-Functional Requirements

"For a full-stack file storage service:

- **Upload Latency**: < 100ms chunk acknowledgment for responsive UI progress
- **Sync Latency**: < 2s change propagation to other devices/tabs
- **Consistency**: Strong for metadata, eventual for sync notifications
- **Resumability**: Must resume uploads after network interruption
- **Responsiveness**: File browser must feel instant (< 50ms TTFB for metadata)"

---

## Step 2: High-Level Architecture

```
┌────────────────────────────────────────────────────────────┐
│                  React Frontend (Vite)                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                   Zustand Store                       │  │
│  │   files, folders, uploadQueue, syncStatus             │  │
│  └──────────────────────────────────────────────────────┘  │
│           │                          │                      │
│           v                          v                      │
│  ┌─────────────────┐     ┌───────────────────────┐         │
│  │  Upload Manager │     │  WebSocket Sync Client │         │
│  └─────────────────┘     └───────────────────────┘         │
└──────────│────────────────────────│─────────────────────────┘
           │                        │
           v                        v
┌────────────────────────────────────────────────────────────┐
│              Express API + WebSocket Server                 │
└────────────────────────────────────────────────────────────┘
           │              │              │
           v              v              v
    ┌───────────┐  ┌───────────┐  ┌───────────┐
    │ PostgreSQL│  │   MinIO   │  │ RabbitMQ  │
    │ (metadata)│  │ (chunks)  │  │  (sync)   │
    └───────────┘  └───────────┘  └───────────┘
```

### Integration Points

| Layer | Frontend Component | Backend Service | Protocol |
|-------|-------------------|-----------------|----------|
| Upload | UploadManager | /api/v1/upload/* | HTTP (multipart) |
| Download | FileDownloader | /api/v1/files/:id/download | HTTP (streaming) |
| Sync | WebSocketClient | /api/v1/sync/ws | WebSocket |
| Metadata | API hooks | /api/v1/files, /folders | REST JSON |
| Auth | SessionContext | /api/v1/auth/* | Cookie-based session |

---

## Deep Dive 1: Chunked Upload Protocol (Full-Stack Integration)

"The upload flow requires tight coordination between frontend and backend. Let me trace the complete data flow."

### Upload Flow Sequence

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Browser    │    │   Express    │    │  PostgreSQL  │    │    MinIO     │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │                   │
       │ POST /upload/init │                   │                   │
       │──────────────────>│                   │                   │
       │                   │ INSERT session    │                   │
       │                   │──────────────────>│                   │
       │  {uploadId, chunkSize, totalChunks}   │                   │
       │<──────────────────│                   │                   │
       │                   │                   │                   │
       │ [Hash chunks locally with Web Crypto] │                   │
       │                   │                   │                   │
       │ POST /upload/:id/check {chunkHashes}  │                   │
       │──────────────────>│                   │                   │
       │                   │ SELECT existing   │                   │
       │                   │──────────────────>│                   │
       │  {needed: [0,2,5], existing: [1,3,4]} │                   │
       │<──────────────────│                   │                   │
       │                   │                   │                   │
       │ PUT /upload/:id/chunk/0 (binary)      │                   │
       │──────────────────>│                   │                   │
       │                   │ Verify hash       │                   │
       │                   │ putObject         │                   │
       │                   │──────────────────────────────────────>│
       │                   │ INSERT/UPDATE chunk ref               │
       │                   │──────────────────>│                   │
       │  {received: true} │                   │                   │
       │<──────────────────│                   │                   │
       │                   │                   │                   │
       │ POST /upload/:id/complete             │                   │
       │──────────────────>│                   │                   │
       │                   │ CREATE file + version (transaction)   │
       │                   │──────────────────>│                   │
       │                   │ Publish sync event to RabbitMQ        │
       │  {fileId, version}│                   │                   │
       │<──────────────────│                   │                   │
```

### Frontend Upload Manager

The UploadManager class handles the chunked upload protocol:

**Key Responsibilities:**
- Initialize upload session with server
- Compute SHA-256 hashes for all chunks using Web Crypto API
- Check which chunks server already has (deduplication)
- Upload only needed chunks with progress tracking
- Finalize upload and create file record

**Upload Session State:**

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique upload session identifier |
| file | File | Browser File object |
| folderId | string | Target folder |
| status | enum | pending, hashing, uploading, paused, complete, error |
| progress | number | 0-100 percentage |
| chunksTotal | number | Total chunks in file |
| chunksUploaded | number | Chunks successfully uploaded |
| chunkHashes | string[] | SHA-256 hashes per chunk |
| chunksNeeded | number[] | Chunk indices server needs |

**Configuration:**
- CHUNK_SIZE: 4MB (fixed size for simplicity)
- Idempotency key per chunk for retry safety
- X-Chunk-Hash header for server-side verification

### Backend Upload Handlers

**POST /upload/init**
- Creates upload session in database
- Tracks session in Redis (24h TTL)
- Returns uploadId, chunkSize, totalChunks, expiresAt

**POST /upload/:id/check**
- Receives array of chunk hashes from client
- Queries chunks table for existing hashes
- Returns needed[] and existing[] indices
- Logs deduplication ratio for metrics

**PUT /upload/:id/chunk/:index**
- Receives binary chunk data
- Verifies hash matches X-Chunk-Hash header
- Stores chunk in MinIO with content-addressed key
- Upserts chunk reference with reference_count++
- Uses circuit breaker for MinIO resilience

**POST /upload/:id/complete**
- Verifies all chunks received
- Creates file and version in transaction
- Links version to chunks via version_chunks table
- Publishes sync event to RabbitMQ
- Invalidates folder cache in Redis

### Upload Progress UI

```
┌─────────────────────────────────────────────────────────┐
│  Uploading 3 files                                      │
├─────────────────────────────────────────────────────────┤
│  ┌──┐ project-proposal.pdf                        85%  │
│  │📄│ ████████████████████████░░░░                     │
│  └──┘                                                   │
├─────────────────────────────────────────────────────────┤
│  ┌──┐ vacation-photos.zip                         42%  │
│  │📦│ ████████████░░░░░░░░░░░░░░░░                     │
│  └──┘                                                   │
├─────────────────────────────────────────────────────────┤
│  ┌──┐ design-mockups.fig                    Preparing... │
│  │🎨│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░                     │
│  └──┘                                                   │
└─────────────────────────────────────────────────────────┘
```

**UI Features:**
- Fixed bottom-right position
- File icon based on mime type
- Progress bar per file
- Status text: percentage or "Preparing..." during hashing
- Error state with red bar and message

---

## Deep Dive 2: Real-Time Sync Integration

"WebSocket sync ensures changes propagate instantly to all connected clients."

### WebSocket Architecture

```
┌────────────────┐   ┌────────────────┐   ┌────────────────┐
│   Browser A    │   │   Browser B    │   │   Browser C    │
└───────┬────────┘   └───────┬────────┘   └───────┬────────┘
        │                    │                    │
        │ WebSocket          │ WebSocket          │ WebSocket
        v                    v                    v
┌─────────────────────────────────────────────────────────────┐
│                    Express + ws Server                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  clients: Map<userId, WebSocket[]>                     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Consume sync.notifications queue
                            v
┌─────────────────────────────────────────────────────────────┐
│                      RabbitMQ Exchange                       │
│                      sync.events (topic)                     │
│         Routing: user.{userId}.change                        │
└─────────────────────────────────────────────────────────────┘
```

### Frontend SyncClient

**Connection Management:**
- Connects with session cookie authentication
- Exponential backoff reconnection (max 5 attempts)
- Heartbeat via ping/pong frames
- Connected state in Zustand store

**Message Handling:**

| Event Type | Action |
|------------|--------|
| file_created | Add file to current folder if matching, refresh folder cache |
| file_updated | Update file metadata (version, updatedAt) |
| file_deleted | Remove file from store |
| folder_changed | Refresh folder listing |

**Reconnection Strategy:**
- Delay = min(1000 * 2^attempts, 30000ms)
- Reset attempts on successful connection
- Show "Offline - reconnecting..." in UI

### Backend WebSocket Handler

**Connection Lifecycle:**
1. Authenticate from session cookie
2. Add to clients Map by userId
3. Track lastPing timestamp
4. Remove on close, decrement metrics

**Heartbeat:**
- Server pings every 30 seconds
- Terminate if no pong within 60 seconds
- Metrics: websocketConnections gauge

**Broadcasting:**
- RabbitMQ consumer binds to user.*.change
- Parse userId from routing key
- Send to all connected WebSocket clients for that user

### Sync Status UI

```
┌──────────────────────────────────────┐
│  ● Synced 2 minutes ago              │  (green dot = connected)
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│  ◌ Syncing 3 changes...              │  (spinning = syncing)
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│  ○ Offline - reconnecting...         │  (red dot = disconnected)
└──────────────────────────────────────┘
```

---

## Deep Dive 3: File Version History

"Version history allows users to restore previous versions. The integration spans UI, API, and storage."

### Version Data Model

```
┌─────────────┐       ┌─────────────────┐       ┌─────────────┐
│    files    │       │  file_versions  │       │   chunks    │
├─────────────┤       ├─────────────────┤       ├─────────────┤
│ id          │──────<│ file_id         │       │ hash (PK)   │
│ name        │       │ version_number  │       │ size_bytes  │
│ current_ver │       │ size_bytes      │       │ ref_count   │
│ owner_id    │       │ created_at      │       └──────┬──────┘
└─────────────┘       │ created_by      │              │
                      └────────┬────────┘              │
                               │                       │
                      ┌────────┴────────┐              │
                      │ version_chunks  │              │
                      ├─────────────────┤              │
                      │ version_id      │──────────────┘
                      │ chunk_hash      │
                      │ chunk_index     │
                      └─────────────────┘
```

### Version Operations

**GET /files/:fileId/versions**
- Verify access (owner or shared folder)
- Return version list with metadata
- Include modifier name, size, timestamp

**POST /files/:fileId/versions/:version/restore**
1. Get version to restore
2. Get current version number
3. Create new version with next number
4. Copy chunk references from old version
5. Increment chunk reference counts
6. Update file current_version
7. Publish sync event

> "Restore creates a NEW version rather than reverting. This preserves full history and uses existing deduplication - restoring shares the same chunks."

### Version History UI

```
┌─────────────────────────────────────────────────┐
│  Version History                            [X] │
├─────────────────────────────────────────────────┤
│  Version 5                          [Current]   │
│  May 15, 2024 3:42 PM - Alice                   │
│  2.4 MB                                         │
│                              [Preview]          │
├─────────────────────────────────────────────────┤
│  Version 4                                      │
│  May 14, 2024 11:20 AM - Bob                    │
│  2.1 MB                                         │
│                         [Preview] [Restore]     │
├─────────────────────────────────────────────────┤
│  Version 3                                      │
│  May 12, 2024 9:15 AM - Alice                   │
│  1.8 MB                                         │
│                         [Preview] [Restore]     │
└─────────────────────────────────────────────────┘
```

---

## Deep Dive 4: Share Links with Security

"Share links need both a seamless UX and backend security controls."

### Share Link Data Model

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| file_id | UUID | Target file |
| token | string | Secure random 32-char hex |
| password_hash | string | bcrypt hash (nullable) |
| expires_at | timestamp | Expiration (nullable) |
| max_downloads | int | Limit (nullable) |
| download_count | int | Current count |
| created_by | UUID | Creator user |

### Share Link Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                       Share Dialog                               │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Password (optional)                                        │ │
│  │  [                                          ]               │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Expires in                                                 │ │
│  │  [ 7 days                                ▼]                 │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Download limit (optional)                                  │ │
│  │  [                                          ]               │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│         [ Create Share Link ]                                    │
└─────────────────────────────────────────────────────────────────┘

                              │
                              v

┌─────────────────────────────────────────────────────────────────┐
│  [https://dropbox.local/s/a1b2c3d4e5f6    ] [ Copy ]            │
│                                                                  │
│  🔒 Password protected                                           │
│  Expires in 7 days                                               │
│  Limited to 100 downloads                                        │
└─────────────────────────────────────────────────────────────────┘
```

### Security Checks

**GET /s/:token**
1. Look up share link by token
2. Check file not deleted
3. Check not expired (expires_at)
4. Check download limit not reached
5. If password_hash, require password
6. Return file metadata and download URL

**Error Responses:**

| Status | Condition |
|--------|-----------|
| 404 | Token not found or file deleted |
| 410 | Link expired or download limit reached |
| 401 | Password required or invalid |

---

## Trade-offs Discussion

| Decision | Frontend Impact | Backend Impact | Why This Choice |
|----------|-----------------|----------------|-----------------|
| Client-side hashing | Adds ~2s per 100MB file | Enables deduplication | Worth the UX cost for bandwidth savings |
| WebSocket sync | Reconnection logic needed | Connection management | Better UX than polling |
| 4MB fixed chunks | Simple progress calculation | Simple storage logic | Good balance of granularity vs overhead |
| Session auth | Cookie handling automatic | Redis session store | Simpler than JWT for this use case |
| Optimistic UI updates | Complex rollback on error | Must handle race conditions | Better perceived performance |

---

## Full-Stack Error Handling

### Error Categories

| Category | Frontend Action | Backend Response |
|----------|-----------------|------------------|
| Session expired (401) | Redirect to /login | Return 401 Unauthorized |
| Service unavailable (503) | Show maintenance banner | Circuit breaker open |
| Network error | Set offline state, queue changes | N/A |
| Validation error (400) | Show field-level errors | Return error message |
| Rate limited (429) | Show retry timer | Return retryAfter header |

### Circuit Breaker Pattern

When MinIO or other services fail:
1. Circuit opens after 5 failures in 30 seconds
2. Return 503 with retryAfter: 30
3. Frontend shows "Storage service temporarily unavailable"
4. Half-open state tests recovery after timeout

---

## Future Enhancements

### Full-Stack Improvements

1. **Offline-first with IndexedDB**: Cache files locally, sync when online
2. **Conflict resolution UI**: Show diff between conflicting versions
3. **Background upload queue**: Use Service Worker for reliable uploads
4. **Real-time collaboration**: CRDT-based concurrent editing
5. **Desktop app with Electron**: Native file system integration

---

## Summary

"This design demonstrates full-stack integration for a cloud storage service:

1. **Chunked Upload Protocol**: Frontend hashes chunks locally using Web Crypto, backend checks for deduplication, only new chunks are uploaded
2. **Real-Time Sync**: WebSocket connection maintained on frontend, RabbitMQ fanout on backend ensures all clients receive updates
3. **Version History**: Chunk-level versioning means versions share storage, UI provides preview and restore
4. **Share Links**: Security controls (password, expiration, limits) enforced on backend, clean UX on frontend

The key full-stack insights are:
- Client-side hashing enables deduplication without server trust issues
- Optimistic UI updates improve perceived performance but require careful error handling
- WebSocket reconnection logic is critical for sync reliability
- Session-based auth simplifies the cookie handling across the stack

What aspects of the frontend-backend integration would you like me to elaborate on?"
