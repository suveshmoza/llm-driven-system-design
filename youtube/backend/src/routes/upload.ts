import express, { Router, Request, Response } from 'express';
import multer, { Multer } from 'multer';
import { authenticate } from '../middleware/auth.js';
import {
  initUpload,
  uploadChunk,
  completeUpload,
  cancelUpload,
  getUploadStatus,
} from '../services/upload.js';
import { getTranscodingStatus } from '../services/transcoding.js';
import config from '../config/index.js';

// Extend Express Request to include user and file
interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    username: string;
    email: string;
    channelName: string;
    role: string;
    avatarUrl?: string;
  };
  file?: Express.Multer.File;
}

const router: Router = express.Router();

// Configure multer for chunk uploads
const storage = multer.memoryStorage();
const upload: Multer = multer({
  storage,
  limits: {
    fileSize: config.upload.chunkSize + 1024 * 1024, // Chunk size + 1MB buffer
  },
});

// Initialize upload session
router.post('/init', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { filename, fileSize, contentType } = req.body as {
      filename?: string;
      fileSize?: number;
      contentType?: string;
    };

    if (!filename || !fileSize || !contentType) {
      res.status(400).json({ error: 'Missing required fields: filename, fileSize, contentType' });
      return;
    }

    const result = await initUpload(authReq.user.id, filename, fileSize, contentType);
    res.json(result);
  } catch (error) {
    console.error('Upload init error:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

// Upload a chunk
router.put(
  '/:uploadId/chunks/:chunkNumber',
  authenticate,
  upload.single('chunk'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const { uploadId, chunkNumber } = req.params;

      if (!authReq.file) {
        res.status(400).json({ error: 'No chunk data provided' });
        return;
      }

      const result = await uploadChunk(uploadId, parseInt(chunkNumber, 10), authReq.file.buffer);
      res.json(result);
    } catch (error) {
      console.error('Chunk upload error:', error);
      res.status(400).json({ error: (error as Error).message });
    }
  }
);

// Complete upload and start processing
router.post('/:uploadId/complete', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { uploadId } = req.params;
    const { title, description, categories, tags } = req.body as {
      title?: string;
      description?: string;
      categories?: string[];
      tags?: string[];
    };

    if (!title) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    const result = await completeUpload(
      uploadId,
      authReq.user.id,
      title,
      description,
      categories || [],
      tags || []
    );

    res.json(result);
  } catch (error) {
    console.error('Complete upload error:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

// Cancel upload
router.delete('/:uploadId', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { uploadId } = req.params;
    const result = await cancelUpload(uploadId, authReq.user.id);
    res.json(result);
  } catch (error) {
    console.error('Cancel upload error:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

// Get upload status
router.get('/:uploadId/status', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { uploadId } = req.params;
    const result = await getUploadStatus(uploadId, authReq.user.id);
    res.json(result);
  } catch (error) {
    console.error('Get upload status error:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

// Get transcoding status
router.get('/:videoId/transcoding', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { videoId } = req.params;
    const result = await getTranscodingStatus(videoId);

    if (!result) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    res.json(result);
  } catch (error) {
    console.error('Get transcoding status error:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

// Simple single-file upload (for smaller files)
router.post(
  '/simple',
  authenticate,
  upload.single('video'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;

      if (!authReq.file) {
        res.status(400).json({ error: 'No video file provided' });
        return;
      }

      const { title, description, categories, tags } = req.body as {
        title?: string;
        description?: string;
        categories?: string;
        tags?: string;
      };

      if (!title) {
        res.status(400).json({ error: 'Title is required' });
        return;
      }

      // Initialize upload
      const initResult = await initUpload(
        authReq.user.id,
        authReq.file.originalname,
        authReq.file.size,
        authReq.file.mimetype
      );

      // Upload as single chunk
      await uploadChunk(initResult.uploadId, 0, authReq.file.buffer);

      // Complete upload
      const result = await completeUpload(
        initResult.uploadId,
        authReq.user.id,
        title,
        description,
        categories ? JSON.parse(categories) : [],
        tags ? JSON.parse(tags) : []
      );

      res.json(result);
    } catch (error) {
      console.error('Simple upload error:', error);
      res.status(400).json({ error: (error as Error).message });
    }
  }
);

export default router;
