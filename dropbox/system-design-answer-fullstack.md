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
+------------------------------------------+
|          React Frontend (Vite)           |
|  +------------------------------------+  |
|  |        Zustand Store               |  |
|  |  - files, folders, uploadQueue     |  |
|  |  - syncStatus, selectedItems       |  |
|  +------------------------------------+  |
|         |              |                 |
|         v              v                 |
|  +-------------+  +---------------+      |
|  | Upload      |  | WebSocket     |      |
|  | Manager     |  | Sync Client   |      |
|  +-------------+  +---------------+      |
+---------|----------------|---------------+
          |                |
          v                v
+------------------------------------------+
|         Express API + WebSocket           |
+------------------------------------------+
          |        |        |
          v        v        v
    +-------+  +-------+  +-------+
    |Postgres|  | MinIO |  |RabbitMQ|
    +-------+  +-------+  +-------+
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

### Frontend Upload Manager

```typescript
// stores/uploadStore.ts
interface UploadState {
  uploads: Map<string, UploadSession>;
  addFiles: (files: File[], folderId: string | null) => void;
  pauseUpload: (uploadId: string) => void;
  resumeUpload: (uploadId: string) => void;
}

interface UploadSession {
  id: string;
  file: File;
  folderId: string | null;
  status: 'pending' | 'hashing' | 'uploading' | 'paused' | 'complete' | 'error';
  progress: number;
  chunksTotal: number;
  chunksUploaded: number;
  chunkHashes: string[];
  chunksNeeded: number[];
  error?: string;
}

// UploadManager handles the chunked upload protocol
class UploadManager {
  private readonly CHUNK_SIZE = 4 * 1024 * 1024; // 4MB
  private crypto = window.crypto.subtle;

  async uploadFile(file: File, folderId: string | null): Promise<string> {
    // Step 1: Initialize upload session
    const initResponse = await fetch('/api/v1/upload/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        size: file.size,
        folderId,
        mimeType: file.type
      })
    });
    const { uploadId, chunkSize, totalChunks } = await initResponse.json();

    // Step 2: Hash all chunks locally (Web Crypto API)
    const chunkHashes = await this.computeChunkHashes(file, chunkSize);
    updateUploadStatus(uploadId, 'hashing', { progress: 50 });

    // Step 3: Check which chunks server already has (deduplication)
    const checkResponse = await fetch(`/api/v1/upload/${uploadId}/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunkHashes })
    });
    const { needed, existing } = await checkResponse.json();

    // Step 4: Upload only needed chunks with progress tracking
    updateUploadStatus(uploadId, 'uploading', {
      chunksUploaded: existing.length,
      chunksTotal: totalChunks
    });

    for (const chunkIndex of needed) {
      const chunk = await this.readChunk(file, chunkIndex, chunkSize);
      await this.uploadChunk(uploadId, chunkIndex, chunk, chunkHashes[chunkIndex]);
      updateUploadProgress(uploadId, chunkIndex);
    }

    // Step 5: Finalize upload
    const completeResponse = await fetch(`/api/v1/upload/${uploadId}/complete`, {
      method: 'POST'
    });
    const { fileId, version } = await completeResponse.json();

    return fileId;
  }

  private async computeChunkHashes(file: File, chunkSize: number): Promise<string[]> {
    const hashes: string[] = [];
    const totalChunks = Math.ceil(file.size / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const chunk = file.slice(i * chunkSize, (i + 1) * chunkSize);
      const buffer = await chunk.arrayBuffer();
      const hashBuffer = await this.crypto.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      hashes.push(hashHex);
    }

    return hashes;
  }

  private async uploadChunk(
    uploadId: string,
    index: number,
    data: ArrayBuffer,
    expectedHash: string
  ): Promise<void> {
    const response = await fetch(`/api/v1/upload/${uploadId}/chunk/${index}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Idempotency-Key': `${uploadId}-chunk-${index}`,
        'X-Chunk-Hash': expectedHash
      },
      body: data
    });

    if (!response.ok) {
      throw new Error(`Chunk upload failed: ${response.statusText}`);
    }
  }
}
```

### Backend Upload Handler

```typescript
// routes/upload.ts
router.post('/upload/init', authMiddleware, async (req, res) => {
  const { filename, size, folderId, mimeType } = req.body;

  const uploadSession = await db.query(`
    INSERT INTO upload_sessions (user_id, folder_id, filename, total_size, total_chunks, status)
    VALUES ($1, $2, $3, $4, $5, 'pending')
    RETURNING id, chunk_size, total_chunks, expires_at
  `, [
    req.user.id,
    folderId,
    filename,
    size,
    Math.ceil(size / CHUNK_SIZE)
  ]);

  // Track active session in Redis
  await redis.setex(
    `upload:active:${uploadSession.id}`,
    86400, // 24 hours
    JSON.stringify({ userId: req.user.id, filename, status: 'pending' })
  );

  res.status(201).json({
    uploadId: uploadSession.id,
    chunkSize: CHUNK_SIZE,
    totalChunks: uploadSession.total_chunks,
    expiresAt: uploadSession.expires_at
  });
});

router.post('/upload/:uploadId/check', authMiddleware, async (req, res) => {
  const { uploadId } = req.params;
  const { chunkHashes } = req.body;

  // Query which chunks already exist in content-addressed storage
  const existing = await db.query(`
    SELECT hash FROM chunks WHERE hash = ANY($1)
  `, [chunkHashes]);

  const existingSet = new Set(existing.rows.map(r => r.hash));
  const needed: number[] = [];
  const existingIndices: number[] = [];

  chunkHashes.forEach((hash, index) => {
    if (existingSet.has(hash)) {
      existingIndices.push(index);
    } else {
      needed.push(index);
    }
  });

  // Update session with expected hashes
  await db.query(`
    UPDATE upload_sessions SET chunk_hashes = $1 WHERE id = $2
  `, [chunkHashes, uploadId]);

  // Log deduplication savings
  const dedupRatio = existingIndices.length / chunkHashes.length;
  metrics.dedupRatio.set(dedupRatio);
  logger.info({ uploadId, dedupRatio, needed: needed.length }, 'Chunk deduplication check');

  res.json({ needed, existing: existingIndices });
});

router.put('/upload/:uploadId/chunk/:index',
  authMiddleware,
  idempotencyMiddleware,
  async (req, res) => {
    const { uploadId, index } = req.params;
    const expectedHash = req.headers['x-chunk-hash'] as string;
    const chunkData = req.body as Buffer;

    // Verify chunk hash matches
    const actualHash = crypto.createHash('sha256').update(chunkData).digest('hex');
    if (actualHash !== expectedHash) {
      return res.status(400).json({ error: 'Hash mismatch' });
    }

    // Store chunk in MinIO (content-addressed)
    await circuitBreaker.execute(async () => {
      await minioClient.putObject('chunks', actualHash, chunkData);
    });

    // Update or insert chunk reference
    await db.query(`
      INSERT INTO chunks (hash, size_bytes, reference_count)
      VALUES ($1, $2, 1)
      ON CONFLICT (hash) DO UPDATE SET reference_count = chunks.reference_count + 1
    `, [actualHash, chunkData.length]);

    // Mark chunk as received in session
    await db.query(`
      UPDATE upload_sessions
      SET received_chunks = array_append(received_chunks, $1)
      WHERE id = $2
    `, [parseInt(index), uploadId]);

    res.json({ received: true, hash: actualHash });
});

router.post('/upload/:uploadId/complete', authMiddleware, async (req, res) => {
  const { uploadId } = req.params;

  const session = await db.query(`
    SELECT * FROM upload_sessions WHERE id = $1 AND user_id = $2
  `, [uploadId, req.user.id]);

  if (!session.rows[0]) {
    return res.status(404).json({ error: 'Upload session not found' });
  }

  const { folder_id, filename, total_size, chunk_hashes } = session.rows[0];

  // Create file and version in a transaction
  const result = await db.transaction(async (client) => {
    const file = await client.query(`
      INSERT INTO files (owner_id, folder_id, name, size_bytes, current_version)
      VALUES ($1, $2, $3, $4, 1)
      RETURNING id
    `, [req.user.id, folder_id, filename, total_size]);

    const version = await client.query(`
      INSERT INTO file_versions (file_id, version_number, size_bytes, created_by)
      VALUES ($1, 1, $2, $3)
      RETURNING id
    `, [file.rows[0].id, total_size, req.user.id]);

    // Link version to chunks
    for (let i = 0; i < chunk_hashes.length; i++) {
      await client.query(`
        INSERT INTO version_chunks (version_id, chunk_hash, chunk_index)
        VALUES ($1, $2, $3)
      `, [version.rows[0].id, chunk_hashes[i], i]);
    }

    return file.rows[0];
  });

  // Publish sync event
  await rabbitmq.publish('sync.events', `user.${req.user.id}.change`, {
    type: 'file_created',
    fileId: result.id,
    folderId: folder_id,
    filename,
    timestamp: new Date().toISOString()
  });

  // Invalidate folder cache
  await redis.del(`cache:folder:${folder_id || 'root:' + req.user.id}:listing`);

  res.json({ fileId: result.id, version: 1 });
});
```

### Upload UI Component

```tsx
// components/UploadArea.tsx
function UploadArea() {
  const { uploads, addFiles } = useUploadStore();
  const { currentFolderId } = useFolderStore();
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) {
      addFiles(files, currentFolderId);
    }
  }, [addFiles, currentFolderId]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  return (
    <div
      className={cn(
        "relative min-h-screen",
        isDragging && "bg-blue-50 border-2 border-dashed border-blue-400"
      )}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragging(false)}
    >
      {/* File browser content */}
      <FileBrowser />

      {/* Upload progress panel */}
      {uploads.size > 0 && (
        <UploadProgressPanel uploads={uploads} />
      )}

      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 flex items-center justify-center bg-blue-100/80">
          <div className="text-2xl font-semibold text-blue-600">
            Drop files to upload
          </div>
        </div>
      )}
    </div>
  );
}

function UploadProgressPanel({ uploads }: { uploads: Map<string, UploadSession> }) {
  return (
    <div className="fixed bottom-4 right-4 w-80 bg-white rounded-lg shadow-xl border">
      <div className="p-3 border-b font-medium">
        Uploading {uploads.size} file{uploads.size > 1 ? 's' : ''}
      </div>
      <div className="max-h-64 overflow-y-auto">
        {Array.from(uploads.values()).map(upload => (
          <UploadProgressItem key={upload.id} upload={upload} />
        ))}
      </div>
    </div>
  );
}

function UploadProgressItem({ upload }: { upload: UploadSession }) {
  const progressPercent = Math.round(
    (upload.chunksUploaded / upload.chunksTotal) * 100
  );

  return (
    <div className="p-3 border-b last:border-b-0">
      <div className="flex items-center gap-2">
        <FileIcon mimeType={upload.file.type} className="w-5 h-5" />
        <span className="flex-1 truncate text-sm">{upload.file.name}</span>
        <span className="text-xs text-gray-500">
          {upload.status === 'hashing' ? 'Preparing...' : `${progressPercent}%`}
        </span>
      </div>
      <div className="mt-2 h-1 bg-gray-200 rounded">
        <div
          className={cn(
            "h-full rounded transition-all",
            upload.status === 'error' ? 'bg-red-500' : 'bg-blue-500'
          )}
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      {upload.status === 'error' && (
        <div className="mt-1 text-xs text-red-600">{upload.error}</div>
      )}
    </div>
  );
}
```

---

## Deep Dive 2: Real-Time Sync Integration

"WebSocket sync ensures changes propagate instantly to all connected clients."

### Frontend WebSocket Client

```typescript
// services/syncClient.ts
class SyncClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;

  connect() {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/v1/sync/ws`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      useSyncStore.getState().setConnected(true);
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleSyncMessage(message);
    };

    this.ws.onclose = () => {
      useSyncStore.getState().setConnected(false);
      this.attemptReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private handleSyncMessage(message: SyncEvent) {
    const { refreshFolder, addFile, removeFile, updateFile } = useFileStore.getState();

    switch (message.type) {
      case 'file_created':
        // Optimistically add file to current view if in same folder
        if (message.folderId === useFileStore.getState().currentFolderId) {
          addFile({
            id: message.fileId,
            name: message.filename,
            type: 'file',
            updatedAt: message.timestamp
          });
        }
        // Invalidate folder cache
        refreshFolder(message.folderId);
        break;

      case 'file_updated':
        updateFile(message.fileId, {
          version: message.version,
          updatedAt: message.timestamp
        });
        break;

      case 'file_deleted':
        removeFile(message.fileId);
        break;

      case 'folder_changed':
        refreshFolder(message.folderId);
        break;
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      this.reconnectAttempts++;
      console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
      setTimeout(() => this.connect(), delay);
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Zustand store for sync state
interface SyncState {
  connected: boolean;
  lastSyncTime: Date | null;
  pendingChanges: number;
  setConnected: (connected: boolean) => void;
}

const useSyncStore = create<SyncState>((set) => ({
  connected: false,
  lastSyncTime: null,
  pendingChanges: 0,
  setConnected: (connected) => set({ connected, lastSyncTime: new Date() }),
}));
```

### Backend WebSocket Handler

```typescript
// routes/sync.ts
import { WebSocketServer, WebSocket } from 'ws';
import { verifySession } from '../middleware/auth';

interface ConnectedClient {
  ws: WebSocket;
  userId: string;
  lastPing: Date;
}

const clients = new Map<string, ConnectedClient[]>();

export function setupWebSocket(server: http.Server) {
  const wss = new WebSocketServer({ server, path: '/api/v1/sync/ws' });

  wss.on('connection', async (ws, req) => {
    // Authenticate from session cookie
    const session = await verifySession(req);
    if (!session) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const userId = session.userId;

    // Add to connected clients
    if (!clients.has(userId)) {
      clients.set(userId, []);
    }
    clients.get(userId)!.push({ ws, userId, lastPing: new Date() });

    logger.info({ userId }, 'WebSocket client connected');
    metrics.websocketConnections.inc({ userId });

    ws.on('pong', () => {
      const client = clients.get(userId)?.find(c => c.ws === ws);
      if (client) client.lastPing = new Date();
    });

    ws.on('close', () => {
      const userClients = clients.get(userId);
      if (userClients) {
        const index = userClients.findIndex(c => c.ws === ws);
        if (index !== -1) userClients.splice(index, 1);
        if (userClients.length === 0) clients.delete(userId);
      }
      metrics.websocketConnections.dec({ userId });
    });
  });

  // Heartbeat to detect dead connections
  setInterval(() => {
    const now = new Date();
    clients.forEach((userClients, userId) => {
      userClients.forEach((client, index) => {
        if (now.getTime() - client.lastPing.getTime() > 60000) {
          client.ws.terminate();
          userClients.splice(index, 1);
        } else {
          client.ws.ping();
        }
      });
    });
  }, 30000);
}

// Called from RabbitMQ consumer to broadcast sync events
export function broadcastToUser(userId: string, event: SyncEvent) {
  const userClients = clients.get(userId);
  if (userClients) {
    const message = JSON.stringify(event);
    userClients.forEach(client => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    });
  }
}

// RabbitMQ consumer for sync events
async function startSyncConsumer() {
  const channel = await rabbitmq.createChannel();
  await channel.assertQueue('sync.notifications');
  await channel.bindQueue('sync.notifications', 'sync.events', 'user.*.change');

  channel.consume('sync.notifications', (msg) => {
    if (msg) {
      const event = JSON.parse(msg.content.toString());
      const userId = msg.fields.routingKey.split('.')[1];

      broadcastToUser(userId, event);
      channel.ack(msg);
    }
  });
}
```

### Sync Status UI

```tsx
// components/SyncStatus.tsx
function SyncStatus() {
  const { connected, lastSyncTime, pendingChanges } = useSyncStore();

  return (
    <div className="flex items-center gap-2 text-sm text-gray-600">
      <div
        className={cn(
          "w-2 h-2 rounded-full",
          connected ? "bg-green-500" : "bg-red-500"
        )}
      />
      <span>
        {connected
          ? pendingChanges > 0
            ? `Syncing ${pendingChanges} changes...`
            : `Synced ${formatRelativeTime(lastSyncTime)}`
          : 'Offline - reconnecting...'
        }
      </span>
    </div>
  );
}
```

---

## Deep Dive 3: File Version History

"Version history allows users to restore previous versions. The integration spans UI, API, and storage."

### Version History API

```typescript
// routes/versions.ts
router.get('/files/:fileId/versions', authMiddleware, async (req, res) => {
  const { fileId } = req.params;

  // Verify access
  const file = await db.query(`
    SELECT f.*,
           (f.owner_id = $2 OR EXISTS (
             SELECT 1 FROM folder_shares fs
             WHERE fs.folder_id = f.folder_id AND fs.shared_with = $2
           )) as has_access
    FROM files f WHERE f.id = $1
  `, [fileId, req.user.id]);

  if (!file.rows[0]?.has_access) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const versions = await db.query(`
    SELECT
      fv.id,
      fv.version_number,
      fv.size_bytes,
      fv.created_at,
      u.display_name as modified_by
    FROM file_versions fv
    JOIN users u ON fv.created_by = u.id
    WHERE fv.file_id = $1
    ORDER BY fv.version_number DESC
  `, [fileId]);

  res.json({
    fileId,
    currentVersion: file.rows[0].current_version,
    versions: versions.rows
  });
});

router.post('/files/:fileId/versions/:version/restore', authMiddleware, async (req, res) => {
  const { fileId, version } = req.params;

  // Start transaction
  const result = await db.transaction(async (client) => {
    // Get version to restore
    const versionData = await client.query(`
      SELECT * FROM file_versions WHERE file_id = $1 AND version_number = $2
    `, [fileId, version]);

    if (!versionData.rows[0]) {
      throw new Error('Version not found');
    }

    // Get current version number
    const file = await client.query(`
      SELECT current_version FROM files WHERE id = $1
    `, [fileId]);

    const newVersionNumber = file.rows[0].current_version + 1;

    // Create new version by copying chunk references
    const newVersion = await client.query(`
      INSERT INTO file_versions (file_id, version_number, size_bytes, created_by)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, [fileId, newVersionNumber, versionData.rows[0].size_bytes, req.user.id]);

    // Copy chunk references
    await client.query(`
      INSERT INTO version_chunks (version_id, chunk_hash, chunk_index)
      SELECT $1, chunk_hash, chunk_index
      FROM version_chunks WHERE version_id = $2
    `, [newVersion.rows[0].id, versionData.rows[0].id]);

    // Increment chunk reference counts
    await client.query(`
      UPDATE chunks SET reference_count = reference_count + 1
      WHERE hash IN (
        SELECT chunk_hash FROM version_chunks WHERE version_id = $1
      )
    `, [newVersion.rows[0].id]);

    // Update file current version
    await client.query(`
      UPDATE files SET current_version = $1, updated_at = NOW() WHERE id = $2
    `, [newVersionNumber, fileId]);

    return { version: newVersionNumber };
  });

  // Publish sync event
  await rabbitmq.publish('sync.events', `user.${req.user.id}.change`, {
    type: 'file_updated',
    fileId,
    version: result.version,
    action: 'restored',
    restoredFrom: parseInt(version),
    timestamp: new Date().toISOString()
  });

  res.json({ success: true, newVersion: result.version });
});
```

### Version History UI

```tsx
// components/VersionHistory.tsx
function VersionHistory({ fileId, onClose }: { fileId: string; onClose: () => void }) {
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<number | null>(null);

  useEffect(() => {
    fetchVersions();
  }, [fileId]);

  const fetchVersions = async () => {
    const response = await fetch(`/api/v1/files/${fileId}/versions`);
    const data = await response.json();
    setVersions(data.versions);
    setLoading(false);
  };

  const handleRestore = async (versionNumber: number) => {
    setRestoring(versionNumber);
    try {
      await fetch(`/api/v1/files/${fileId}/versions/${versionNumber}/restore`, {
        method: 'POST'
      });
      await fetchVersions();
      toast.success(`Restored to version ${versionNumber}`);
    } catch (error) {
      toast.error('Failed to restore version');
    } finally {
      setRestoring(null);
    }
  };

  const handlePreview = (versionId: string) => {
    window.open(`/api/v1/files/${fileId}/versions/${versionId}/download`, '_blank');
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Version History</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {versions.map((version, index) => (
            <div
              key={version.id}
              className="p-4 border-b hover:bg-gray-50 flex items-center justify-between"
            >
              <div>
                <div className="font-medium">
                  Version {version.version_number}
                  {index === 0 && (
                    <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                      Current
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-500">
                  {format(new Date(version.created_at), 'MMM d, yyyy h:mm a')}
                  {' - '}{version.modified_by}
                </div>
                <div className="text-xs text-gray-400">
                  {formatFileSize(version.size_bytes)}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handlePreview(version.id)}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Preview
                </button>
                {index > 0 && (
                  <button
                    onClick={() => handleRestore(version.version_number)}
                    disabled={restoring === version.version_number}
                    className="text-sm text-green-600 hover:text-green-800 disabled:opacity-50"
                  >
                    {restoring === version.version_number ? 'Restoring...' : 'Restore'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

---

## Deep Dive 4: Share Links with Security

"Share links need both a seamless UX and backend security controls."

### Share Link API

```typescript
// routes/shares.ts
router.post('/files/:fileId/share', authMiddleware, async (req, res) => {
  const { fileId } = req.params;
  const { password, expiresInDays, maxDownloads } = req.body;

  // Verify ownership
  const file = await db.query(`
    SELECT * FROM files WHERE id = $1 AND owner_id = $2
  `, [fileId, req.user.id]);

  if (!file.rows[0]) {
    return res.status(403).json({ error: 'Only owners can share files' });
  }

  // Generate secure token
  const token = crypto.randomBytes(16).toString('hex');

  // Hash password if provided
  const passwordHash = password
    ? await bcrypt.hash(password, 12)
    : null;

  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const shareLink = await db.query(`
    INSERT INTO share_links (file_id, created_by, token, password_hash, expires_at, max_downloads)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, token, expires_at
  `, [fileId, req.user.id, token, passwordHash, expiresAt, maxDownloads]);

  const shareUrl = `${process.env.BASE_URL}/s/${token}`;

  res.json({
    shareUrl,
    token: shareLink.rows[0].token,
    expiresAt: shareLink.rows[0].expires_at,
    passwordProtected: !!password
  });
});

// Public access to shared file
router.get('/s/:token', async (req, res) => {
  const { token } = req.params;
  const { password } = req.query;

  const share = await db.query(`
    SELECT sl.*, f.name, f.size_bytes, f.mime_type
    FROM share_links sl
    JOIN files f ON sl.file_id = f.id
    WHERE sl.token = $1 AND f.deleted_at IS NULL
  `, [token]);

  if (!share.rows[0]) {
    return res.status(404).json({ error: 'Share link not found' });
  }

  const { password_hash, expires_at, max_downloads, download_count } = share.rows[0];

  // Check expiration
  if (expires_at && new Date() > new Date(expires_at)) {
    return res.status(410).json({ error: 'Share link has expired' });
  }

  // Check download limit
  if (max_downloads && download_count >= max_downloads) {
    return res.status(410).json({ error: 'Download limit reached' });
  }

  // Check password
  if (password_hash) {
    if (!password) {
      return res.status(401).json({
        error: 'Password required',
        passwordRequired: true
      });
    }
    const valid = await bcrypt.compare(password as string, password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid password' });
    }
  }

  // Return file info (actual download is separate endpoint)
  res.json({
    filename: share.rows[0].name,
    size: share.rows[0].size_bytes,
    mimeType: share.rows[0].mime_type,
    downloadUrl: `/api/v1/s/${token}/download${password ? `?password=${password}` : ''}`
  });
});
```

### Share Dialog UI

```tsx
// components/ShareDialog.tsx
function ShareDialog({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [options, setOptions] = useState({
    password: '',
    expiresInDays: 7,
    maxDownloads: null as number | null
  });
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const response = await fetch(`/api/v1/files/${file.id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: options.password || undefined,
          expiresInDays: options.expiresInDays,
          maxDownloads: options.maxDownloads
        })
      });
      const data = await response.json();
      setShareUrl(data.shareUrl);
    } catch (error) {
      toast.error('Failed to create share link');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Dialog open onClose={onClose}>
      <Dialog.Title>Share {file.name}</Dialog.Title>

      {!shareUrl ? (
        <div className="space-y-4 p-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Password (optional)
            </label>
            <input
              type="password"
              value={options.password}
              onChange={(e) => setOptions({ ...options, password: e.target.value })}
              className="w-full border rounded px-3 py-2"
              placeholder="Leave empty for no password"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Expires in
            </label>
            <select
              value={options.expiresInDays}
              onChange={(e) => setOptions({ ...options, expiresInDays: parseInt(e.target.value) })}
              className="w-full border rounded px-3 py-2"
            >
              <option value={1}>1 day</option>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={0}>Never</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Download limit (optional)
            </label>
            <input
              type="number"
              value={options.maxDownloads || ''}
              onChange={(e) => setOptions({
                ...options,
                maxDownloads: e.target.value ? parseInt(e.target.value) : null
              })}
              className="w-full border rounded px-3 py-2"
              placeholder="Unlimited"
              min="1"
            />
          </div>

          <button
            onClick={handleCreate}
            disabled={creating}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create Share Link'}
          </button>
        </div>
      ) : (
        <div className="p-4 space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={shareUrl}
              readOnly
              className="flex-1 border rounded px-3 py-2 bg-gray-50"
            />
            <button
              onClick={handleCopy}
              className="px-4 py-2 bg-gray-100 rounded hover:bg-gray-200"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <div className="text-sm text-gray-600">
            {options.password && (
              <div className="flex items-center gap-1">
                <LockIcon className="w-4 h-4" /> Password protected
              </div>
            )}
            {options.expiresInDays > 0 && (
              <div>Expires in {options.expiresInDays} days</div>
            )}
            {options.maxDownloads && (
              <div>Limited to {options.maxDownloads} downloads</div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
```

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

```typescript
// Frontend API wrapper with error handling
async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  try {
    const response = await fetch(`/api/v1${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (response.status === 401) {
      // Session expired - redirect to login
      window.location.href = '/login';
      throw new Error('Session expired');
    }

    if (response.status === 503) {
      // Service unavailable - show maintenance message
      useAppStore.getState().setMaintenanceMode(true);
      throw new Error('Service temporarily unavailable');
    }

    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(error.message || 'Request failed', response.status);
    }

    return response.json();
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      // Network error
      useSyncStore.getState().setConnected(false);
      throw new Error('Network connection lost');
    }
    throw error;
  }
}

// Backend error middleware
function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  logger.error({
    err,
    path: req.path,
    method: req.method,
    userId: req.user?.id
  }, 'Request error');

  if (err.name === 'CircuitBreakerOpenError') {
    return res.status(503).json({
      error: 'Storage service temporarily unavailable',
      retryAfter: 30
    });
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }

  res.status(500).json({ error: 'Internal server error' });
}
```

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
