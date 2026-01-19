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
