# Design iCloud Sync - Architecture

## System Overview

iCloud is a file and data synchronization service across Apple devices. Core challenges involve consistency, conflict resolution, and efficient sync at scale.

**Learning Goals:**
- Build bidirectional sync protocols
- Design conflict resolution systems
- Implement chunk-based file transfer
- Handle offline-first architecture

---

## Requirements

### Functional Requirements

1. **Sync**: Synchronize files across devices
2. **Photos**: Store and sync photo library
3. **Conflict**: Detect and resolve conflicts
4. **Offline**: Work offline, sync when connected
5. **Share**: Share files and albums

### Non-Functional Requirements

- **Consistency**: Eventual consistency with conflict detection
- **Latency**: < 5 seconds for sync propagation
- **Storage**: Petabytes of user data
- **Privacy**: End-to-end encryption for sensitive data

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Client Layer                                │
│          iPhone │ iPad │ Mac │ Apple Watch │ Web                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway                                  │
│              (Auth, Rate Limiting, Routing)                     │
└─────────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Sync Service │    │ Photo Service │    │ CloudKit      │
│               │    │               │    │               │
│ - File sync   │    │ - Library     │    │ - App data    │
│ - Conflict    │    │ - Analysis    │    │ - Key-value   │
│ - Versions    │    │ - Sharing     │    │ - Database    │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Data Layer                                 │
├─────────────────┬───────────────────┬───────────────────────────┤
│   PostgreSQL    │   Object Storage  │      Cassandra            │
│   - Metadata    │   - File chunks   │      - Sync state         │
│   - Users       │   - Photos        │      - Version vectors    │
└─────────────────┴───────────────────┴───────────────────────────┘
```

---

## Core Components

### 1. Sync Protocol

**Version Vectors for Conflict Detection:**
```javascript
class SyncEngine {
  constructor(deviceId) {
    this.deviceId = deviceId
    this.localState = new Map() // fileId -> { version, hash, modTime }
  }

  async sync() {
    // 1. Get local changes since last sync
    const localChanges = await this.getLocalChanges()

    // 2. Get server changes
    const serverState = await this.fetchServerState()

    // 3. Detect conflicts
    const { toUpload, toDownload, conflicts } = this.reconcile(
      localChanges,
      serverState
    )

    // 4. Handle conflicts
    for (const conflict of conflicts) {
      await this.resolveConflict(conflict)
    }

    // 5. Upload local changes
    for (const file of toUpload) {
      await this.uploadFile(file)
    }

    // 6. Download server changes
    for (const file of toDownload) {
      await this.downloadFile(file)
    }

    // 7. Update sync state
    await this.updateSyncState()
  }

  reconcile(localChanges, serverState) {
    const toUpload = []
    const toDownload = []
    const conflicts = []

    // Process all known files
    const allFileIds = new Set([
      ...localChanges.keys(),
      ...serverState.keys()
    ])

    for (const fileId of allFileIds) {
      const local = localChanges.get(fileId)
      const server = serverState.get(fileId)

      if (!server) {
        // New local file, upload it
        toUpload.push(local)
      } else if (!local) {
        // New server file, download it
        toDownload.push(server)
      } else {
        // Both exist, check versions
        const comparison = this.compareVersions(local.version, server.version)

        if (comparison === 'local-newer') {
          toUpload.push(local)
        } else if (comparison === 'server-newer') {
          toDownload.push(server)
        } else if (comparison === 'conflict') {
          conflicts.push({ fileId, local, server })
        }
        // If equal, no action needed
      }
    }

    return { toUpload, toDownload, conflicts }
  }

  compareVersions(localVersion, serverVersion) {
    // Version vectors: { deviceId: sequenceNumber }
    let localNewer = false
    let serverNewer = false

    const allDevices = new Set([
      ...Object.keys(localVersion),
      ...Object.keys(serverVersion)
    ])

    for (const device of allDevices) {
      const localSeq = localVersion[device] || 0
      const serverSeq = serverVersion[device] || 0

      if (localSeq > serverSeq) localNewer = true
      if (serverSeq > localSeq) serverNewer = true
    }

    if (localNewer && serverNewer) return 'conflict'
    if (localNewer) return 'local-newer'
    if (serverNewer) return 'server-newer'
    return 'equal'
  }
}
```

### 2. Chunk-Based File Transfer

**Efficient Delta Sync:**
```javascript
class ChunkedUploader {
  constructor(chunkSize = 4 * 1024 * 1024) { // 4MB chunks
    this.chunkSize = chunkSize
  }

  async uploadFile(fileId, filePath) {
    const fileSize = await fs.stat(filePath).size
    const totalChunks = Math.ceil(fileSize / this.chunkSize)

    // Get existing chunks on server
    const existingChunks = await this.getServerChunks(fileId)
    const existingHashes = new Set(existingChunks.map(c => c.hash))

    const chunks = []
    const stream = fs.createReadStream(filePath, {
      highWaterMark: this.chunkSize
    })

    let chunkIndex = 0
    for await (const data of stream) {
      const hash = crypto.createHash('sha256').update(data).digest('hex')

      chunks.push({
        index: chunkIndex,
        hash,
        size: data.length
      })

      // Only upload if chunk doesn't exist (deduplication)
      if (!existingHashes.has(hash)) {
        await this.uploadChunk(hash, data)
      }

      chunkIndex++
    }

    // Update file manifest
    await this.updateFileManifest(fileId, {
      chunks,
      totalSize: fileSize,
      version: this.incrementVersion(fileId)
    })

    return chunks
  }

