# Dropbox - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Problem Statement

Design the backend infrastructure for a cloud file storage and synchronization service that allows users to:
- Upload and download files with resumable chunked transfers
- Deduplicate content across users and files
- Sync changes across multiple devices
- Share files and folders with access control
- Maintain version history for file recovery

## Requirements Clarification

### Functional Requirements
1. **File Upload/Download**: Support files up to 10GB with chunked, resumable transfers
2. **Deduplication**: Content-addressed storage to avoid storing duplicate data
3. **Sync Across Devices**: Real-time notifications when files change
4. **Version History**: Track and restore previous file versions
5. **Sharing**: Public links and user-specific folder sharing with permissions

### Non-Functional Requirements
1. **Durability**: 99.999999999% (11 nines) - no data loss
2. **Availability**: 99.9% uptime for read operations
3. **Sync Latency**: Changes visible within 2 seconds
4. **Bandwidth Efficiency**: Minimize data transfer through deduplication and delta sync
5. **Scalability**: Support petabytes of storage and millions of users

### Scale Estimates
- 500M users, 100M daily active
- 10 billion files, average 1MB each = 10 PB
- Peak: 50K operations/sec (uploads, downloads, metadata)
- Daily upload: 1 PB new data
- Deduplication savings: ~30% storage reduction

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Load Balancer (nginx)                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │ API Server  │ │ API Server  │ │ API Server  │
            │   (Node)    │ │   (Node)    │ │   (Node)    │
            └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
                   │               │               │
                   └───────────────┼───────────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            │                      │                      │
            ▼                      ▼                      ▼
    ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
    │  PostgreSQL  │      │    Valkey    │      │   RabbitMQ   │
    │  (Metadata)  │      │   (Cache +   │      │  (Sync Notif │
    │              │      │   Sessions)  │      │  + Jobs)     │
    └──────────────┘      └──────────────┘      └──────────────┘
                                                       │
                                                       ▼
                          ┌──────────────┐      ┌──────────────┐
                          │    MinIO     │      │ Sync Workers │
                          │ (S3 Chunks)  │      │ (Background) │
                          └──────────────┘      └──────────────┘
