/**
 * File download operations.
 *
 * Features:
 * - Reassemble files from chunks
 * - Download metrics and logging
 *
 * @module services/file/download
 */

import {
  query,
  FileItem,
  FileChunk,
  downloadChunk as storageDownloadChunk,
  logger,
  logFileOperation,
  fileDownloadsTotal,
  fileOperationsTotal,
} from './types.js';
import { getFile } from './metadata.js';

/**
 * Retrieves the ordered list of chunks that make up a file.
 *
 * @description Queries the database for all chunks associated with a file,
 * returning them in the correct order for reassembly.
 *
 * @param {string} fileId - The ID of the file to get chunks for
 * @returns {Promise<FileChunk[]>} Array of chunk metadata ordered by chunk index
 */
export async function getFileChunks(fileId: string): Promise<FileChunk[]> {
  return query<FileChunk>(
    `SELECT id, file_id as "fileId", chunk_index as "chunkIndex",
            chunk_hash as "chunkHash", chunk_size as "chunkSize", created_at as "createdAt"
     FROM file_chunks WHERE file_id = $1 ORDER BY chunk_index`,
    [fileId]
  );
}

/**
 * Downloads a complete file by reassembling its chunks.
 * Retrieves each chunk from object storage and concatenates them.
 *
 * @description Fetches a file's metadata and all associated chunks from
 * MinIO storage, then concatenates them into a single buffer. Tracks
 * download metrics and logs the operation.
 *
 * @param {string} userId - The ID of the user requesting the download
 * @param {string} fileId - The ID of the file to download
 * @returns {Promise<{ data: Buffer; file: FileItem }>} Object containing
 *   the file data as a buffer and the file metadata
 * @throws {Error} If file is not found or if the item is a folder
 */
export async function downloadFile(
  userId: string,
  fileId: string
): Promise<{ data: Buffer; file: FileItem }> {
  const startTime = Date.now();
  const file = await getFile(userId, fileId);

  if (!file || file.isFolder) {
    throw new Error('File not found');
  }

  const chunks = await getFileChunks(fileId);
  const chunkBuffers: Buffer[] = [];

  for (const chunk of chunks) {
    const data = await storageDownloadChunk(chunk.chunkHash);
    chunkBuffers.push(data);
  }

  const data = Buffer.concat(chunkBuffers);

  // Update metrics
  fileDownloadsTotal.labels('direct').inc();
  fileOperationsTotal.labels('download', 'success').inc();

  logFileOperation(
    {
      fileId,
      fileName: file.name,
      fileSize: file.size,
      userId,
      operation: 'download',
    },
    'File downloaded'
  );

  logger.info(
    {
      fileId,
      fileName: file.name,
      fileSize: data.length,
      chunks: chunks.length,
      durationMs: Date.now() - startTime,
    },
    'File download completed'
  );

  return { data, file };
}
