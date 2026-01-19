/**
 * File upload operations including chunked uploads and deduplication.
 *
 * Features:
 * - Chunked uploads with deduplication
 * - Upload session management
 * - Reference counting for shared chunks
 *
 * @module services/file/upload
 */

import {
  query,
  queryOne,
  transaction,
  FileItem,
  UploadSession,
  uploadChunk as storageUploadChunk,
  chunkExists,
  calculateHash,
  calculateContentHash,
  CHUNK_SIZE,
  getMimeType,
  publishSync,
  deleteCache,
  logger,
  logFileOperation,
  uploadSessionsTotal,
  uploadSessionsActive,
  fileOperationsTotal,
  syncEventsTotal,
  storageUsedBytes,
  uuidv4,
} from './types.js';

/**
 * Creates a new upload session for chunked file uploads.
 * Checks which chunks already exist in storage for deduplication,
 * allowing clients to skip uploading duplicate chunks.
 *
 * @description Initializes a new upload session and determines which chunks
 * need to be uploaded based on existing chunk hashes in the database.
 * This enables deduplication by identifying chunks that already exist.
 *
 * @param {string} userId - The ID of the user initiating the upload
 * @param {string} fileName - The name of the file being uploaded
 * @param {number} fileSize - The total size of the file in bytes
 * @param {string | null} parentId - The ID of the parent folder, or null for root
 * @param {string[]} chunkHashes - Array of SHA-256 hashes for each chunk of the file
 * @returns {Promise<{ uploadSessionId: string; chunksNeeded: string[]; totalChunks: number }>}
 *   Object containing the session ID, list of chunk hashes that need to be uploaded,
 *   and total number of chunks
 * @throws {Error} If database operations fail
 */