```

## Deep Dive: File Chunking and Deduplication

### Chunking Strategy

Files are split into fixed-size chunks (4MB default) for several benefits:

```
┌─────────────────────────────────────────────────────────────┐
│                    Chunking Benefits                          │
├─────────────────────────────────────────────────────────────┤
│  1. Resumable uploads - only retransmit failed chunks         │
│  2. Deduplication - same content = same hash = stored once    │
│  3. Delta sync - only upload chunks that changed              │
│  4. Parallel transfer - multiple chunks simultaneously        │
└─────────────────────────────────────────────────────────────┘
```

### Database Schema

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **users** | id (UUID PK), email (unique), password_hash, storage_quota_bytes (default 10GB), storage_used_bytes | — | Users with storage quota tracking |
| **folders** | id (UUID PK), owner_id (FK), parent_id (self-ref FK), name, path (materialized path), deleted_at (soft delete) | idx_folders_path (path) | Hierarchical folder structure; unique constraint on (owner_id, parent_id, name) where not deleted |
| **files** | id (UUID PK), owner_id (FK), folder_id (FK), name, size_bytes, current_version (default 1), deleted_at | — | File metadata only; unique constraint on (owner_id, folder_id, name) where not deleted |
| **chunks** | hash (SHA-256, VARCHAR(64) PK), size_bytes, reference_count (default 1), storage_location (S3 bucket/key) | — | Content-addressed chunk storage; reference counting enables garbage collection |
| **file_versions** | id (UUID PK), file_id (FK cascade), version_number, size_bytes | — | Each version references an ordered list of chunks; unique on (file_id, version_number) |
| **version_chunks** | version_id + chunk_index (composite PK), chunk_hash (FK to chunks) | — | Maps versions to their ordered chunks |
| **upload_sessions** | id (UUID PK), user_id (FK), folder_id (FK), filename, total_size, chunk_size (default 4MB), total_chunks, received_chunks (integer array), status (default 'pending'), expires_at (24 hours) | — | Tracks resumable upload progress |

### Deduplication Algorithm

When a client initiates an upload, it sends the filename, size, folder ID, and an array of SHA-256 hashes for all chunks (computed client-side). The server then:

1. **Check which chunks already exist** - Query the chunks table for any matching hashes from the provided list.
2. **Determine needed chunks** - Build a set of existing hashes and filter the chunk list to identify only those that need uploading, preserving their index positions.
3. **Create an upload session** - Insert a new upload_sessions row with the file metadata and total chunk count, using the default 4MB chunk size.
4. **Return the session** - Respond with the upload ID, chunk size, the list of chunk indices that need uploading, and the count of chunks that were deduplicated (already exist in storage).

> "This approach saves significant bandwidth. If the user uploads a file that is 50% identical to existing content, we skip half the chunks entirely. The client only transfers what is genuinely new."

### Why Content-Addressed Storage?

| Approach | Pros | Cons |
|----------|------|------|
| **Content-addressed (chosen)** | Automatic deduplication, immutable chunks | Hash computation overhead |
| Per-file storage | Simple implementation | No deduplication |
| File-level dedup | Simpler than chunk | Misses partial duplicates |

**Decision**: Content-addressed storage with SHA-256 hashes provides:
1. Automatic deduplication across all users
2. Immutable chunks simplify caching
3. 30%+ storage savings in practice

## Deep Dive: Chunk Storage with MinIO

### Storage Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     MinIO Bucket Layout                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  dropbox-chunks/                                              │
│    chunks/                                                    │
│      {sha256-hash}     # Raw chunk data                       │
│                        # Path: chunks/a1b2c3d4e5f6...         │
│                                                               │
│  dropbox-temp/                                                │
│    uploads/                                                   │
│      {session-id}/                                            │
│        {chunk-index}   # Temp storage during upload           │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Chunk Upload with Verification

Each chunk upload follows this process:

1. **Verify hash integrity** - Compute the SHA-256 hash of the received data and compare it against the hash declared by the client. If they do not match, reject the chunk with a hash mismatch error.
2. **Check for deduplication** - Query the chunks table to see if this hash already exists in storage.
3. **If chunk exists** - Increment the reference_count on the existing chunk row (no data upload needed).
4. **If chunk is new** - Upload the raw data to MinIO at the path `chunks/{hash}` in the "dropbox-chunks" bucket, then insert a new row into the chunks table with the hash, size, and storage location.
5. **Update upload session** - Append the chunk index to the received_chunks array in the upload_sessions table.
6. **Return result** - Indicate the hash and whether this chunk was deduplicated.

### Circuit Breaker for Storage

MinIO upload operations are wrapped in a circuit breaker (using the consecutive breaker pattern). After 5 consecutive failures, the breaker opens and rejects all requests immediately. After 30 seconds, it transitions to half-open and allows a single test request through. If that succeeds, the breaker closes and normal traffic resumes. When the breaker opens, the event is logged and a Prometheus metric is updated.

## Deep Dive: Sync Protocol

### Change Notification Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Sync Notification Flow                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. Client A uploads file                                     │
│         │                                                     │
│         ▼                                                     │
│  2. API Server publishes to RabbitMQ                          │
│     Exchange: sync.events, Key: user.{userId}.change          │
│         │                                                     │
│         ▼                                                     │
│  3. Sync Worker consumes message                              │
│         │                                                     │
│         ▼                                                     │
│  4. Worker broadcasts via WebSocket                           │
│         │                                                     │
│         ▼                                                     │
│  5. Client B receives notification, fetches updates           │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### RabbitMQ Topology

The sync system uses a topic exchange called "sync.events" with durable queues. The "sync.notifications" queue is bound with the routing pattern `user.*.change`, has a dead-letter exchange for failed messages, and a 5-minute message TTL.

When a file change occurs, the API server publishes a persistent message to the exchange with routing key `user.{userId}.change`. The message payload contains the event type, user ID, file ID, action performed, and ISO timestamp.

### WebSocket Connection Management

The server maintains an in-memory map of user IDs to their active WebSocket connections (a user may have multiple devices connected simultaneously). When a new WebSocket connects, it is registered in the user's connection set. On disconnect, it is removed.

The sync worker consumes messages from RabbitMQ and broadcasts them to all active WebSocket connections for the target user. Only connections in the OPEN state receive the message. This ensures all of a user's devices receive real-time file change notifications.

## Deep Dive: Version History and Garbage Collection

### Version Storage Strategy

Versions share chunks through deduplication -- only new or changed chunks consume additional storage. To retrieve all chunks for a specific version, the system joins version_chunks with chunks on the hash, filtered by version ID, and orders by chunk_index. Restoring a previous version is a simple update to the files table, setting current_version to the desired version number.

### Garbage Collection

A periodic garbage collection process runs every hour to clean up orphaned chunks:

1. **Find orphaned chunks** - Query for chunks with reference_count <= 0 that were created more than 1 day ago (the delay prevents race conditions with in-progress uploads).
2. **Delete from object storage** - Remove the chunk data from MinIO using the stored storage_location path.
3. **Delete metadata** - Remove the chunk row from the database.
4. **Log** - Record each garbage-collected chunk hash for auditing.

## API Design

### Core Endpoints

```
Authentication:
POST   /api/v1/auth/register     Create account
POST   /api/v1/auth/login        Create session
POST   /api/v1/auth/logout       Destroy session