  async downloadFile(fileId, destPath) {
    const manifest = await this.getFileManifest(fileId)

    const writeStream = fs.createWriteStream(destPath)

    for (const chunk of manifest.chunks) {
      const data = await this.downloadChunk(chunk.hash)

      // Verify chunk integrity
      const actualHash = crypto.createHash('sha256').update(data).digest('hex')
      if (actualHash !== chunk.hash) {
        throw new Error(`Chunk integrity check failed for ${chunk.hash}`)
      }

      writeStream.write(data)
    }

    writeStream.end()
  }

  async uploadChunk(hash, data) {
    // Encrypt chunk before upload
    const encrypted = await this.encrypt(data)

    await s3.upload({
      Bucket: 'icloud-chunks',
      Key: `chunks/${hash}`,
      Body: encrypted,
      ContentType: 'application/octet-stream'
    }).promise()
  }
}
```

### 3. Conflict Resolution

**Automatic and Manual Resolution:**
```javascript
class ConflictResolver {
  async resolveConflict(conflict) {
    const { fileId, local, server } = conflict

    // Try automatic resolution based on file type
    const fileType = this.getFileType(fileId)

    switch (fileType) {
      case 'text':
        return this.mergeTextFiles(local, server)

      case 'photo':
        // Photos: keep both as separate files
        return this.keepBoth(local, server)

      case 'document':
        // Documents: use last-modified wins, keep other as conflict copy
        return this.lastWriteWins(local, server)

      default:
        // Unknown type: ask user
        return this.promptUser(local, server)
    }
  }

  async mergeTextFiles(local, server) {
    // Three-way merge using common ancestor
    const ancestor = await this.getCommonAncestor(local, server)

    const localContent = await this.getContent(local)
    const serverContent = await this.getContent(server)
    const ancestorContent = await this.getContent(ancestor)

    try {
      const merged = diff3Merge(localContent, ancestorContent, serverContent)

      if (!merged.hasConflicts) {
        // Clean merge
        return {
          type: 'merged',
          content: merged.result
        }
      } else {
        // Has conflicts, create conflict file
        return {
          type: 'manual',
          conflictFile: this.createConflictFile(local, server, merged)
        }
      }
    } catch (e) {
      return this.keepBoth(local, server)
    }
  }

  async keepBoth(local, server) {
    // Rename server version with conflict suffix
    const conflictName = this.generateConflictName(server)

    return {
      type: 'kept-both',
      localFile: local,
      conflictCopy: {
        ...server,
        name: conflictName
      }
    }
  }

