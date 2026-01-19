/**
 * Redis-based caching for metadata
 *
 * WHY: Caching reduces database load and improves response times for frequently
 * accessed data. We use cache-aside pattern for read-heavy metadata (file info,
 * user storage) and write-through for critical sync state to maintain consistency.
 *
 * TTLs are configured per data type based on update frequency and staleness tolerance.
 */

import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { cacheHits, cacheMisses } from './metrics.js';
import logger from './logger.js';

// TTL configuration in seconds
export const TTL = {
  FILE_METADATA: 3600,        // 1 hour - files change infrequently
  USER_STORAGE: 300,          // 5 minutes - storage changes on upload/delete
  SYNC_STATE: 86400,          // 24 hours - device sync cursors
  CHUNK_EXISTS: 3600,         // 1 hour - chunk existence for dedup
  DEVICE_LIST: 900,           // 15 minutes - device registration
  IDEMPOTENCY: 86400,         // 24 hours - idempotency keys
} as const;

export interface FileMetadata {
  id: string;
  name: string;
  path: string;
  mime_type: string | null;
  size: number;
  content_hash: string | null;
  version_vector: Record<string, number> | null;
  is_folder: boolean;
  is_deleted: boolean;
  created_at: Date;
  modified_at: Date;
}

export interface StorageInfo {
  storage_quota: number;
  storage_used: number;
}

export interface SyncData {
  cursor?: unknown;
  lastSyncAt?: string;
}

/**
 * Cache-aside pattern implementation
 * Used for read-heavy data where stale reads are acceptable
 */
export class CacheAside {
  protected redis: Redis;
  protected cacheType: string;

  constructor(redis: Redis, cacheType: string = 'general') {
    this.redis = redis;
    this.cacheType = cacheType;
  }

  /**
   * Get value from cache, falling back to getter function on miss
   */
  async get<T>(key: string, getter: () => Promise<T>, ttl: number): Promise<T> {
    try {
      // Try cache first
      const cached = await this.redis.get(key);
      if (cached !== null) {
        cacheHits.inc({ cache_type: this.cacheType });
        return JSON.parse(cached) as T;
      }

      cacheMisses.inc({ cache_type: this.cacheType });

      // Cache miss - fetch from source
      const value = await getter();

      // Populate cache if value exists
      if (value !== null && value !== undefined) {
        await this.redis.setex(key, ttl, JSON.stringify(value));
      }

      return value;
    } catch (error) {
      logger.error({ error, key }, 'Cache get error, falling back to getter');
      // On cache error, still try to get from source
      return await getter();
    }
  }

  /**
   * Invalidate a cache key
   */
  async invalidate(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      logger.error({ error, key }, 'Cache invalidate error');
    }
  }

  /**
   * Invalidate multiple keys matching a pattern
   */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [newCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100
        );
        cursor = newCursor;

        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error) {
      logger.error({ error, pattern }, 'Cache pattern invalidation error');
    }
  }
}

/**
 * File metadata cache
 */
export class FileMetadataCache extends CacheAside {
  private pool: Pool;

  constructor(redis: Redis, pool: Pool) {
    super(redis, 'file_metadata');
    this.pool = pool;
  }

  /**
   * Get file metadata by ID
   */
  async getFileById(fileId: string, userId: string): Promise<FileMetadata | null> {
    const key = `file:meta:${fileId}`;
    return this.get<FileMetadata | null>(
      key,
      async () => {
        const result = await this.pool.query(
          `SELECT id, name, path, mime_type, size, content_hash, version_vector,
                  is_folder, is_deleted, created_at, modified_at
           FROM files
           WHERE id = $1 AND user_id = $2`,
          [fileId, userId]
        );
        return result.rows[0] || null;
      },
      TTL.FILE_METADATA
    );
  }

  /**
   * Invalidate file cache on update
   */
  async onFileUpdated(fileId: string, userId: string): Promise<void> {
    await Promise.all([
      this.invalidate(`file:meta:${fileId}`),
      this.invalidate(`user:storage:${userId}`),
    ]);
  }
}

/**
 * User storage quota cache
 */
export class StorageQuotaCache extends CacheAside {
  private pool: Pool;

  constructor(redis: Redis, pool: Pool) {
    super(redis, 'storage_quota');
    this.pool = pool;
  }

