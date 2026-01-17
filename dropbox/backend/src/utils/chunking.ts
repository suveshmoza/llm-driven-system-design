/**
 * File chunking and hashing utilities for the deduplication system.
 * Files are split into fixed-size chunks that are hashed for content-addressing.
 * This enables efficient storage through deduplication and resumable uploads.
 * @module utils/chunking
 */

import crypto from 'crypto';

/**
 * Default chunk size in bytes (4MB).
 * Configurable via CHUNK_SIZE environment variable.
 * 4MB balances deduplication efficiency with upload reliability.
 */
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || '4194304', 10);

export { CHUNK_SIZE };

/**
 * Calculates the SHA-256 hash of a data buffer.
 * Used for content-addressing chunks and verifying upload integrity.
 * @param data - Buffer to hash
 * @returns Hex-encoded SHA-256 hash string
 */
export function calculateHash(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Calculates a content hash from an ordered list of chunk hashes.
 * This provides a unique identifier for a file based on its content.
 * @param chunkHashes - Array of chunk hash strings in order
 * @returns Hex-encoded SHA-256 hash representing the complete file content
 */
export function calculateContentHash(chunkHashes: string[]): string {
  const combined = chunkHashes.join('');
  return crypto.createHash('sha256').update(combined).digest('hex');
}

/**
 * Splits a buffer into fixed-size chunks.
 * Used for breaking large files into manageable pieces for upload and storage.
 * @param data - Buffer to split
 * @param chunkSize - Size of each chunk in bytes (defaults to CHUNK_SIZE)
 * @returns Array of Buffer chunks
 */
export function splitIntoChunks(data: Buffer, chunkSize: number = CHUNK_SIZE): Buffer[] {
  const chunks: Buffer[] = [];
  let offset = 0;

  while (offset < data.length) {
    const end = Math.min(offset + chunkSize, data.length);
    chunks.push(data.subarray(offset, end));
    offset = end;
  }

  return chunks;
}

/**
 * Calculates the number of chunks needed to store a file.
 * @param fileSize - Total file size in bytes
 * @param chunkSize - Size of each chunk (defaults to CHUNK_SIZE)
 * @returns Number of chunks required
 */
export function calculateChunkCount(fileSize: number, chunkSize: number = CHUNK_SIZE): number {
  return Math.ceil(fileSize / chunkSize);
}

/**
 * Generates a cryptographically secure random token.
 * Used for session tokens and shared link URLs.
 * @param length - Desired token length in characters (default 32)
 * @returns Random hex string token
 */
export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex').substring(0, length);
}

/**
 * Determines the MIME type based on file extension.
 * Used for setting Content-Type headers on downloads and file previews.
 * @param filename - Name of the file including extension
 * @returns MIME type string, or 'application/octet-stream' for unknown types
 */
export function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';

  const mimeTypes: Record<string, string> = {
    // Documents
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    rtf: 'application/rtf',

    // Images
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',

    // Audio
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',

    // Video
    mp4: 'video/mp4',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',

    // Archives
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    tar: 'application/x-tar',
    gz: 'application/gzip',

    // Code
    js: 'application/javascript',
    ts: 'application/typescript',
    json: 'application/json',
    html: 'text/html',
    css: 'text/css',
    xml: 'application/xml',

    // Other
    md: 'text/markdown',
    csv: 'text/csv',
  };

  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Formats a byte count into a human-readable string.
 * @param bytes - Number of bytes
 * @returns Formatted string like "1.5 MB" or "256 KB"
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
