import { Router, Request, Response } from 'express';
import { pool } from '../db.js';
import { SyncService } from '../services/sync.js';
import { broadcastToUser } from '../services/websocket.js';
import logger from '../shared/logger.js';
import type { Logger } from 'pino';
import { syncDuration, syncOperationsTotal, conflictsTotal, startTimer, bytesDownloaded } from '../shared/metrics.js';
import { withIdempotency } from '../shared/idempotency.js';

const router = Router();
const syncService = new SyncService();

interface SyncChange {
  fileId: string;
  operation: string;
  path?: string;
  name?: string;
  contentHash?: string;
  versionVector?: VersionVector;
  mimeType?: string;
  size?: number;
  data?: unknown;
}

interface PushChangesBody {
  changes: SyncChange[];
}

interface ResolveConflictBody {
  fileId: string;
  resolution: string;
  keepBoth?: boolean;
}

interface DeltaSyncBody {
  fileId: string;
  localChunkHashes: string[];
}

interface GetChangesQuery {
  since?: string;
}

type VersionVector = Record<string, number>;

interface FileRow {
  id: string;
  name: string;
  path: string;
  mime_type: string | null;
  size: number;
  content_hash: string | null;
  version_vector: VersionVector;
  is_folder: boolean;
  is_deleted: boolean;
  modified_at: Date;
  last_modified_by: string | null;
  created_at?: Date;
}

interface ConflictRow {
  id: string;
  file_id: string;
  name: string;
  path: string;
  version_number: number;
  content_hash: string;
  version_vector: VersionVector;
  device_name: string | null;
  created_at: Date;
}

interface ChunkRow {
  chunk_index: number;
  chunk_hash: string;
  chunk_size: number;
}

interface DeviceStateRow {
  last_sync_at: Date | null;
  sync_cursor: Record<string, unknown> | null;
}

// Get sync state for device
router.get('/state', async (req: Request, res: Response): Promise<void> => {
  const log: Logger = req.log || logger;
  try {
    const userId = req.user!.id;
    const deviceId = req.deviceId;

    if (!deviceId) {
      res.status(400).json({ error: 'Device ID required for sync' });
      return;
    }

    // Get device sync state
    const deviceState = await pool.query<DeviceStateRow>(
      `SELECT last_sync_at, sync_cursor
       FROM devices
       WHERE id = $1 AND user_id = $2`,
      [deviceId, userId]
    );

    if (deviceState.rows.length === 0) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    const state = deviceState.rows[0];

    res.json({
      deviceId,
      lastSyncAt: state.last_sync_at,
      syncCursor: state.sync_cursor,
    });
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Get sync state error');
    res.status(500).json({ error: 'Failed to get sync state' });
  }
});

// Get changes since last sync
router.get('/changes', async (req: Request<object, unknown, unknown, GetChangesQuery>, res: Response): Promise<void> => {
  const log: Logger = req.log || logger;
  const timer = startTimer(syncDuration, { operation: 'get_changes' });

  try {
    const userId = req.user!.id;
    const deviceId = req.deviceId;
    const { since } = req.query;

    if (!deviceId) {
      timer.end({ result: 'error' });
      res.status(400).json({ error: 'Device ID required for sync' });
      return;
    }

    const sinceDate = since ? new Date(since) : new Date(0);

    // Get files modified since last sync (excluding this device's changes)
    const changes = await pool.query<FileRow>(
      `SELECT id, name, path, mime_type, size, content_hash, version_vector,
              is_folder, is_deleted, modified_at, last_modified_by
       FROM files
       WHERE user_id = $1
         AND modified_at > $2
         AND (last_modified_by IS NULL OR last_modified_by != $3)
       ORDER BY modified_at ASC
       LIMIT 1000`,
      [userId, sinceDate, deviceId]
    );

    // Group by operation type
    const created: FileRow[] = [];
    const updated: FileRow[] = [];
    const deleted: FileRow[] = [];

    for (const file of changes.rows) {
      if (file.is_deleted) {
        deleted.push(file);
      } else if (file.created_at && file.created_at.getTime() === file.modified_at.getTime()) {
        created.push(file);
      } else {
        updated.push(file);
      }
    }

    // Generate new sync cursor
    const newCursor = changes.rows.length > 0
      ? changes.rows[changes.rows.length - 1].modified_at.toISOString()
      : sinceDate.toISOString();

    timer.end({ result: 'success' });
    syncOperationsTotal.inc({ operation: 'get_changes', result: 'success' });

    log.info({
      event: 'sync.changes_fetched',
      userId,
      deviceId,
      changesCount: changes.rows.length,
    });

    res.json({
      changes: {
        created: created.map(f => ({
          id: f.id,
          name: f.name,
          path: f.path,
          mimeType: f.mime_type,
          size: f.size,
          contentHash: f.content_hash,
          versionVector: f.version_vector,
          isFolder: f.is_folder,
          modifiedAt: f.modified_at,
        })),
        updated: updated.map(f => ({
          id: f.id,
          name: f.name,
          path: f.path,
          mimeType: f.mime_type,
          size: f.size,
          contentHash: f.content_hash,
          versionVector: f.version_vector,
          isFolder: f.is_folder,
          modifiedAt: f.modified_at,
        })),
        deleted: deleted.map(f => ({
          id: f.id,
          name: f.name,
          path: f.path,
          mimeType: f.mime_type,
          size: f.size,
          contentHash: f.content_hash,
          versionVector: f.version_vector,
          isFolder: f.is_folder,
          modifiedAt: f.modified_at,
        })),
      },
      cursor: newCursor,
      hasMore: changes.rows.length === 1000,
    });
  } catch (error) {
    timer.end({ result: 'error' });
    syncOperationsTotal.inc({ operation: 'get_changes', result: 'error' });
    log.error({ error: (error as Error).message }, 'Get changes error');
    res.status(500).json({ error: 'Failed to get changes' });
  }
});

