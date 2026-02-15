import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';
import { deleteObject } from '../services/storageService.js';

const router = Router();

// GET /api/videos - List user's videos with pagination
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search as string;
    const folderId = req.query.folderId as string;

    let query: string;
    let countQuery: string;
    const params: (string | number)[] = [userId!];

    if (folderId) {
      query = `SELECT v.* FROM videos v
               JOIN video_folders vf ON vf.video_id = v.id
               WHERE v.user_id = $1 AND vf.folder_id = $2`;
      countQuery = `SELECT COUNT(*) FROM videos v
                    JOIN video_folders vf ON vf.video_id = v.id
                    WHERE v.user_id = $1 AND vf.folder_id = $2`;
      params.push(folderId);
    } else {
      query = 'SELECT * FROM videos WHERE user_id = $1';
      countQuery = 'SELECT COUNT(*) FROM videos WHERE user_id = $1';
    }

    if (search) {
      const searchParam = `%${search}%`;
      query += ` AND (title ILIKE $${params.length + 1} OR description ILIKE $${params.length + 1})`;
      countQuery += ` AND (title ILIKE $${params.length + 1} OR description ILIKE $${params.length + 1})`;
      params.push(searchParam);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const [videosResult, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, params.slice(0, -2)),
    ]);

    res.json({
      videos: videosResult.rows.map(mapVideoRow),
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to list videos');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/videos/:id - Get single video
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT v.*, u.username, u.display_name, u.avatar_url
       FROM videos v
       JOIN users u ON u.id = v.user_id
       WHERE v.id = $1`,
      [req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const row = result.rows[0];
    res.json({
      video: {
        ...mapVideoRow(row),
        author: {
          username: row.username,
          displayName: row.display_name,
          avatarUrl: row.avatar_url,
        },
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get video');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/videos - Create video metadata
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { title, description } = req.body;
    const userId = req.session.userId;

    if (!title) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO videos (user_id, title, description, status)
       VALUES ($1, $2, $3, 'processing')
       RETURNING *`,
      [userId, title, description || null],
    );

    res.status(201).json({ video: mapVideoRow(result.rows[0]) });
  } catch (err) {
    logger.error({ err }, 'Failed to create video');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/videos/:id - Update video
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { title, description } = req.body;
    const userId = req.session.userId;

    // Verify ownership
    const existing = await pool.query(
      'SELECT id FROM videos WHERE id = $1 AND user_id = $2',
      [req.params.id, userId],
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const result = await pool.query(
      `UPDATE videos SET title = COALESCE($1, title), description = COALESCE($2, description), updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [title, description, req.params.id],
    );

    res.json({ video: mapVideoRow(result.rows[0]) });
  } catch (err) {
    logger.error({ err }, 'Failed to update video');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/videos/:id - Delete video
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId;

    const existing = await pool.query(
      'SELECT id, storage_path, thumbnail_path FROM videos WHERE id = $1 AND user_id = $2',
      [req.params.id, userId],
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const video = existing.rows[0];

    // Delete from storage
    if (video.storage_path) {
      try {
        await deleteObject(video.storage_path);
      } catch (storageErr) {
        logger.warn({ storageErr, path: video.storage_path }, 'Failed to delete video from storage');
      }
    }
    if (video.thumbnail_path) {
      try {
        await deleteObject(video.thumbnail_path);
      } catch (storageErr) {
        logger.warn({ storageErr, path: video.thumbnail_path }, 'Failed to delete thumbnail from storage');
      }
    }

    await pool.query('DELETE FROM videos WHERE id = $1', [req.params.id]);

    res.json({ message: 'Video deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete video');
    res.status(500).json({ error: 'Internal server error' });
  }
});

function mapVideoRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    durationSeconds: row.duration_seconds,
    status: row.status,
    storagePath: row.storage_path,
    thumbnailPath: row.thumbnail_path,
    fileSizeBytes: row.file_size_bytes,
    viewCount: row.view_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default router;
