/**
 * Shared types and imports for the file service modules.
 * Centralizes common dependencies to avoid circular imports.
 *
 * @module services/file/types
 */

// Re-export types from main types module
export { FileItem, FileChunk, Chunk, UploadSession, FileVersion } from '../../types/index.js';

// Re-export database utilities
export { query, queryOne, transaction } from '../../utils/database.js';

// Re-export storage utilities
export { uploadChunk, chunkExists, downloadChunk, BUCKET_NAME } from '../../utils/storage.js';

// Re-export chunking utilities
export { calculateHash, calculateContentHash, CHUNK_SIZE, getMimeType } from '../../utils/chunking.js';

// Re-export Redis utilities
export { publishSync, deleteCache } from '../../utils/redis.js';

// Re-export logger
export { logger, logFileOperation } from '../../shared/logger.js';

// Re-export metrics
export {
  uploadSessionsTotal,
  uploadSessionsActive,
  fileOperationsTotal,
  folderOperationsTotal,
  fileDownloadsTotal,
  syncEventsTotal,
  storageUsedBytes,
} from '../../shared/metrics.js';

// Re-export uuid
export { v4 as uuidv4 } from 'uuid';