// Push local changes to server - wrapped with idempotency for safe retries
router.post('/push', withIdempotency(async (req: Request<object, unknown, PushChangesBody>, res: Response): Promise<void> => {
  const log: Logger = req.log || logger;
  const timer = startTimer(syncDuration, { operation: 'push' });

  try {
    const userId = req.user!.id;
    const deviceId = req.deviceId;
    const { changes } = req.body;

    if (!deviceId) {
      timer.end({ result: 'error' });
      res.status(400).json({ error: 'Device ID required for sync' });
      return;
    }

    if (!changes || !Array.isArray(changes)) {
      timer.end({ result: 'error' });
      res.status(400).json({ error: 'Changes array required' });
      return;
    }

    const results: {
      applied: { fileId: string; newVersion: VersionVector }[];
      conflicts: { fileId: string; localVersion: VersionVector | undefined; serverVersion: VersionVector; conflictType: string }[];
      errors: { fileId: string; error: string }[];
    } = {
      applied: [],
      conflicts: [],
      errors: [],
    };

    for (const change of changes) {
      try {
        const result = await syncService.applyChange(userId, deviceId, change);

        if (result.conflict) {
          results.conflicts.push({
            fileId: change.fileId,
            localVersion: change.versionVector,
            serverVersion: result.serverVersion!,
            conflictType: result.conflictType!,
          });

          // Track conflict metrics
          conflictsTotal.inc({
            conflict_type: result.conflictType!,
            resolution: 'pending',
          });

          log.warn({
            event: 'sync.conflict_detected',
            fileId: change.fileId,
            conflictType: result.conflictType,
          });
        } else {
          results.applied.push({
            fileId: change.fileId,
            newVersion: result.versionVector!,
          });

          // Notify other devices
          broadcastToUser(userId, {
            type: `file_${change.operation}`,
            file: result.file,
            sourceDevice: deviceId,
          });
        }
      } catch (error) {
        results.errors.push({
          fileId: change.fileId,
          error: (error as Error).message,
        });
        log.error({ error: (error as Error).message, fileId: change.fileId }, 'Failed to apply change');
      }
    }

    // Update device sync state
    await pool.query(
      `UPDATE devices
       SET last_sync_at = NOW(), sync_cursor = $1
       WHERE id = $2`,
      [JSON.stringify({ lastPush: new Date().toISOString() }), deviceId]
    );

    timer.end({ result: 'success' });
    syncOperationsTotal.inc({ operation: 'push', result: 'success' });

    log.info({
      event: 'sync.push_completed',
      userId,
      deviceId,
      applied: results.applied.length,
      conflicts: results.conflicts.length,
      errors: results.errors.length,
    });

    res.json(results);
  } catch (error) {
    timer.end({ result: 'error' });
    syncOperationsTotal.inc({ operation: 'push', result: 'error' });
    log.error({ error: (error as Error).message }, 'Push changes error');
    res.status(500).json({ error: 'Failed to push changes' });
  }
}));

// Resolve conflict
router.post('/resolve-conflict', withIdempotency(async (req: Request<object, unknown, ResolveConflictBody>, res: Response): Promise<void> => {
  const log: Logger = req.log || logger;
  try {
    const userId = req.user!.id;
    const deviceId = req.deviceId;
    const { fileId, resolution, keepBoth } = req.body;

    if (!fileId || !resolution) {
      res.status(400).json({ error: 'fileId and resolution required' });
      return;
    }

    const result = await syncService.resolveConflict(
      userId,
      deviceId,
      fileId,
      resolution,
      keepBoth
    );

    // Track resolution
    conflictsTotal.inc({
      conflict_type: 'resolved',
      resolution: resolution,
    });

    // Notify all devices
    broadcastToUser(userId, {
      type: 'conflict_resolved',
      fileId,
      resolution,
    });

    log.info({
      event: 'sync.conflict_resolved',
      userId,
      fileId,
      resolution,
      keepBoth,
    });

    res.json(result);
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Resolve conflict error');
    res.status(500).json({ error: 'Failed to resolve conflict' });
  }
}));

