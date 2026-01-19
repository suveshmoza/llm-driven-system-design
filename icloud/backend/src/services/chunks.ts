import crypto from 'crypto';
import { pool, minioClient } from '../db.js';
import logger from '../shared/logger.js';
import { chunkOperationDuration, dedupHitsTotal, bytesUploaded, startTimer } from '../shared/metrics.js';
import { StorageCircuitBreakers, StorageHealth } from '../shared/circuitBreaker.js';

const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks
const CHUNKS_BUCKET = 'icloud-chunks';

// Create storage circuit breakers for resilient storage operations
const storageBreakers = new StorageCircuitBreakers(minioClient);

interface ChunkInfo {
  chunkIndex: number;
  chunkHash: string;
  chunkSize: number;
  storageKey: string;
}

interface ChunkRow {
  chunk_hash: string;
  storage_key: string;
}

interface FileChunkRow {
  chunk_index: number;
  chunk_hash: string;
  chunk_size: number;
  storage_key: string;
}

interface DeltaChunkResult {
  missingChunks: {
    chunkIndex: number;
    chunkHash: string;
    chunkSize: number;
    storageKey: string;
  }[];
  existingChunks: {
    chunkIndex: number;
    chunkHash: string;
  }[];
}

export class ChunkService {
  private chunkSize: number;

  constructor(chunkSize: number = CHUNK_SIZE) {
    this.chunkSize = chunkSize;
  }

  /**
   * Store a file by splitting it into content-addressed chunks
   * Returns array of chunk metadata
   *
   * Uses circuit breaker to protect against MinIO failures
   */
  async storeFile(fileId: string, fileBuffer: Buffer): Promise<ChunkInfo[]> {
    const chunks: ChunkInfo[] = [];
    const totalChunks = Math.ceil(fileBuffer.length / this.chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const timer = startTimer(chunkOperationDuration, { operation: 'upload' });

      const start = i * this.chunkSize;
      const end = Math.min(start + this.chunkSize, fileBuffer.length);
      const chunkData = fileBuffer.slice(start, end);

      // Calculate SHA-256 hash of chunk
      const chunkHash = crypto.createHash('sha256').update(chunkData).digest('hex');
      const storageKey = `chunks/${chunkHash.slice(0, 2)}/${chunkHash}`;

      // Check if chunk already exists (deduplication)
      const existingChunk = await pool.query<ChunkRow>(
        'SELECT chunk_hash FROM chunk_store WHERE chunk_hash = $1',
        [chunkHash]
      );

      if (existingChunk.rows.length === 0) {
        // Upload chunk to MinIO using circuit breaker
        try {
          await storageBreakers.putObject(
            CHUNKS_BUCKET,
            storageKey,
            chunkData,
            chunkData.length,
            { 'Content-Type': 'application/octet-stream' }
          );

          // Track bytes uploaded
          bytesUploaded.inc(chunkData.length);

          // Add to chunk store
          await pool.query(
            `INSERT INTO chunk_store (chunk_hash, storage_key, chunk_size)
             VALUES ($1, $2, $3)`,
            [chunkHash, storageKey, chunkData.length]
          );

          logger.debug({
            event: 'chunk.uploaded',
            chunkHash: chunkHash.slice(0, 16),
            size: chunkData.length,
          });
        } catch (error) {
          timer.end();
          logger.error({
            error: (error as Error).message,
            chunkHash: chunkHash.slice(0, 16),
          }, 'Failed to upload chunk');
          throw error;
        }
      } else {
        // Increment reference count for existing chunk (deduplication hit)
        await pool.query(
          'UPDATE chunk_store SET reference_count = reference_count + 1 WHERE chunk_hash = $1',
          [chunkHash]
        );

        // Track deduplication hit
        dedupHitsTotal.inc();

        logger.debug({
          event: 'chunk.deduplicated',
          chunkHash: chunkHash.slice(0, 16),
        });
      }

      // Link chunk to file
      await pool.query(
        `INSERT INTO file_chunks (file_id, chunk_index, chunk_hash, chunk_size, storage_key)
         VALUES ($1, $2, $3, $4, $5)`,
        [fileId, i, chunkHash, chunkData.length, storageKey]
      );

      timer.end();

      chunks.push({
        chunkIndex: i,
        chunkHash,
        chunkSize: chunkData.length,
        storageKey,
      });
    }

    logger.info({
      event: 'file.chunked',
      fileId,
      totalChunks,
      totalSize: fileBuffer.length,
    });

    return chunks;
  }