Upload (Chunked):
POST   /api/v1/upload/init       Start upload, get chunks needed
POST   /api/v1/upload/:id/check  Check existing chunks (dedup)
PUT    /api/v1/upload/:id/chunk/:index  Upload single chunk
POST   /api/v1/upload/:id/complete      Finalize upload

Files:
GET    /api/v1/files             List files in folder
GET    /api/v1/files/:id         Get file metadata
GET    /api/v1/files/:id/download  Stream file download
DELETE /api/v1/files/:id         Soft delete

Versions:
GET    /api/v1/files/:id/versions        List versions
POST   /api/v1/files/:id/versions/:v/restore  Restore version

Sharing:
POST   /api/v1/files/:id/share   Create share link
GET    /api/v1/share/:token      Access shared file

Sync:
WS     /api/v1/sync/ws           WebSocket for sync events
```

### Request/Response Examples

**Upload Init with Deduplication**:

A POST request to `/api/v1/upload/init` sends the filename, file size, folder ID, and an array of chunk hashes (computed client-side). The server responds (201 Created) with an upload ID, chunk size (4MB), total chunk count, the list of chunk indices that actually need uploading (chunks not already stored), the count of deduplicated chunks, and a session expiration timestamp.

## Caching Strategy

### Cache Layers

| Cache Key Pattern | Purpose | TTL |
|-------------------|---------|-----|
| `folder:{folderId}:listing` | Folder listing cache | 5 min |
| `file:{fileId}:meta` | File metadata cache | 10 min |
| `user:{userId}:quota` | User storage quota | 1 min |
| `upload:{uploadId}:session` | Upload session state | 25 hours |

### Cache-Aside Pattern

**Folder listing read path:** Check Redis for the cached folder listing. On cache miss, query PostgreSQL for all files and subfolders in the folder (excluding soft-deleted items), ordered by type (folders first) then name. Cache the result in Redis with a 300-second TTL.

**Cache invalidation on write:** When a file is created or modified in a folder, delete the folder listing cache key for that folder, forcing the next read to fetch fresh data from the database.

## Scalability Considerations

### Database Scaling Path

1. **Current**: Single PostgreSQL instance
2. **Read replicas**: Route folder listings to replicas
3. **Sharding by user_id**: All user's files on same shard
4. **Partition chunks table**: By hash prefix

The chunks table can be hash-partitioned for horizontal scaling. Using PostgreSQL declarative partitioning with HASH on the hash column, the table is split into N partitions (e.g., 4 partitions using MODULUS 4, REMAINDER 0-3). This distributes chunks evenly across partitions since SHA-256 hashes are uniformly distributed.

### Estimated Capacity

| Component | Single Node | Scaled (4x) |
|-----------|-------------|-------------|
| PostgreSQL writes | 1K/sec | 4K/sec (sharded) |
| PostgreSQL reads | 10K/sec | 40K/sec (replicas) |
| MinIO throughput | 1 Gbps | 4 Gbps (cluster) |
| WebSocket connections | 10K | 40K |

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Fixed-size chunks | Simple implementation | Insertion shifts boundaries |
| SHA-256 hashing | Collision-resistant | CPU overhead |
| Reference counting | Enables garbage collection | Must maintain accurately |
| PostgreSQL sessions | Transactional with user data | Slower than Redis |
| WebSocket sync | Real-time notifications | Connection management complexity |
| Last-write-wins conflicts | Simple resolution | May lose data |

## Future Backend Enhancements

1. **Content-defined Chunking**: Rabin fingerprinting for better delta sync
2. **Client-side Encryption**: End-to-end encryption with user-held keys
3. **Delta Sync**: rsync-style block-level differencing
4. **Edge Caching**: CDN integration for popular shared files
5. **Compression**: LZ4 compression for text-heavy files
6. **Rate Limiting**: Per-user upload/download quotas
