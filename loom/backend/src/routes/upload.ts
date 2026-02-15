import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadLimiter } from '../services/rateLimiter.js';
import { logger } from '../services/logger.js';
import { getPresignedUploadUrl, getPresignedDownloadUrl, getObjectStat } from '../services/storageService.js';

const router = Router();

// POST /api/upload/presigned - Generate presigned upload URL
router.post('/presigned', requireAuth, uploadLimiter, async (req: Request, res: Response) => {
  try {
    const { videoId, fileType } = req.body;
    const userId = req.session.userId;

    if (!videoId) {
      res.status(400).json({ error: 'videoId is required' });
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

    const extension = fileType === 'thumbnail' ? 'jpg' : 'webm';
    const objectName = `${userId}/${videoId}/${uuidv4()}.${extension}`;

    const uploadUrl = await getPresignedUploadUrl(objectName);

    // Store the path on the video record
    if (fileType === 'thumbnail') {
      await pool.query(
        'UPDATE videos SET thumbnail_path = $1, updated_at = NOW() WHERE id = $2',
        [objectName, videoId],
      );
    } else {
      await pool.query(
        'UPDATE videos SET storage_path = $1, updated_at = NOW() WHERE id = $2',
        [objectName, videoId],
      );
    }

    res.json({ uploadUrl, objectName });
  } catch (err) {
    logger.error({ err }, 'Failed to generate presigned URL');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/upload/complete - Mark video as ready after upload
router.post('/complete', requireAuth, async (req: Request, res: Response) => {
  try {
    const { videoId, durationSeconds } = req.body;
    const userId = req.session.userId;

    if (!videoId) {
      res.status(400).json({ error: 'videoId is required' });
      return;
    }

    // Verify ownership and get storage path
    const video = await pool.query(
      'SELECT id, storage_path FROM videos WHERE id = $1 AND user_id = $2',
      [videoId, userId],
    );
    if (video.rows.length === 0) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const storagePath = video.rows[0].storage_path;
    let fileSizeBytes: number | null = null;

    // Try to get file size from MinIO
    if (storagePath) {
      try {
        const stat = await getObjectStat(storagePath);
        fileSizeBytes = stat.size;
      } catch (statErr) {
        logger.warn({ statErr }, 'Could not get file stat from MinIO');
      }
    }

    const result = await pool.query(
      `UPDATE videos
       SET status = 'ready',
           duration_seconds = $1,
           file_size_bytes = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [durationSeconds || null, fileSizeBytes, videoId],
    );

    res.json({ video: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to complete upload');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/upload/download/:videoId - Get presigned download URL
router.get('/download/:videoId', async (req: Request, res: Response) => {
  try {
    const video = await pool.query(
      'SELECT storage_path, status FROM videos WHERE id = $1',
      [req.params.videoId],
    );

    if (video.rows.length === 0) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    if (video.rows[0].status !== 'ready') {
      res.status(400).json({ error: 'Video is not ready yet' });
      return;
    }

    const downloadUrl = await getPresignedDownloadUrl(video.rows[0].storage_path);
    res.json({ downloadUrl });
  } catch (err) {
    logger.error({ err }, 'Failed to get download URL');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