  generateConflictName(file) {
    const ext = path.extname(file.name)
    const base = path.basename(file.name, ext)
    const timestamp = new Date().toISOString().split('T')[0]
    const device = file.lastModifiedDevice

    return `${base} (${device}'s conflicted copy ${timestamp})${ext}`
  }
}
```

### 4. Photo Library Sync

**Optimized Photo Storage:**
```javascript
class PhotoLibrary {
  async syncPhoto(photo) {
    // Upload full resolution to cloud
    const fullResHash = await this.uploadOriginal(photo)

    // Generate derivatives
    const derivatives = await this.generateDerivatives(photo)

    // Store metadata
    await db.query(`
      INSERT INTO photos (id, user_id, hash, taken_at, location, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [photo.id, photo.userId, fullResHash, photo.takenAt,
        photo.location, photo.exifData])

    // Upload derivatives
    for (const [size, derivative] of Object.entries(derivatives)) {
      await this.uploadDerivative(photo.id, size, derivative)
    }

    return { photoId: photo.id, hash: fullResHash }
  }

  async generateDerivatives(photo) {
    return {
      thumbnail: await this.resize(photo, 200, 200),
      preview: await this.resize(photo, 1024, 1024),
      display: await this.resize(photo, 2048, 2048)
    }
  }

  // Optimize device storage
  async optimizeDeviceStorage(deviceId, targetFreeSpace) {
    // Get photos on device sorted by last viewed
    const photos = await db.query(`
      SELECT p.*, dp.last_viewed
      FROM photos p
      JOIN device_photos dp ON p.id = dp.photo_id
      WHERE dp.device_id = $1
      AND dp.has_full_res = true
      ORDER BY dp.last_viewed ASC
    `, [deviceId])

    let freedSpace = 0
    const toOptimize = []

    for (const photo of photos.rows) {
      if (freedSpace >= targetFreeSpace) break

      // Keep full-res in cloud, replace with preview on device
      toOptimize.push(photo.id)
      freedSpace += photo.full_res_size - photo.preview_size
    }

    return { photosToOptimize: toOptimize, estimatedFreedSpace: freedSpace }
  }

  async downloadFullResolution(photoId) {
    const photo = await this.getPhotoMeta(photoId)
    const originalData = await this.downloadOriginal(photo.hash)

    // Mark that this device now has full-res
    await db.query(`
      UPDATE device_photos
      SET has_full_res = true, last_viewed = NOW()
      WHERE photo_id = $1 AND device_id = $2
    `, [photoId, this.deviceId])

    return originalData
  }
}
```

### 5. End-to-End Encryption

**Secure Key Management:**
```javascript
class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-gcm'
  }

  async encryptFile(fileData, userId) {
    // Get or create per-file key
    const fileKey = crypto.randomBytes(32)

    // Encrypt file data
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv(this.algorithm, fileKey, iv)

    const encrypted = Buffer.concat([
      cipher.update(fileData),
      cipher.final()
    ])

    const authTag = cipher.getAuthTag()

    // Wrap file key with user's master key
    const masterKey = await this.getUserMasterKey(userId)
    const wrappedKey = await this.wrapKey(fileKey, masterKey)

    return {
      encryptedData: encrypted,
      iv,
      authTag,
      wrappedKey
    }
  }

  async decryptFile(encryptedData, iv, authTag, wrappedKey, userId) {
    // Unwrap file key
    const masterKey = await this.getUserMasterKey(userId)
    const fileKey = await this.unwrapKey(wrappedKey, masterKey)

    // Decrypt file
    const decipher = crypto.createDecipheriv(this.algorithm, fileKey, iv)
    decipher.setAuthTag(authTag)

    return Buffer.concat([
      decipher.update(encryptedData),
      decipher.final()
    ])
  }

  async getUserMasterKey(userId) {
    // Master key derived from user's password
    // Stored in device's secure enclave/keychain
    const keyData = await keychain.get(`icloud_master_${userId}`)
    return Buffer.from(keyData, 'hex')
  }

  async wrapKey(key, wrapperKey) {
    // AES-KW (Key Wrap)
    const wrapped = crypto.createCipheriv('aes-256-wrap', wrapperKey, null)
    return Buffer.concat([wrapped.update(key), wrapped.final()])
  }
}
```

---

## Database Schema

```sql
-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY,
  apple_id VARCHAR(200) UNIQUE NOT NULL,
  storage_quota BIGINT DEFAULT 5368709120, -- 5GB
  storage_used BIGINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Files
CREATE TABLE files (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  name VARCHAR(500) NOT NULL,
  path VARCHAR(1000) NOT NULL,
  size BIGINT NOT NULL,
  content_hash VARCHAR(64),
  version JSONB, -- Version vector
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  modified_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_files_user_path ON files(user_id, path);

-- File Chunks
CREATE TABLE file_chunks (
  file_id UUID REFERENCES files(id),
  chunk_index INTEGER,
  chunk_hash VARCHAR(64) NOT NULL,
  chunk_size INTEGER NOT NULL,
  PRIMARY KEY (file_id, chunk_index)
);

-- Sync State (per device)
CREATE TABLE device_sync_state (
  device_id UUID,
  user_id UUID REFERENCES users(id),
  last_sync_token VARCHAR(100),
  sync_cursor JSONB,
  last_sync_at TIMESTAMP,
  PRIMARY KEY (device_id, user_id)
);

-- Photos
CREATE TABLE photos (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  hash VARCHAR(64) NOT NULL,
  taken_at TIMESTAMP,
  location GEOGRAPHY(Point),
  width INTEGER,
  height INTEGER,
  full_res_size BIGINT,
  metadata JSONB,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_photos_user_date ON photos(user_id, taken_at DESC);

-- Shared Albums
CREATE TABLE shared_albums (
  id UUID PRIMARY KEY,
  owner_id UUID REFERENCES users(id),
  name VARCHAR(200) NOT NULL,
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE album_photos (
  album_id UUID REFERENCES shared_albums(id),
  photo_id UUID REFERENCES photos(id),
  added_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (album_id, photo_id)
);

CREATE TABLE album_subscribers (
  album_id UUID REFERENCES shared_albums(id),
  user_id UUID REFERENCES users(id),
  can_contribute BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (album_id, user_id)
);
```

---

## Key Design Decisions

### 1. Version Vectors

**Decision**: Use version vectors for conflict detection

**Rationale**:
- Detects concurrent edits across devices
- No central coordinator needed
- Handles network partitions

### 2. Chunk-Based Storage

**Decision**: Split files into content-addressed chunks

**Rationale**:
- Enables deduplication
- Efficient delta sync
- Resumable uploads/downloads

### 3. Optimized Storage Mode

**Decision**: Replace full-res photos with previews on device

**Rationale**:
- Saves device storage
- Full-res always in cloud
- Download on demand

---

## Trade-offs Summary

| Decision | Chosen | Alternative | Reason |
|----------|--------|-------------|--------|
| Sync model | Version vectors | Timestamps | Conflict detection |
| Storage | Chunked, content-addressed | Whole file | Deduplication, delta |
| Encryption | Per-file keys | Single user key | Key rotation, sharing |
| Photos | Optimized on-device | Full sync | Device storage limits |
