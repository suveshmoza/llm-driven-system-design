import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';
import { uploadFile, getPresignedUrl } from '../services/storageService.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// POST /api/files - upload file
router.post('/', requireAuth, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const { channelId, messageId } = req.body;

    if (!channelId) {
      res.status(400).json({ error: 'channelId is required' });
      return;
    }

    const fileId = uuidv4();
    const ext = req.file.originalname.split('.').pop() || '';
    const storagePath = `channels/${channelId}/${fileId}.${ext}`;

    await uploadFile(storagePath, req.file.buffer, req.file.mimetype);

    const result = await pool.query(
      `INSERT INTO files (message_id, channel_id, user_id, filename, content_type, size_bytes, storage_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        messageId || null,
        channelId,
        req.session.userId,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        storagePath,
      ],
    );

    res.status(201).json({ file: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to upload file');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/files/:fileId/download - get download URL
router.get('/:fileId/download', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM files WHERE id = $1', [req.params.fileId]);

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const file = result.rows[0];
    const url = await getPresignedUrl(file.storage_path);

    res.json({ url, file });
  } catch (err) {
    logger.error({ err }, 'Failed to get file download URL');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/files?channelId=xxx - list channel files
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { channelId } = req.query;

    if (!channelId) {
      res.status(400).json({ error: 'channelId query parameter is required' });
      return;
    }

    const result = await pool.query(
      `SELECT f.*, u.username, u.display_name
       FROM files f
       JOIN users u ON f.user_id = u.id
       WHERE f.channel_id = $1
       ORDER BY f.created_at DESC`,
      [channelId],
    );

    res.json({ files: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to list files');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
