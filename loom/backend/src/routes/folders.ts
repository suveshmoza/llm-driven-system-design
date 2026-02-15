import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/folders - List user's folders
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId;

    const result = await pool.query(
      'SELECT * FROM folders WHERE user_id = $1 ORDER BY name ASC',
      [userId],
    );

    const folders = result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      parentId: row.parent_id,
      createdAt: row.created_at,
    }));

    res.json({ folders });
  } catch (err) {
    logger.error({ err }, 'Failed to list folders');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/folders - Create a folder
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, parentId } = req.body;
    const userId = req.session.userId;

    if (!name || name.trim().length === 0) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    // Verify parent folder belongs to user if specified
    if (parentId) {
      const parent = await pool.query(
        'SELECT id FROM folders WHERE id = $1 AND user_id = $2',
        [parentId, userId],
      );
      if (parent.rows.length === 0) {
        res.status(404).json({ error: 'Parent folder not found' });
        return;
      }
    }

    const result = await pool.query(
      `INSERT INTO folders (user_id, name, parent_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, name.trim(), parentId || null],
    );

    const folder = result.rows[0];
    res.status(201).json({
      folder: {
        id: folder.id,
        userId: folder.user_id,
        name: folder.name,
        parentId: folder.parent_id,
        createdAt: folder.created_at,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to create folder');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/folders/:id - Rename folder
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    const userId = req.session.userId;

    if (!name || name.trim().length === 0) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const result = await pool.query(
      'UPDATE folders SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [name.trim(), req.params.id, userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }

    const folder = result.rows[0];
    res.json({
      folder: {
        id: folder.id,
        userId: folder.user_id,
        name: folder.name,
        parentId: folder.parent_id,
        createdAt: folder.created_at,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to rename folder');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/folders/:id - Delete folder
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId;

    const result = await pool.query(
      'DELETE FROM folders WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }

    res.json({ message: 'Folder deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete folder');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/folders/:id/videos - Add video to folder
router.post('/:id/videos', requireAuth, async (req: Request, res: Response) => {
  try {
    const { videoId } = req.body;
    const userId = req.session.userId;

    if (!videoId) {
      res.status(400).json({ error: 'videoId is required' });
      return;
    }

    // Verify folder ownership
    const folder = await pool.query(
      'SELECT id FROM folders WHERE id = $1 AND user_id = $2',
      [req.params.id, userId],
    );
    if (folder.rows.length === 0) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }

    // Verify video ownership
    const video = await pool.query(
      'SELECT id FROM videos WHERE id = $1 AND user_id = $2',
      [videoId, userId],
    );
    if (video.rows.length === 0) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    await pool.query(
      'INSERT INTO video_folders (video_id, folder_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [videoId, req.params.id],
    );

    res.status(201).json({ message: 'Video added to folder' });
  } catch (err) {
    logger.error({ err }, 'Failed to add video to folder');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/folders/:id/videos/:videoId - Remove video from folder
router.delete('/:id/videos/:videoId', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId;

    // Verify folder ownership
    const folder = await pool.query(
      'SELECT id FROM folders WHERE id = $1 AND user_id = $2',
      [req.params.id, userId],
    );
    if (folder.rows.length === 0) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }

    await pool.query(
      'DELETE FROM video_folders WHERE video_id = $1 AND folder_id = $2',
      [req.params.videoId, req.params.id],
    );

    res.json({ message: 'Video removed from folder' });
  } catch (err) {
    logger.error({ err }, 'Failed to remove video from folder');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
