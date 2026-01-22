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

```sql
-- Users with storage quota
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    storage_quota_bytes BIGINT DEFAULT 10737418240, -- 10GB
    storage_used_bytes BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Folders with hierarchical structure
CREATE TABLE folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id),
    parent_id UUID REFERENCES folders(id),
    name VARCHAR(255) NOT NULL,
    path TEXT NOT NULL, -- Materialized path for queries
    deleted_at TIMESTAMPTZ,

    UNIQUE(owner_id, parent_id, name) WHERE deleted_at IS NULL
);
CREATE INDEX idx_folders_path ON folders(path);

-- Files (metadata only)
CREATE TABLE files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id),
    folder_id UUID REFERENCES folders(id),
    name VARCHAR(255) NOT NULL,
    size_bytes BIGINT NOT NULL,
    current_version INTEGER DEFAULT 1,
    deleted_at TIMESTAMPTZ,

    UNIQUE(owner_id, folder_id, name) WHERE deleted_at IS NULL
);

-- Content-addressed chunk storage
CREATE TABLE chunks (
    hash VARCHAR(64) PRIMARY KEY, -- SHA-256
    size_bytes INTEGER NOT NULL,
    reference_count INTEGER DEFAULT 1,
    storage_location TEXT NOT NULL, -- S3 bucket/key
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- File versions reference ordered chunks
CREATE TABLE file_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID REFERENCES files(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    size_bytes BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(file_id, version_number)
);

-- Version to chunk mapping
CREATE TABLE version_chunks (
    version_id UUID REFERENCES file_versions(id) ON DELETE CASCADE,
    chunk_hash VARCHAR(64) REFERENCES chunks(hash),
    chunk_index INTEGER NOT NULL,

    PRIMARY KEY(version_id, chunk_index)
);

-- Resumable upload sessions
CREATE TABLE upload_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    folder_id UUID REFERENCES folders(id),
    filename VARCHAR(255) NOT NULL,
    total_size BIGINT NOT NULL,
    chunk_size INTEGER DEFAULT 4194304, -- 4MB
    total_chunks INTEGER NOT NULL,
    received_chunks INTEGER[] DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'pending',
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours'
);
```

### Deduplication Algorithm