  /**
   * Assemble a file from its chunks
   * Uses circuit breaker for resilient downloads
   */
  async assembleFile(chunks: { chunk_hash: string; storage_key: string }[]): Promise<Buffer> {
    const buffers: Buffer[] = [];

    for (const chunk of chunks) {
      const timer = startTimer(chunkOperationDuration, { operation: 'download' });

      try {
        const dataStream = await storageBreakers.getObject(CHUNKS_BUCKET, chunk.storage_key);

        // Collect stream data
        const chunkBuffers: Buffer[] = [];
        for await (const data of dataStream) {
          chunkBuffers.push(data as Buffer);
        }

        const chunkBuffer = Buffer.concat(chunkBuffers);

        // Verify chunk integrity
        const actualHash = crypto.createHash('sha256').update(chunkBuffer).digest('hex');
        if (actualHash !== chunk.chunk_hash) {
          throw new Error(`Chunk integrity check failed for ${chunk.chunk_hash}`);
        }

        buffers.push(chunkBuffer);
        timer.end();
      } catch (error) {
        timer.end();
        logger.error({
          error: (error as Error).message,
          chunkHash: chunk.chunk_hash?.slice(0, 16),
        }, 'Failed to download chunk');
        throw error;
      }
    }

    return Buffer.concat(buffers);
  }

  /**
   * Get chunks that differ between local and server versions
   * Used for delta sync
   */
  async getDeltaChunks(fileId: string, localChunkHashes: string[]): Promise<DeltaChunkResult> {
    const serverChunks = await pool.query<FileChunkRow>(
      `SELECT chunk_index, chunk_hash, chunk_size, storage_key
       FROM file_chunks
       WHERE file_id = $1
       ORDER BY chunk_index`,
      [fileId]
    );

    const localHashSet = new Set(localChunkHashes);
    const missingChunks: DeltaChunkResult['missingChunks'] = [];
    const existingChunks: DeltaChunkResult['existingChunks'] = [];

    for (const chunk of serverChunks.rows) {
      if (localHashSet.has(chunk.chunk_hash)) {
        existingChunks.push({
          chunkIndex: chunk.chunk_index,
          chunkHash: chunk.chunk_hash,
        });
      } else {
        missingChunks.push({
          chunkIndex: chunk.chunk_index,
          chunkHash: chunk.chunk_hash,
          chunkSize: chunk.chunk_size,
          storageKey: chunk.storage_key,
        });
      }
    }

    return { missingChunks, existingChunks };
  }

  /**
   * Download a specific chunk
   * Uses circuit breaker for resilient downloads
   */
  async downloadChunk(chunkHash: string): Promise<Buffer> {
    const timer = startTimer(chunkOperationDuration, { operation: 'download_single' });

    const chunkInfo = await pool.query<{ storage_key: string }>(
      'SELECT storage_key FROM chunk_store WHERE chunk_hash = $1',
      [chunkHash]
    );

    if (chunkInfo.rows.length === 0) {
      timer.end();
      throw new Error(`Chunk not found: ${chunkHash}`);
    }

    try {
      const dataStream = await storageBreakers.getObject(
        CHUNKS_BUCKET,
        chunkInfo.rows[0].storage_key
      );

      const buffers: Buffer[] = [];
      for await (const data of dataStream) {
        buffers.push(data as Buffer);
      }

      timer.end();
      return Buffer.concat(buffers);
    } catch (error) {
      timer.end();
      logger.error({
        error: (error as Error).message,
        chunkHash: chunkHash.slice(0, 16),
      }, 'Failed to download chunk via circuit breaker');
      throw error;
    }
  }

  /**
   * Delete chunks that are no longer referenced
   * Uses circuit breaker for resilient deletes
   */
  async cleanupOrphanedChunks(): Promise<number> {
    // Find chunks with zero references
    const orphanedChunks = await pool.query<ChunkRow>(
      'SELECT chunk_hash, storage_key FROM chunk_store WHERE reference_count <= 0'
    );

    let cleanedCount = 0;

    for (const chunk of orphanedChunks.rows) {
      try {
        await storageBreakers.removeObject(CHUNKS_BUCKET, chunk.storage_key);
        await pool.query('DELETE FROM chunk_store WHERE chunk_hash = $1', [chunk.chunk_hash]);
        cleanedCount++;

        logger.debug({
          event: 'chunk.cleaned',
          chunkHash: chunk.chunk_hash.slice(0, 16),
        });
      } catch (error) {
        logger.error({
          error: (error as Error).message,
          chunkHash: chunk.chunk_hash.slice(0, 16),
        }, 'Failed to cleanup chunk');
      }
    }

    logger.info({
      event: 'cleanup.completed',
      orphanedChunks: orphanedChunks.rows.length,
      cleanedChunks: cleanedCount,
    });

    return cleanedCount;
  }

  /**
   * Get storage circuit breaker health status
   */
  getStorageHealth(): StorageHealth {
    return storageBreakers.getHealth();
  }
}
