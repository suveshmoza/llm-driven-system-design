import { Router, Request, Response } from 'express';
import { pool } from '../db.js';
import { ChunkService } from '../services/chunks.js';
import { getConnectedDevices } from '../services/websocket.js';

const router = Router();
const chunkService = new ChunkService();

interface ListUsersQuery {
  limit?: string;
  offset?: string;
  search?: string;
}

interface SyncOperationsQuery {
  limit?: string;
  status?: string;
  userId?: string;
}

interface ConflictsQuery {
  limit?: string;
}

interface UpdateUserBody {
  role?: string;
  storageQuota?: number;
}

interface PurgeDeletedBody {
  olderThanDays?: number;
}

interface UserStatsRow {
  total_users: string;
  new_users_24h: string;
  total_storage_used: string | null;
  total_storage_quota: string | null;
}

interface FileStatsRow {
  total_files: string;
  total_folders: string;
  total_file_size: string | null;
  deleted_files: string;
}

interface PhotoStatsRow {
  total_photos: string;
  favorite_photos: string;
  deleted_photos: string;
}

interface DeviceStatsRow {
  total_devices: string;
  active_24h: string;
  active_7d: string;
}

interface SyncStatsRow {
  total_operations: string;
  completed: string;
  failed: string;
  conflicts: string;
}

interface ChunkStatsRow {
  total_chunks: string;
  total_chunk_storage: string | null;
  dedup_savings: string | null;
}

interface UserRow {
  id: string;
  email: string;
  role: string;
  storage_quota: number;
  storage_used: number;
  created_at: Date;
  updated_at: Date;
}

interface DeviceRow {
  id: string;
  name: string;
  device_type: string;
  last_sync_at: Date | null;
  created_at: Date;
}

interface SyncOperationRow {
  id: string;
  user_id: string;
  user_email: string;
  device_id: string | null;
  device_name: string | null;
  file_id: string | null;
  file_name: string | null;
  file_path: string | null;
  operation_type: string;
  status: string;
  operation_data: Record<string, unknown> | null;
  created_at: Date;
  completed_at: Date | null;
}

interface ConflictRow {
  id: string;
  file_id: string;
  file_name: string;
  file_path: string;
  user_id: string;
  user_email: string;
  device_name: string | null;
  version_number: number;
  content_hash: string;
  created_at: Date;
}