// Get pending conflicts
router.get('/conflicts', async (req: Request, res: Response): Promise<void> => {
  const log: Logger = req.log || logger;
  try {
    const userId = req.user!.id;

    const conflicts = await pool.query<ConflictRow>(
      `SELECT fv.*, f.name, f.path, d.name as device_name
       FROM file_versions fv
       JOIN files f ON fv.file_id = f.id
       LEFT JOIN devices d ON fv.created_by = d.id
       WHERE f.user_id = $1
         AND fv.is_conflict = TRUE
         AND fv.conflict_resolved = FALSE
       ORDER BY fv.created_at DESC`,
      [userId]
    );

    res.json({
      conflicts: conflicts.rows.map(c => ({
        id: c.id,
        fileId: c.file_id,
        fileName: c.name,
        filePath: c.path,
        versionNumber: c.version_number,
        contentHash: c.content_hash,
        versionVector: c.version_vector,
        deviceName: c.device_name,
        createdAt: c.created_at,
      })),
    });
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Get conflicts error');
    res.status(500).json({ error: 'Failed to get conflicts' });
  }
});

// Delta sync - get only changed chunks
router.post('/delta', async (req: Request<object, unknown, DeltaSyncBody>, res: Response): Promise<void> => {
  const log: Logger = req.log || logger;
  try {
    const userId = req.user!.id;
    const { fileId, localChunkHashes } = req.body;

    if (!fileId || !Array.isArray(localChunkHashes)) {
      res.status(400).json({ error: 'fileId and localChunkHashes required' });
      return;
    }

    // Verify file belongs to user
    const file = await pool.query(
      'SELECT id FROM files WHERE id = $1 AND user_id = $2',
      [fileId, userId]
    );

    if (file.rows.length === 0) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    // Get server chunks
    const serverChunks = await pool.query<ChunkRow>(
      `SELECT chunk_index, chunk_hash, chunk_size
       FROM file_chunks
       WHERE file_id = $1
       ORDER BY chunk_index`,
      [fileId]
    );

    const localHashSet = new Set(localChunkHashes);
    const chunksToDownload: { index: number; hash: string; size: number }[] = [];
    const chunksToKeep: { index: number; hash: string }[] = [];

    for (const chunk of serverChunks.rows) {
      if (localHashSet.has(chunk.chunk_hash)) {
        chunksToKeep.push({
          index: chunk.chunk_index,
          hash: chunk.chunk_hash,
        });
      } else {
        chunksToDownload.push({
          index: chunk.chunk_index,
          hash: chunk.chunk_hash,
          size: chunk.chunk_size,
        });
      }
    }

    const totalBytesToDownload = chunksToDownload.reduce((sum, c) => sum + c.size, 0);

    log.info({
      event: 'sync.delta_computed',
      fileId,
      totalChunks: serverChunks.rows.length,
      chunksToDownload: chunksToDownload.length,
      bytesToDownload: totalBytesToDownload,
    });

    res.json({
      fileId,
      totalChunks: serverChunks.rows.length,
      chunksToDownload,
      chunksToKeep,
      bytesToDownload: totalBytesToDownload,
    });
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Delta sync error');
    res.status(500).json({ error: 'Failed to compute delta' });
  }
});

// Download a specific chunk
router.get('/chunk/:chunkHash', async (req: Request<{ chunkHash: string }>, res: Response): Promise<void> => {
  const log: Logger = req.log || logger;
  try {
    const { chunkHash } = req.params;
    const userId = req.user!.id;

    // Verify user has access to this chunk
    const access = await pool.query<{ storage_key: string }>(
      `SELECT fc.storage_key
       FROM file_chunks fc
       JOIN files f ON fc.file_id = f.id
       WHERE fc.chunk_hash = $1 AND f.user_id = $2
       LIMIT 1`,
      [chunkHash, userId]
    );

    if (access.rows.length === 0) {
      res.status(404).json({ error: 'Chunk not found' });
      return;
    }

    // Get chunk from service
    const { ChunkService } = await import('../services/chunks.js');
    const chunkService = new ChunkService();
    const chunkData = await chunkService.downloadChunk(chunkHash);

    // Track download metrics
    bytesDownloaded.inc(chunkData.length);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', chunkData.length);
    res.setHeader('X-Chunk-Hash', chunkHash);
    res.send(chunkData);
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Download chunk error');
    res.status(500).json({ error: 'Failed to download chunk' });
  }
});

export default router;
