import { pool } from '../db.js';

type VersionVector = Record<string, number>;

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

interface ServerFile {
  id: string;
  version_vector: VersionVector | null;
  content_hash: string | null;
  is_deleted: boolean;
}

interface ApplyChangeResult {
  applied?: boolean;
  conflict?: boolean;
  conflictType?: string;
  serverVersion?: VersionVector;
  localVersion?: VersionVector;
  versionVector?: VersionVector;
  reason?: string;
  file?: {
    id: string;
    name?: string;
    path?: string;
    versionVector?: VersionVector;
    modifiedAt?: Date;
    deleted?: boolean;
  };
}

interface FileRow {
  id: string;
  name: string;
  path: string;
  version_vector: VersionVector;
}

export class SyncService {
  /**
   * Compare two version vectors
   * Returns: 'local-newer', 'server-newer', 'equal', or 'conflict'
   */
  compareVersions(localVersion: VersionVector | null | undefined, serverVersion: VersionVector | null | undefined): 'local-newer' | 'server-newer' | 'equal' | 'conflict' {
    let localNewer = false;
    let serverNewer = false;

    const allDevices = new Set([
      ...Object.keys(localVersion || {}),
      ...Object.keys(serverVersion || {}),
    ]);

    for (const device of allDevices) {
      const localSeq = (localVersion || {})[device] || 0;
      const serverSeq = (serverVersion || {})[device] || 0;

      if (localSeq > serverSeq) localNewer = true;
      if (serverSeq > localSeq) serverNewer = true;
    }

    if (localNewer && serverNewer) return 'conflict';
    if (localNewer) return 'local-newer';
    if (serverNewer) return 'server-newer';
    return 'equal';
  }

  /**
   * Merge version vectors (take max of each component)
   */
  mergeVersions(v1: VersionVector | null | undefined, v2: VersionVector | null | undefined): VersionVector {
    const merged: VersionVector = { ...(v1 || {}) };

    for (const [device, seq] of Object.entries(v2 || {})) {
      merged[device] = Math.max(merged[device] || 0, seq);
    }

    return merged;
  }

