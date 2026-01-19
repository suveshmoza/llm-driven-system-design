import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';

const router = Router();

interface RegisterDeviceBody {
  name: string;
  deviceType?: string;
}

interface UpdateDeviceBody {
  name?: string;
  deviceType?: string;
}

interface SyncHistoryQuery {
  limit?: string;
}

interface DeviceRow {
  id: string;
  name: string;
  device_type: string;
  last_sync_at: Date | null;
  sync_cursor: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

interface SyncOperationRow {
  id: string;
  operation_type: string;
  status: string;
  created_at: Date;
  completed_at: Date | null;
  file_name: string | null;
  file_path: string | null;
}

// Get all devices for user
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    const result = await pool.query(
      `SELECT id, name, device_type, last_sync_at, sync_cursor, created_at, updated_at
       FROM devices
       WHERE user_id = $1
       ORDER BY last_sync_at DESC NULLS LAST`,
      [userId]
    );

    res.json({
      devices: result.rows.map((d: DeviceRow) => ({
        id: d.id,
        name: d.name,
        deviceType: d.device_type,
        lastSyncAt: d.last_sync_at,
        syncCursor: d.sync_cursor,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      })),
    });
  } catch (error) {
    console.error('List devices error:', error);
    res.status(500).json({ error: 'Failed to list devices' });
  }
});

// Register a new device
router.post('/', async (req: Request<object, unknown, RegisterDeviceBody>, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { name, deviceType } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Device name is required' });
      return;
    }

    // Check if device with same name exists
    const existing = await pool.query(
      `SELECT id FROM devices WHERE user_id = $1 AND name = $2`,
      [userId, name]
    );

    if (existing.rows.length > 0) {
      res.status(409).json({
        error: 'Device with this name already exists',
        deviceId: existing.rows[0].id,
      });
      return;
    }

    const result = await pool.query(
      `INSERT INTO devices (user_id, name, device_type)
       VALUES ($1, $2, $3)
       RETURNING id, name, device_type, created_at`,
      [userId, name, deviceType || 'web']
    );

    const device = result.rows[0];

    res.status(201).json({
      id: device.id,
      name: device.name,
      deviceType: device.device_type,
      createdAt: device.created_at,
    });
  } catch (error) {
    console.error('Register device error:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

// Get device details
router.get('/:deviceId', async (req: Request<{ deviceId: string }>, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { deviceId } = req.params;

    const result = await pool.query(
      `SELECT id, name, device_type, last_sync_at, sync_cursor, created_at, updated_at
       FROM devices
       WHERE id = $1 AND user_id = $2`,
      [deviceId, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    const device: DeviceRow = result.rows[0];

    res.json({
      id: device.id,
      name: device.name,
      deviceType: device.device_type,
      lastSyncAt: device.last_sync_at,
      syncCursor: device.sync_cursor,
      createdAt: device.created_at,
      updatedAt: device.updated_at,
    });
  } catch (error) {
    console.error('Get device error:', error);
    res.status(500).json({ error: 'Failed to get device' });
  }
});

// Update device
router.patch('/:deviceId', async (req: Request<{ deviceId: string }, unknown, UpdateDeviceBody>, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { deviceId } = req.params;
    const { name, deviceType } = req.body;

    const updates: string[] = [];
    const params: string[] = [];
    let paramIndex = 1;

    if (name) {
      updates.push(`name = $${paramIndex++}`);
      params.push(name);
    }

    if (deviceType) {
      updates.push(`device_type = $${paramIndex++}`);
      params.push(deviceType);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No updates provided' });
      return;
    }

    updates.push(`updated_at = NOW()`);
    params.push(deviceId, userId);

    const result = await pool.query(
      `UPDATE devices SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND user_id = $${paramIndex}
       RETURNING id, name, device_type, updated_at`,
      params
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    const device = result.rows[0];

    res.json({
      id: device.id,
      name: device.name,
      deviceType: device.device_type,
      updatedAt: device.updated_at,
    });
  } catch (error) {
    console.error('Update device error:', error);
    res.status(500).json({ error: 'Failed to update device' });
  }
});

// Delete device
router.delete('/:deviceId', async (req: Request<{ deviceId: string }>, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { deviceId } = req.params;

    // Don't allow deleting current device
    if (req.deviceId === deviceId) {
      res.status(400).json({ error: 'Cannot delete current device' });
      return;
    }

    const result = await pool.query(
      `DELETE FROM devices WHERE id = $1 AND user_id = $2 RETURNING id`,
      [deviceId, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    res.json({ message: 'Device deleted', id: deviceId });
  } catch (error) {
    console.error('Delete device error:', error);
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

// Get device sync history
router.get('/:deviceId/sync-history', async (req: Request<{ deviceId: string }, unknown, unknown, SyncHistoryQuery>, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { deviceId } = req.params;
    const { limit = '50' } = req.query;

    const result = await pool.query(
      `SELECT so.id, so.operation_type, so.status, so.created_at, so.completed_at,
              f.name as file_name, f.path as file_path
       FROM sync_operations so
       LEFT JOIN files f ON so.file_id = f.id
       WHERE so.user_id = $1 AND so.device_id = $2
       ORDER BY so.created_at DESC
       LIMIT $3`,
      [userId, deviceId, parseInt(limit)]
    );

    res.json({
      deviceId,
      operations: result.rows.map((op: SyncOperationRow) => ({
        id: op.id,
        operationType: op.operation_type,
        status: op.status,
        fileName: op.file_name,
        filePath: op.file_path,
        createdAt: op.created_at,
        completedAt: op.completed_at,
      })),
    });
  } catch (error) {
    console.error('Get sync history error:', error);
    res.status(500).json({ error: 'Failed to get sync history' });
  }
});

export default router;
