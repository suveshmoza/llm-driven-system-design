/**
 * File and folder management service.
 * Handles file uploads with chunking and deduplication, folder operations,
 * file versioning, and storage hierarchy navigation.
 *
 * Features:
 * - Chunked uploads with deduplication
 * - File versioning with restore capability
 * - Prometheus metrics for all operations
 * - Structured logging for observability
 *
 * WHY sync metrics enable client optimization:
 * - Clients can measure actual sync latency vs. perceived latency
 * - Server-side metrics reveal bottlenecks in the sync pipeline
 * - Deduplication metrics inform storage efficiency decisions
 * - Upload/download metrics help tune chunk sizes and parallelism
 *
 * @module services/file
 */

// Upload operations
export { createUploadSession, uploadFileChunk, completeUpload } from './upload.js';

// Download operations
export { downloadFile, getFileChunks } from './download.js';

// Metadata operations
export {
  getFile,
  createFolder,
  getFolderContents,
  renameItem,
  moveItem,
  deleteItem,
} from './metadata.js';

// Versioning operations
export { getFileVersions, restoreFileVersion } from './versioning.js';