// Get system stats
router.get('/stats', async (_req: Request, res: Response): Promise<void> => {
  try {
    // User stats
    const userStats = await pool.query<UserStatsRow>(`
      SELECT
        COUNT(*) as total_users,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as new_users_24h,
        SUM(storage_used) as total_storage_used,
        SUM(storage_quota) as total_storage_quota
      FROM users
    `);

    // File stats
    const fileStats = await pool.query<FileStatsRow>(`
      SELECT
        COUNT(*) as total_files,
        COUNT(CASE WHEN is_folder = TRUE THEN 1 END) as total_folders,
        SUM(size) as total_file_size,
        COUNT(CASE WHEN is_deleted = TRUE THEN 1 END) as deleted_files
      FROM files
    `);

    // Photo stats
    const photoStats = await pool.query<PhotoStatsRow>(`
      SELECT
        COUNT(*) as total_photos,
        COUNT(CASE WHEN is_favorite = TRUE THEN 1 END) as favorite_photos,
        COUNT(CASE WHEN is_deleted = TRUE THEN 1 END) as deleted_photos
      FROM photos
    `);

    // Device stats
    const deviceStats = await pool.query<DeviceStatsRow>(`
      SELECT
        COUNT(*) as total_devices,
        COUNT(CASE WHEN last_sync_at > NOW() - INTERVAL '24 hours' THEN 1 END) as active_24h,
        COUNT(CASE WHEN last_sync_at > NOW() - INTERVAL '7 days' THEN 1 END) as active_7d
      FROM devices
    `);

    // Sync operation stats
    const syncStats = await pool.query<SyncStatsRow>(`
      SELECT
        COUNT(*) as total_operations,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        COUNT(CASE WHEN operation_type = 'conflict' THEN 1 END) as conflicts
      FROM sync_operations
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);

    // Chunk deduplication stats
    const chunkStats = await pool.query<ChunkStatsRow>(`
      SELECT
        COUNT(*) as total_chunks,
        SUM(chunk_size) as total_chunk_storage,
        SUM(CASE WHEN reference_count > 1 THEN (reference_count - 1) * chunk_size ELSE 0 END) as dedup_savings
      FROM chunk_store
    `);

    res.json({
      users: {
        total: parseInt(userStats.rows[0].total_users),
        new24h: parseInt(userStats.rows[0].new_users_24h),
        storageUsed: parseInt(userStats.rows[0].total_storage_used || '0'),
        storageQuota: parseInt(userStats.rows[0].total_storage_quota || '0'),
      },
      files: {
        total: parseInt(fileStats.rows[0].total_files),
        folders: parseInt(fileStats.rows[0].total_folders),
        totalSize: parseInt(fileStats.rows[0].total_file_size || '0'),
        deleted: parseInt(fileStats.rows[0].deleted_files),
      },
      photos: {
        total: parseInt(photoStats.rows[0].total_photos),
        favorites: parseInt(photoStats.rows[0].favorite_photos),
        deleted: parseInt(photoStats.rows[0].deleted_photos),
      },
      devices: {
        total: parseInt(deviceStats.rows[0].total_devices),
        active24h: parseInt(deviceStats.rows[0].active_24h),
        active7d: parseInt(deviceStats.rows[0].active_7d),
      },
      sync: {
        operations24h: parseInt(syncStats.rows[0].total_operations),
        completed: parseInt(syncStats.rows[0].completed),
        failed: parseInt(syncStats.rows[0].failed),
        conflicts: parseInt(syncStats.rows[0].conflicts),
      },
      chunks: {
        total: parseInt(chunkStats.rows[0].total_chunks || '0'),
        storageUsed: parseInt(chunkStats.rows[0].total_chunk_storage || '0'),
        dedupSavings: parseInt(chunkStats.rows[0].dedup_savings || '0'),
      },
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// List all users
router.get('/users', async (req: Request<object, unknown, unknown, ListUsersQuery>, res: Response): Promise<void> => {
  try {
    const { limit = '50', offset = '0', search } = req.query;

    let query = `
      SELECT id, email, role, storage_quota, storage_used, created_at, updated_at
      FROM users
    `;
    const params: (string | number)[] = [];

    if (search) {
      query += ' WHERE email ILIKE $1';
      params.push(`%${search}%`);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get device counts
    const userIds = result.rows.map((u: UserRow) => u.id);
    const deviceCounts = await pool.query<{ user_id: string; count: string }>(
      `SELECT user_id, COUNT(*) as count FROM devices WHERE user_id = ANY($1) GROUP BY user_id`,
      [userIds]
    );
    const deviceMap = new Map(deviceCounts.rows.map(d => [d.user_id, parseInt(d.count)]));

    res.json({
      users: result.rows.map((u: UserRow) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        storageQuota: u.storage_quota,
        storageUsed: u.storage_used,
        deviceCount: deviceMap.get(u.id) || 0,
        createdAt: u.created_at,
        updatedAt: u.updated_at,
      })),
    });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// Get user details
router.get('/users/:userId', async (req: Request<{ userId: string }>, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    const user = await pool.query(
      `SELECT id, email, role, storage_quota, storage_used, created_at, updated_at
       FROM users WHERE id = $1`,
      [userId]
    );

    if (user.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const devices = await pool.query(
      `SELECT id, name, device_type, last_sync_at, created_at
       FROM devices WHERE user_id = $1`,
      [userId]
    );

    const fileStats = await pool.query<{ file_count: string; total_size: string | null }>(
      `SELECT COUNT(*) as file_count, SUM(size) as total_size
       FROM files WHERE user_id = $1 AND is_deleted = FALSE`,
      [userId]
    );

    const photoStats = await pool.query<{ photo_count: string }>(
      `SELECT COUNT(*) as photo_count
       FROM photos WHERE user_id = $1 AND is_deleted = FALSE`,
      [userId]
    );

    const u: UserRow = user.rows[0];

    res.json({
      id: u.id,
      email: u.email,
      role: u.role,
      storageQuota: u.storage_quota,
      storageUsed: u.storage_used,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
      devices: devices.rows.map((d: DeviceRow) => ({
        id: d.id,
        name: d.name,
        deviceType: d.device_type,
        lastSyncAt: d.last_sync_at,
        createdAt: d.created_at,
        isConnected: getConnectedDevices(userId).includes(d.id),
      })),
      stats: {
        fileCount: parseInt(fileStats.rows[0].file_count),
        totalFileSize: parseInt(fileStats.rows[0].total_size || '0'),
        photoCount: parseInt(photoStats.rows[0].photo_count),
      },
    });
  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json({ error: 'Failed to get user details' });
  }
});

// Update user
router.patch('/users/:userId', async (req: Request<{ userId: string }, unknown, UpdateUserBody>, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { role, storageQuota } = req.body;

    const updates: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (role) {
      updates.push(`role = $${paramIndex++}`);
      params.push(role);
    }

    if (storageQuota !== undefined) {
      updates.push(`storage_quota = $${paramIndex++}`);
      params.push(storageQuota);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No updates provided' });
      return;
    }

    updates.push(`updated_at = NOW()`);
    params.push(userId);

    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, email, role, storage_quota`,
      params
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Get recent sync operations
router.get('/sync-operations', async (req: Request<object, unknown, unknown, SyncOperationsQuery>, res: Response): Promise<void> => {
  try {
    const { limit = '100', status, userId } = req.query;

    let query = `
      SELECT so.*, u.email as user_email, d.name as device_name, f.name as file_name, f.path as file_path
      FROM sync_operations so
      JOIN users u ON so.user_id = u.id
      LEFT JOIN devices d ON so.device_id = d.id
      LEFT JOIN files f ON so.file_id = f.id
    `;
    const params: (string | number)[] = [];
    const conditions: string[] = [];

    if (status) {
      conditions.push(`so.status = $${params.length + 1}`);
      params.push(status);
    }

    if (userId) {
      conditions.push(`so.user_id = $${params.length + 1}`);
      params.push(userId);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ` ORDER BY so.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);

    res.json({
      operations: result.rows.map((op: SyncOperationRow) => ({
        id: op.id,
        userId: op.user_id,
        userEmail: op.user_email,
        deviceId: op.device_id,
        deviceName: op.device_name,
        fileId: op.file_id,
        fileName: op.file_name,
        filePath: op.file_path,
        operationType: op.operation_type,
        status: op.status,
        operationData: op.operation_data,
        createdAt: op.created_at,
        completedAt: op.completed_at,
      })),
    });
  } catch (error) {
    console.error('Get sync operations error:', error);
    res.status(500).json({ error: 'Failed to get sync operations' });
  }
});

// Get unresolved conflicts
router.get('/conflicts', async (req: Request<object, unknown, unknown, ConflictsQuery>, res: Response): Promise<void> => {
  try {
    const { limit = '50' } = req.query;

    const result = await pool.query(
      `SELECT fv.*, f.name as file_name, f.path as file_path, u.email as user_email, d.name as device_name
       FROM file_versions fv
       JOIN files f ON fv.file_id = f.id
       JOIN users u ON f.user_id = u.id
       LEFT JOIN devices d ON fv.created_by = d.id
       WHERE fv.is_conflict = TRUE AND fv.conflict_resolved = FALSE
       ORDER BY fv.created_at DESC
       LIMIT $1`,
      [parseInt(limit)]
    );

    res.json({
      conflicts: result.rows.map((c: ConflictRow) => ({
        id: c.id,
        fileId: c.file_id,
        fileName: c.file_name,
        filePath: c.file_path,
        userId: c.user_id,
        userEmail: c.user_email,
        deviceName: c.device_name,
        versionNumber: c.version_number,
        contentHash: c.content_hash,
        createdAt: c.created_at,
      })),
    });
  } catch (error) {
    console.error('Get conflicts error:', error);
    res.status(500).json({ error: 'Failed to get conflicts' });
  }
});

// Cleanup orphaned chunks
router.post('/cleanup-chunks', async (_req: Request, res: Response): Promise<void> => {
  try {
    const cleaned = await chunkService.cleanupOrphanedChunks();

    res.json({
      message: 'Cleanup complete',
      chunksRemoved: cleaned,
    });
  } catch (error) {
    console.error('Cleanup chunks error:', error);
    res.status(500).json({ error: 'Failed to cleanup chunks' });
  }
});

// Permanently delete soft-deleted files older than X days
router.post('/purge-deleted', async (req: Request<object, unknown, PurgeDeletedBody>, res: Response): Promise<void> => {
  try {
    const { olderThanDays = 30 } = req.body;

    // Get files to purge
    const toDelete = await pool.query<{ id: string }>(
      `SELECT id FROM files WHERE is_deleted = TRUE AND modified_at < NOW() - INTERVAL '1 day' * $1`,
      [olderThanDays]
    );

    // Decrease chunk reference counts
    for (const file of toDelete.rows) {
      await pool.query(
        `UPDATE chunk_store cs
         SET reference_count = reference_count - 1
         FROM file_chunks fc
         WHERE fc.chunk_hash = cs.chunk_hash AND fc.file_id = $1`,
        [file.id]
      );
    }

    // Delete file records
    const result = await pool.query(
      `DELETE FROM files WHERE is_deleted = TRUE AND modified_at < NOW() - INTERVAL '1 day' * $1`,
      [olderThanDays]
    );

    // Cleanup orphaned chunks
    const chunksRemoved = await chunkService.cleanupOrphanedChunks();

    res.json({
      message: 'Purge complete',
      filesDeleted: result.rowCount,
      chunksRemoved,
    });
  } catch (error) {
    console.error('Purge deleted error:', error);
    res.status(500).json({ error: 'Failed to purge deleted files' });
  }
});

export default router;