export async function createUploadSession(
  userId: string,
  fileName: string,
  fileSize: number,
  parentId: string | null,
  chunkHashes: string[]
): Promise<{ uploadSessionId: string; chunksNeeded: string[]; totalChunks: number }> {
  const startTime = Date.now();

  try {
    // Check which chunks already exist (deduplication)
    const existingChunks = await query<{ hash: string }>(
      `SELECT hash FROM chunks WHERE hash = ANY($1)`,
      [chunkHashes]
    );

    const existingHashes = new Set(existingChunks.map((c) => c.hash));
    const chunksNeeded = chunkHashes.filter((h) => !existingHashes.has(h));

    // Create upload session
    const sessionId = uuidv4();
    await query(
      `INSERT INTO upload_sessions (id, user_id, file_name, file_size, parent_id, total_chunks, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [sessionId, userId, fileName, fileSize, parentId, chunkHashes.length]
    );

    // Update metrics
    uploadSessionsTotal.labels('created').inc();
    uploadSessionsActive.inc();

    logger.info(
      {
        userId,
        uploadSessionId: sessionId,
        fileName,
        fileSize,
        totalChunks: chunkHashes.length,
        chunksNeeded: chunksNeeded.length,
        chunksDeduped: existingHashes.size,
        durationMs: Date.now() - startTime,
      },
      'Upload session created'
    );

    return {
      uploadSessionId: sessionId,
      chunksNeeded,
      totalChunks: chunkHashes.length,
    };
  } catch (error) {
    uploadSessionsTotal.labels('failed').inc();
    logger.error(
      { userId, fileName, error: (error as Error).message },
      'Failed to create upload session'
    );
    throw error;
  }
}

/**
 * Uploads a single chunk of a file.
 * Verifies the chunk hash matches the data for integrity.
 * Increments reference count for existing chunks (deduplication).
 *
 * @description Handles the upload of an individual file chunk, performing
 * hash verification for data integrity and managing reference counting
 * for chunk deduplication.
 *
 * @param {string} userId - The ID of the user uploading the chunk
 * @param {string} uploadSessionId - The ID of the upload session this chunk belongs to
 * @param {number} chunkIndex - The zero-based index of this chunk within the file
 * @param {string} chunkHash - The expected SHA-256 hash of the chunk data
 * @param {Buffer} data - The raw chunk data to upload
 * @returns {Promise<{ uploaded: boolean }>} Object indicating upload success
 * @throws {Error} If upload session is not found
 * @throws {Error} If chunk hash does not match the provided data (integrity failure)
 */
export async function uploadFileChunk(
  userId: string,
  uploadSessionId: string,
  chunkIndex: number,
  chunkHash: string,
  data: Buffer
): Promise<{ uploaded: boolean }> {
  const startTime = Date.now();

  // Verify upload session
  const session = await queryOne<UploadSession>(
    `SELECT * FROM upload_sessions WHERE id = $1 AND user_id = $2`,
    [uploadSessionId, userId]
  );

  if (!session) {
    throw new Error('Upload session not found');
  }

  // Calculate hash and verify
  const actualHash = calculateHash(data);
  if (actualHash !== chunkHash) {
    logger.warn(
      { uploadSessionId, chunkIndex, expectedHash: chunkHash, actualHash },
      'Chunk hash mismatch'
    );
    throw new Error('Chunk hash mismatch');
  }

  // Check if chunk already exists in storage
  const exists = await chunkExists(chunkHash);

  if (!exists) {
    // Upload to MinIO
    const storageKey = await storageUploadChunk(chunkHash, data);

    // Add to chunks table
    await query(
      `INSERT INTO chunks (hash, size, storage_key, reference_count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (hash) DO UPDATE SET reference_count = chunks.reference_count + 1`,
      [chunkHash, data.length, storageKey]
    );
  } else {
    // Increment reference count
    await query(`UPDATE chunks SET reference_count = reference_count + 1 WHERE hash = $1`, [
      chunkHash,
    ]);
  }

  // Update upload session
  await query(
    `UPDATE upload_sessions
     SET uploaded_chunks = uploaded_chunks + 1, status = 'uploading'
     WHERE id = $1`,
    [uploadSessionId]
  );

  logger.debug(
    {
      uploadSessionId,
      chunkIndex,
      chunkHash,
      chunkSize: data.length,
      deduplicated: exists,
      durationMs: Date.now() - startTime,
    },
    'Chunk uploaded'
  );

  return { uploaded: true };
}

/**
 * Completes an upload session and creates or updates the file record.
 * Handles versioning by saving current file state before updating.
 * Updates user storage quota and notifies connected clients.
 *
 * @description Finalizes a chunked upload by creating the file record,
 * linking all uploaded chunks, and handling version history for existing files.
 * Also updates the user's storage quota and publishes sync events.
 *
 * @param {string} userId - The ID of the user completing the upload
 * @param {string} uploadSessionId - The ID of the upload session to complete
 * @param {string[]} chunkHashes - Ordered array of chunk hashes that make up the file
 * @returns {Promise<FileItem>} The created or updated file metadata
 * @throws {Error} If upload session is not found
 * @throws {Error} If chunk count does not match the expected total
 */
export async function completeUpload(
  userId: string,
  uploadSessionId: string,
  chunkHashes: string[]
): Promise<FileItem> {
  const startTime = Date.now();

  const session = await queryOne<{
    id: string;
    user_id: string;
    file_name: string;
    file_size: number;
    parent_id: string | null;
    total_chunks: number;
  }>(
    `SELECT id, user_id, file_name, file_size, parent_id, total_chunks
     FROM upload_sessions WHERE id = $1 AND user_id = $2`,
    [uploadSessionId, userId]
  );

  if (!session) {
    throw new Error('Upload session not found');
  }

  if (chunkHashes.length !== session.total_chunks) {
    throw new Error('Chunk count mismatch');
  }

  const contentHash = calculateContentHash(chunkHashes);
  const mimeType = getMimeType(session.file_name);

  const file = await transaction(async (client) => {
    // Check if file already exists (update vs create)
    const existing = await client.query(
      `SELECT id, version FROM files
       WHERE user_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND name = $3 AND deleted_at IS NULL`,
      [userId, session.parent_id, session.file_name]
    );

    let fileId: string;
    let version: number;
    let isUpdate = false;

    if (existing.rows.length > 0) {
      // Update existing file - create new version
      fileId = existing.rows[0].id;
      version = existing.rows[0].version + 1;
      isUpdate = true;

      // Save current version to history
      const oldChunks = await client.query(
        `SELECT chunk_hash FROM file_chunks WHERE file_id = $1 ORDER BY chunk_index`,
        [fileId]
      );

      const versionResult = await client.query(
        `INSERT INTO file_versions (file_id, version, size, content_hash, created_by)
         VALUES ($1, $2, (SELECT size FROM files WHERE id = $1),
                 (SELECT content_hash FROM files WHERE id = $1), $3)
         RETURNING id`,
        [fileId, existing.rows[0].version, userId]
      );

      // Copy chunks to version
      for (let i = 0; i < oldChunks.rows.length; i++) {
        await client.query(
          `INSERT INTO file_version_chunks (version_id, chunk_index, chunk_hash, chunk_size)
           SELECT $1, chunk_index, chunk_hash, chunk_size FROM file_chunks
           WHERE file_id = $2 AND chunk_index = $3`,
          [versionResult.rows[0].id, fileId, i]
        );
      }

      // Delete old file chunks
      await client.query(`DELETE FROM file_chunks WHERE file_id = $1`, [fileId]);

      // Update file
      await client.query(
        `UPDATE files SET size = $1, content_hash = $2, version = $3,
                          mime_type = $4, updated_at = NOW(), sync_status = 'synced'
         WHERE id = $5`,
        [session.file_size, contentHash, version, mimeType, fileId]
      );
    } else {
      // Create new file
      version = 1;
      const result = await client.query(
        `INSERT INTO files (user_id, parent_id, name, is_folder, size, mime_type, content_hash, version, sync_status)
         VALUES ($1, $2, $3, false, $4, $5, $6, $7, 'synced')
         RETURNING id`,
        [
          userId,
          session.parent_id,
          session.file_name,
          session.file_size,
          mimeType,
          contentHash,
          version,
        ]
      );
      fileId = result.rows[0].id;
    }

    // Insert file chunks
    for (let i = 0; i < chunkHashes.length; i++) {
      const chunk = await client.query(`SELECT size FROM chunks WHERE hash = $1`, [chunkHashes[i]]);

      await client.query(
        `INSERT INTO file_chunks (file_id, chunk_index, chunk_hash, chunk_size)
         VALUES ($1, $2, $3, $4)`,
        [fileId, i, chunkHashes[i], chunk.rows[0]?.size || CHUNK_SIZE]
      );
    }

    // Update user storage usage
    await client.query(`UPDATE users SET used_bytes = used_bytes + $1 WHERE id = $2`, [
      session.file_size,
      userId,
    ]);

    // Mark upload session as completed
    await client.query(`UPDATE upload_sessions SET status = 'completed', file_id = $1 WHERE id = $2`, [
      fileId,
      uploadSessionId,
    ]);

    // Get the created/updated file
    const fileResult = await client.query(
      `SELECT id, user_id as "userId", parent_id as "parentId", name, is_folder as "isFolder",
              size, mime_type as "mimeType", content_hash as "contentHash", version,
              sync_status as "syncStatus", created_at as "createdAt", updated_at as "updatedAt"
       FROM files WHERE id = $1`,
      [fileId]
    );

    return { file: fileResult.rows[0] as FileItem, isUpdate };
  });

  // Update metrics
  uploadSessionsTotal.labels('completed').inc();
  uploadSessionsActive.dec();
  fileOperationsTotal.labels('upload', 'success').inc();
  storageUsedBytes.inc(session.file_size);

  // Notify other clients
  const eventType = file.isUpdate ? 'file_updated' : 'file_created';
  await publishSync(userId, { type: eventType, file: file.file });
  syncEventsTotal.labels(eventType).inc();
  await deleteCache(`folder:${userId}:${session.parent_id || 'root'}`);

  logFileOperation(
    {
      fileId: file.file.id,
      fileName: session.file_name,
      fileSize: session.file_size,
      userId,
      operation: 'upload',
    },
    `File ${file.isUpdate ? 'updated' : 'created'} successfully`
  );

  logger.info(
    {
      fileId: file.file.id,
      fileName: session.file_name,
      fileSize: session.file_size,
      version: file.file.version,
      isUpdate: file.isUpdate,
      durationMs: Date.now() - startTime,
    },
    'Upload completed'
  );

  return file.file;
}