  /**
   * Apply a change from a device
   */
  async applyChange(userId: string, deviceId: string | undefined, change: SyncChange): Promise<ApplyChangeResult> {
    const { fileId, operation } = change;

    // Get current server state
    const serverFile = await pool.query<ServerFile>(
      `SELECT id, version_vector, content_hash, is_deleted
       FROM files WHERE id = $1 AND user_id = $2`,
      [fileId, userId]
    );

    // Handle different operations
    switch (operation) {
      case 'create':
        return this.handleCreate(userId, deviceId, change);

      case 'update':
        if (serverFile.rows.length === 0) {
          // File doesn't exist, treat as create
          return this.handleCreate(userId, deviceId, change);
        }
        return this.handleUpdate(userId, deviceId, serverFile.rows[0], change);

      case 'delete':
        if (serverFile.rows.length === 0) {
          // Already deleted or doesn't exist
          return { applied: true, versionVector: {}, file: { id: fileId, deleted: true } };
        }
        return this.handleDelete(userId, deviceId, serverFile.rows[0], change);

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  /**
   * Handle file creation
   */
  async handleCreate(userId: string, deviceId: string | undefined, change: SyncChange): Promise<ApplyChangeResult> {
    const { path, name, contentHash, mimeType, size } = change;

    // Check if file already exists at path
    const existing = await pool.query<{ id: string; version_vector: VersionVector }>(
      `SELECT id, version_vector FROM files
       WHERE user_id = $1 AND path = $2 AND is_deleted = FALSE`,
      [userId, path]
    );

    if (existing.rows.length > 0) {
      // File exists, this is actually an update
      return this.handleUpdate(userId, deviceId, existing.rows[0] as ServerFile, change);
    }

    // Create version vector
    const versionVector: VersionVector = deviceId ? { [deviceId]: 1 } : {};

    const result = await pool.query<{ id: string; name: string; path: string; version_vector: VersionVector; modified_at: Date }>(
      `INSERT INTO files (user_id, name, path, mime_type, size, content_hash,
                          version_vector, last_modified_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, path, version_vector, modified_at`,
      [userId, name, path, mimeType, size || 0, contentHash,
       JSON.stringify(versionVector), deviceId]
    );

    const file = result.rows[0];

    // Create initial version record
    await pool.query(
      `INSERT INTO file_versions (file_id, version_number, content_hash, version_vector, created_by)
       VALUES ($1, 1, $2, $3, $4)`,
      [file.id, contentHash, JSON.stringify(versionVector), deviceId]
    );

    return {
      applied: true,
      versionVector,
      file: {
        id: file.id,
        name: file.name,
        path: file.path,
        versionVector,
        modifiedAt: file.modified_at,
      },
    };
  }

  /**
   * Handle file update with conflict detection
   */
  async handleUpdate(_userId: string, deviceId: string | undefined, serverFile: ServerFile, change: SyncChange): Promise<ApplyChangeResult> {
    const { fileId, contentHash, versionVector: localVersion, size, mimeType } = change;
    const serverVersion = serverFile.version_vector || {};

    // Compare versions
    const comparison = this.compareVersions(localVersion, serverVersion);

    if (comparison === 'conflict') {
      // Create conflict version
      const versionNumber = await this.getNextVersionNumber(fileId);

      await pool.query(
        `INSERT INTO file_versions (file_id, version_number, content_hash, version_vector, created_by, is_conflict)
         VALUES ($1, $2, $3, $4, $5, TRUE)`,
        [fileId, versionNumber, contentHash, JSON.stringify(localVersion), deviceId]
      );

      return {
        conflict: true,
        conflictType: 'concurrent-edit',
        serverVersion,
        localVersion,
        file: { id: fileId },
      };
    }

    if (comparison === 'server-newer' || comparison === 'equal') {
      // No update needed
      return {
        applied: false,
        reason: 'server-has-newer-or-equal',
        versionVector: serverVersion,
      };
    }

    // Local is newer, apply update
    const mergedVersion = this.mergeVersions(localVersion, serverVersion);
    if (deviceId) {
      mergedVersion[deviceId] = (mergedVersion[deviceId] || 0) + 1;
    }

    await pool.query(
      `UPDATE files
       SET content_hash = $1, size = $2, mime_type = $3,
           version_vector = $4, modified_at = NOW(), last_modified_by = $5
       WHERE id = $6`,
      [contentHash, size, mimeType, JSON.stringify(mergedVersion), deviceId, fileId]
    );

    // Record version
    const versionNumber = await this.getNextVersionNumber(fileId);
    await pool.query(
      `INSERT INTO file_versions (file_id, version_number, content_hash, version_vector, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [fileId, versionNumber, contentHash, JSON.stringify(mergedVersion), deviceId]
    );

    return {
      applied: true,
      versionVector: mergedVersion,
      file: {
        id: fileId,
        versionVector: mergedVersion,
      },
    };
  }

  /**
   * Handle file deletion
   */
  async handleDelete(_userId: string, deviceId: string | undefined, serverFile: ServerFile, change: SyncChange): Promise<ApplyChangeResult> {
    const { fileId, versionVector: localVersion } = change;
    const serverVersion = serverFile.version_vector || {};

    // Check for conflicts
    const comparison = this.compareVersions(localVersion, serverVersion);

    if (comparison === 'conflict') {
      // Someone else modified the file - this is a delete conflict
      return {
        conflict: true,
        conflictType: 'delete-conflict',
        serverVersion,
        file: { id: fileId },
      };
    }

    // Perform soft delete
    const mergedVersion = this.mergeVersions(localVersion, serverVersion);
    if (deviceId) {
      mergedVersion[deviceId] = (mergedVersion[deviceId] || 0) + 1;
    }

    await pool.query(
      `UPDATE files
       SET is_deleted = TRUE, version_vector = $1, modified_at = NOW(), last_modified_by = $2
       WHERE id = $3`,
      [JSON.stringify(mergedVersion), deviceId, fileId]
    );

    return {
      applied: true,
      versionVector: mergedVersion,
      file: { id: fileId, deleted: true },
    };
  }

  /**
   * Resolve a conflict
   */
  async resolveConflict(
    userId: string,
    deviceId: string | undefined,
    fileId: string,
    resolution: string,
    keepBoth?: boolean
  ): Promise<{ resolved: boolean; fileId: string }> {
    const file = await pool.query<FileRow>(
      `SELECT id, name, path, version_vector FROM files
       WHERE id = $1 AND user_id = $2`,
      [fileId, userId]
    );

    if (file.rows.length === 0) {
      throw new Error('File not found');
    }

    const currentFile = file.rows[0];

    if (keepBoth) {
      // Create conflict copy
      const conflictPath = this.generateConflictPath(currentFile.path, deviceId || 'unknown');

      await pool.query(
        `INSERT INTO files (user_id, name, path, mime_type, size, content_hash, version_vector, last_modified_by)
         SELECT user_id, $1, $2, mime_type, size, content_hash, version_vector, $3
         FROM files WHERE id = $4`,
        [
          this.generateConflictName(currentFile.name, deviceId || 'unknown'),
          conflictPath,
          deviceId,
          fileId,
        ]
      );
    }

    // Mark conflict as resolved
    if (resolution === 'use-local') {
      // Client will upload the local version
      const newVersion: VersionVector = { ...currentFile.version_vector };
      if (deviceId) {
        newVersion[deviceId] = (newVersion[deviceId] || 0) + 1;
      }

      await pool.query(
        `UPDATE files SET version_vector = $1, modified_at = NOW() WHERE id = $2`,
        [JSON.stringify(newVersion), fileId]
      );
    }

    // Mark all conflict versions as resolved
    await pool.query(
      `UPDATE file_versions
       SET conflict_resolved = TRUE
       WHERE file_id = $1 AND is_conflict = TRUE`,
      [fileId]
    );

    return { resolved: true, fileId };
  }

  /**
   * Get next version number for a file
   */
  async getNextVersionNumber(fileId: string): Promise<number> {
    const result = await pool.query<{ next: number }>(
      `SELECT COALESCE(MAX(version_number), 0) + 1 as next
       FROM file_versions WHERE file_id = $1`,
      [fileId]
    );
    return result.rows[0].next;
  }

  /**
   * Generate conflict file name
   */
  generateConflictName(originalName: string, deviceId: string): string {
    const ext = originalName.includes('.')
      ? '.' + originalName.split('.').pop()
      : '';
    const base = ext
      ? originalName.slice(0, -(ext.length))
      : originalName;

    const timestamp = new Date().toISOString().split('T')[0];
    const shortDeviceId = deviceId.slice(0, 8);

    return `${base} (conflict ${timestamp} ${shortDeviceId})${ext}`;
  }

  /**
   * Generate conflict file path
   */
  generateConflictPath(originalPath: string, deviceId: string): string {
    const parts = originalPath.split('/');
    const name = parts.pop() || '';
    const conflictName = this.generateConflictName(name, deviceId);
    return [...parts, conflictName].join('/');
  }
}