  /**
   * Get user's storage usage and quota
   */
  async getUserStorage(userId: string): Promise<StorageInfo | null> {
    const key = `user:storage:${userId}`;
    return this.get<StorageInfo | null>(
      key,
      async () => {
        const result = await this.pool.query(
          `SELECT storage_quota, storage_used FROM users WHERE id = $1`,
          [userId]
        );
        return result.rows[0] || null;
      },
      TTL.USER_STORAGE
    );
  }

  /**
   * Update storage used and invalidate cache
   */
  async updateStorageUsed(userId: string, bytesChange: number): Promise<void> {
    await this.pool.query(
      `UPDATE users SET storage_used = storage_used + $1 WHERE id = $2`,
      [bytesChange, userId]
    );
    await this.invalidate(`user:storage:${userId}`);
  }
}

/**
 * Chunk existence cache for deduplication
 */
export class ChunkExistsCache extends CacheAside {
  constructor(redis: Redis) {
    super(redis, 'chunk_exists');
  }

  /**
   * Check if a chunk hash exists in storage
   * Returns true if chunk exists, false otherwise
   */
  async checkExists(chunkHash: string, checkFn: (hash: string) => Promise<boolean>): Promise<boolean> {
    const key = `chunk:exists:${chunkHash}`;
    const exists = await this.get<number>(
      key,
      async () => {
        const result = await checkFn(chunkHash);
        return result ? 1 : 0;
      },
      TTL.CHUNK_EXISTS
    );
    return exists === 1;
  }

  /**
   * Mark chunk as existing in cache
   */
  async setExists(chunkHash: string): Promise<void> {
    await this.redis.setex(`chunk:exists:${chunkHash}`, TTL.CHUNK_EXISTS, '1');
  }
}

/**
 * Sync state cache (write-through pattern)
 * Used for critical sync state that must remain consistent
 */
export class SyncStateCache {
  private redis: Redis;
  private pool: Pool;

  constructor(redis: Redis, pool: Pool) {
    this.redis = redis;
    this.pool = pool;
  }

  /**
   * Update sync state with write-through to both cache and DB
   */
  async updateSyncState(deviceId: string, userId: string, syncData: SyncData): Promise<SyncData & { lastSyncAt: string }> {
    const key = `sync:state:${deviceId}:${userId}`;
    const data = {
      ...syncData,
      lastSyncAt: new Date().toISOString(),
    };

    // Write to both cache and database atomically
    await Promise.all([
      this.redis.setex(key, TTL.SYNC_STATE, JSON.stringify(data)),
      this.pool.query(
        `UPDATE devices
         SET last_sync_at = NOW(), sync_cursor = $1
         WHERE id = $2 AND user_id = $3`,
        [JSON.stringify(syncData.cursor), deviceId, userId]
      ),
    ]);

    return data;
  }

  /**
   * Get sync state, checking cache first
   */
  async getSyncState(deviceId: string, userId: string): Promise<SyncData | null> {
    const key = `sync:state:${deviceId}:${userId}`;

    const cached = await this.redis.get(key);
    if (cached) {
      cacheHits.inc({ cache_type: 'sync_state' });
      return JSON.parse(cached) as SyncData;
    }

    cacheMisses.inc({ cache_type: 'sync_state' });

    const result = await this.pool.query(
      `SELECT last_sync_at, sync_cursor FROM devices
       WHERE id = $1 AND user_id = $2`,
      [deviceId, userId]
    );

    if (result.rows[0]) {
      const data: SyncData = {
        lastSyncAt: result.rows[0].last_sync_at,
        cursor: result.rows[0].sync_cursor,
      };
      await this.redis.setex(key, TTL.SYNC_STATE, JSON.stringify(data));
      return data;
    }

    return null;
  }
}

export interface Caches {
  fileMetadata: FileMetadataCache;
  storageQuota: StorageQuotaCache;
  chunkExists: ChunkExistsCache;
  syncState: SyncStateCache;
  general: CacheAside;
}

/**
 * Factory function to create all cache instances
 */
export function createCaches(redis: Redis, pool: Pool): Caches {
  return {
    fileMetadata: new FileMetadataCache(redis, pool),
    storageQuota: new StorageQuotaCache(redis, pool),
    chunkExists: new ChunkExistsCache(redis),
    syncState: new SyncStateCache(redis, pool),
    general: new CacheAside(redis, 'general'),
  };
}

export default {
  TTL,
  CacheAside,
  FileMetadataCache,
  StorageQuotaCache,
  ChunkExistsCache,
  SyncStateCache,
  createCaches,
};