```typescript
// Upload initiation with deduplication check
async function initiateUpload(
    userId: string,
    folderId: string,
    filename: string,
    size: number,
    chunkHashes: string[]
): Promise<UploadSession> {
    // Check which chunks already exist in storage
    const existingChunks = await pool.query(`
        SELECT hash FROM chunks WHERE hash = ANY($1)
    `, [chunkHashes]);

    const existingSet = new Set(existingChunks.rows.map(r => r.hash));
    const neededChunks = chunkHashes
        .map((hash, index) => ({ hash, index }))
        .filter(c => !existingSet.has(c.hash));

    // Create upload session
    const session = await pool.query(`
        INSERT INTO upload_sessions (
            user_id, folder_id, filename, total_size,
            total_chunks, chunk_size
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, chunk_size
    `, [userId, folderId, filename, size, chunkHashes.length, 4194304]);

    return {
        uploadId: session.rows[0].id,
        chunkSize: session.rows[0].chunk_size,
        chunksNeeded: neededChunks.map(c => c.index),
        chunksExisting: chunkHashes.length - neededChunks.length
    };
}
```

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

```typescript
async function uploadChunk(
    uploadId: string,
    chunkIndex: number,
    data: Buffer,
    declaredHash: string
): Promise<ChunkResult> {
    // Verify hash matches
    const computedHash = crypto
        .createHash('sha256')
        .update(data)
        .digest('hex');

    if (computedHash !== declaredHash) {
        throw new Error('Chunk hash mismatch');
    }

    // Check if chunk already exists (dedup)
    const existing = await pool.query(
        'SELECT hash FROM chunks WHERE hash = $1',
        [computedHash]
    );

    if (existing.rows.length > 0) {
        // Increment reference count
        await pool.query(
            'UPDATE chunks SET reference_count = reference_count + 1 WHERE hash = $1',
            [computedHash]
        );
    } else {
        // Upload to MinIO
        await minioClient.putObject(
            'dropbox-chunks',
            `chunks/${computedHash}`,
            data
        );

        // Record chunk metadata
        await pool.query(`
            INSERT INTO chunks (hash, size_bytes, storage_location)
            VALUES ($1, $2, $3)
        `, [computedHash, data.length, `chunks/${computedHash}`]);
    }

    // Update upload session
    await pool.query(`
        UPDATE upload_sessions
        SET received_chunks = array_append(received_chunks, $1)
        WHERE id = $2
    `, [chunkIndex, uploadId]);

    return { hash: computedHash, deduplicated: existing.rows.length > 0 };
}
```

### Circuit Breaker for Storage

```typescript
import { CircuitBreaker, ConsecutiveBreaker } from 'cockatiel';

const storageBreaker = new CircuitBreaker({
    breaker: new ConsecutiveBreaker(5),  // Open after 5 failures
    halfOpenAfter: 30000,                 // Try again after 30s
});

async function uploadToStorage(hash: string, data: Buffer) {
    return storageBreaker.execute(async () => {
        return minioClient.putObject('dropbox-chunks', `chunks/${hash}`, data);
    });
}

storageBreaker.onBreak(() => {
    logger.error('MinIO circuit breaker opened');
    metrics.circuitBreakerState.set({ service: 'minio' }, 1);
});
```

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

```typescript
// Exchange and queue setup
await channel.assertExchange('sync.events', 'topic', { durable: true });
await channel.assertQueue('sync.notifications', {
    durable: true,
    arguments: {
        'x-dead-letter-exchange': 'dlx',
        'x-message-ttl': 300000 // 5 min
    }
});
await channel.bindQueue('sync.notifications', 'sync.events', 'user.*.change');

// Publishing sync event
async function publishSyncEvent(userId: string, event: SyncEvent) {
    const message = {
        type: event.type,
        userId,
        fileId: event.fileId,
        action: event.action,
        timestamp: new Date().toISOString()
    };

    channel.publish(
        'sync.events',
        `user.${userId}.change`,
        Buffer.from(JSON.stringify(message)),
        { persistent: true }
    );
}
```

### WebSocket Connection Management

```typescript
const userConnections = new Map<string, Set<WebSocket>>();

function handleWebSocketConnection(ws: WebSocket, userId: string) {
    // Register connection
    if (!userConnections.has(userId)) {
        userConnections.set(userId, new Set());
    }
    userConnections.get(userId)!.add(ws);

    ws.on('close', () => {
        userConnections.get(userId)?.delete(ws);
    });
}

// Sync worker broadcasts to connected clients
async function processSyncMessage(message: SyncEvent) {
    const connections = userConnections.get(message.userId);
    if (!connections) return;

    const payload = JSON.stringify(message);
    for (const ws of connections) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
        }
    }
}
```

## Deep Dive: Version History and Garbage Collection

### Version Storage Strategy

```sql
-- Versions share chunks through deduplication
-- Only new/changed chunks consume additional storage

-- Get all chunks for a specific version
SELECT vc.chunk_index, vc.chunk_hash, c.size_bytes
FROM version_chunks vc
JOIN chunks c ON vc.chunk_hash = c.hash
WHERE vc.version_id = $1
ORDER BY vc.chunk_index;

-- Restore a previous version
UPDATE files
SET current_version = $2
WHERE id = $1;
```

### Garbage Collection

```typescript
async function garbageCollectChunks() {
    // Find chunks with zero references
    const orphanedChunks = await pool.query(`
        SELECT hash, storage_location
        FROM chunks
        WHERE reference_count <= 0
        AND created_at < NOW() - INTERVAL '1 day'
    `);

    for (const chunk of orphanedChunks.rows) {
        // Delete from MinIO
        await minioClient.removeObject('dropbox-chunks', chunk.storage_location);

        // Delete metadata
        await pool.query('DELETE FROM chunks WHERE hash = $1', [chunk.hash]);

        logger.info('Garbage collected chunk', { hash: chunk.hash });
    }
}

// Run garbage collection periodically
async function scheduleGarbageCollection() {
    setInterval(garbageCollectChunks, 60 * 60 * 1000); // Every hour
}
```

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

```http
POST /api/v1/upload/init
Content-Type: application/json

{
    "filename": "report.pdf",
    "size": 15728640,
    "folderId": "550e8400-...",
    "chunkHashes": [
        "a1b2c3d4e5f6...",
        "b2c3d4e5f6a1...",
        "c3d4e5f6a1b2...",
        "d4e5f6a1b2c3..."
    ]
}
```

Response (201 Created):
```json
{
    "uploadId": "660e8400-...",
    "chunkSize": 4194304,
    "totalChunks": 4,
    "chunksNeeded": [0, 2],
    "chunksExisting": 2,
    "expiresAt": "2025-01-22T12:00:00Z"
}
```

## Caching Strategy

### Cache Layers

```typescript
const CACHE_KEYS = {
    // Folder listing cache (5 min TTL)
    folderListing: (folderId: string) => `folder:${folderId}:listing`,

    // File metadata cache (10 min TTL)
    fileMetadata: (fileId: string) => `file:${fileId}:meta`,

    // User storage quota (1 min TTL)
    userQuota: (userId: string) => `user:${userId}:quota`,

    // Upload session (25 hour TTL)
    uploadSession: (uploadId: string) => `upload:${uploadId}:session`
};
```

### Cache-Aside Pattern

```typescript
async function getFolderListing(folderId: string): Promise<FolderContents> {
    const cacheKey = CACHE_KEYS.folderListing(folderId);

    // Check cache
    const cached = await redis.get(cacheKey);
    if (cached) {
        return JSON.parse(cached);
    }

    // Query database
    const contents = await pool.query(`
        SELECT 'file' as type, id, name, size_bytes, updated_at
        FROM files WHERE folder_id = $1 AND deleted_at IS NULL
        UNION ALL
        SELECT 'folder' as type, id, name, NULL, updated_at
        FROM folders WHERE parent_id = $1 AND deleted_at IS NULL
        ORDER BY type DESC, name
    `, [folderId]);

    // Cache result
    await redis.setex(cacheKey, 300, JSON.stringify(contents.rows));

    return contents.rows;
}

// Invalidate on write
async function createFile(file: FileInput): Promise<File> {
    const result = await pool.query(/*...*/);
    await redis.del(CACHE_KEYS.folderListing(file.folder_id));
    return result.rows[0];
}
```

## Scalability Considerations

### Database Scaling Path

1. **Current**: Single PostgreSQL instance
2. **Read replicas**: Route folder listings to replicas
3. **Sharding by user_id**: All user's files on same shard
4. **Partition chunks table**: By hash prefix

```sql
-- Hash-based partitioning for chunks
CREATE TABLE chunks (
    hash VARCHAR(64) PRIMARY KEY,
    ...
) PARTITION BY HASH (hash);

CREATE TABLE chunks_p0 PARTITION OF chunks
    FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE chunks_p1 PARTITION OF chunks
    FOR VALUES WITH (MODULUS 4, REMAINDER 1);
-- etc.
```

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
