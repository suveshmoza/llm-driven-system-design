/**
 * Shared types and imports for the file service modules.
 * Centralizes common dependencies to avoid circular imports.
 *
 * @module services/file/types
 */

/**
 * @description Core type definitions for file operations
 * @see {@link ../../types/index.js} for full type definitions
 */
export { FileItem, FileChunk, Chunk, UploadSession, FileVersion } from '../../types/index.js';

/**
 * @description Database utility functions for PostgreSQL operations
 * @see {@link ../../utils/database.js}
 */
export { query, queryOne, transaction } from '../../utils/database.js';

/**
 * @description MinIO storage utility functions for chunk operations
 * @see {@link ../../utils/storage.js}
 */
export { uploadChunk, chunkExists, downloadChunk, BUCKET_NAME } from '../../utils/storage.js';

/**
 * @description Chunking utility functions for file hashing and splitting
 * @see {@link ../../utils/chunking.js}
 */
export { calculateHash, calculateContentHash, CHUNK_SIZE, getMimeType } from '../../utils/chunking.js';

/**
 * @description Redis utility functions for pub/sub and caching
 * @see {@link ../../utils/redis.js}
 */
export { publishSync, deleteCache } from '../../utils/redis.js';

/**
 * @description Structured logging utilities
 * @see {@link ../../shared/logger.js}
 */
export { logger, logFileOperation } from '../../shared/logger.js';

/**
 * @description Prometheus metrics for monitoring file operations
 * @see {@link ../../shared/metrics.js}
 */
export {
  uploadSessionsTotal,
  uploadSessionsActive,
  fileOperationsTotal,
  folderOperationsTotal,
  fileDownloadsTotal,
  syncEventsTotal,
  storageUsedBytes,
} from '../../shared/metrics.js';

/**
 * @description UUID v4 generator for creating unique identifiers
 */
export { v4 as uuidv4 } from 'uuid';
