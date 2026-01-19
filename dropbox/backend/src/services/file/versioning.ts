/**
 * File versioning operations.
 *
 * Features:
 * - Version history retrieval
 * - Version restoration
 * - Storage usage tracking for versions
 *
 * @module services/file/versioning
 */

import {
  query,
  queryOne,
  transaction,
  FileItem,
  FileVersion,
  calculateContentHash,
  logFileOperation,
  fileOperationsTotal,
  storageUsedBytes,
} from './types.js';
import { getFile } from './metadata.js';

/**
 * Retrieves version history for a file.
 */
export async function getFileVersions(userId: string, fileId: string): Promise<FileVersion[]> {
  const file = await getFile(userId, fileId);

  if (!file) {
    throw new Error('File not found');
  }

  return query<FileVersion>(
    `SELECT id, file_id as "fileId", version, size, content_hash as "contentHash",
            created_at as "createdAt", created_by as "createdBy"
     FROM file_versions WHERE file_id = $1 ORDER BY version DESC`,
    [fileId]
  );
}

/**
 * Restores a file to a previous version.
 * Saves the current version to history before restoring.
 * Updates user's storage usage based on size difference.
 */
export async function restoreFileVersion(
  userId: string,
  fileId: string,
  versionId: string
): Promise<FileItem> {
  const file = await getFile(userId, fileId);

  if (!file) {
    throw new Error('File not found');
  }

  const version = await queryOne<FileVersion>(
    `SELECT * FROM file_versions WHERE id = $1 AND file_id = $2`,
    [versionId, fileId]
  );

  if (!version) {
    throw new Error('Version not found');
  }

  const restoredFile = await transaction(async (client) => {
    // Get version chunks
    const versionChunks = await client.query(
      `SELECT chunk_index, chunk_hash, chunk_size FROM file_version_chunks
       WHERE version_id = $1 ORDER BY chunk_index`,
      [versionId]
    );

    // Save current version
    const currentVersion = file.version + 1;

    const newVersionResult = await client.query(
      `INSERT INTO file_versions (file_id, version, size, content_hash, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [fileId, file.version, file.size, file.contentHash, userId]
    );

    // Copy current chunks to version
    await client.query(
      `INSERT INTO file_version_chunks (version_id, chunk_index, chunk_hash, chunk_size)
       SELECT $1, chunk_index, chunk_hash, chunk_size FROM file_chunks WHERE file_id = $2`,
      [newVersionResult.rows[0].id, fileId]
    );

    // Clear current chunks
    await client.query(`DELETE FROM file_chunks WHERE file_id = $1`, [fileId]);

    // Restore version chunks
    for (const chunk of versionChunks.rows) {
      await client.query(
        `INSERT INTO file_chunks (file_id, chunk_index, chunk_hash, chunk_size)
         VALUES ($1, $2, $3, $4)`,
        [fileId, chunk.chunk_index, chunk.chunk_hash, chunk.chunk_size]
      );
    }

    // Update file
    const chunkHashes = versionChunks.rows.map((c: { chunk_hash: string }) => c.chunk_hash);
    const contentHash = calculateContentHash(chunkHashes);

    await client.query(
      `UPDATE files SET size = $1, content_hash = $2, version = $3, updated_at = NOW()
       WHERE id = $4`,
      [version.size, contentHash, currentVersion, fileId]
    );

    // Update user storage
    const sizeDiff = version.size - file.size;
    await client.query(`UPDATE users SET used_bytes = used_bytes + $1 WHERE id = $2`, [
      sizeDiff,
      userId,
    ]);

    if (sizeDiff > 0) {
      storageUsedBytes.inc(sizeDiff);
    } else {
      storageUsedBytes.dec(Math.abs(sizeDiff));
    }

    // Get updated file
    const result = await client.query(
      `SELECT id, user_id as "userId", parent_id as "parentId", name, is_folder as "isFolder",
              size, mime_type as "mimeType", content_hash as "contentHash", version,
              sync_status as "syncStatus", created_at as "createdAt", updated_at as "updatedAt"
       FROM files WHERE id = $1`,
      [fileId]
    );

    return result.rows[0] as FileItem;
  });

  // Update metrics
  fileOperationsTotal.labels('restore', 'success').inc();

  logFileOperation(
    {
      fileId,
      fileName: file.name,
      userId,
      operation: 'version',
    },
    `File restored to version ${version.version}`
  );

  return restoredFile;
}
