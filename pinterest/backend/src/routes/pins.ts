import { Router, Request, Response } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { pinRateLimiter } from '../services/rateLimiter.js';
import { pinsCreatedTotal } from '../services/metrics.js';
import { logger } from '../services/logger.js';
import { query } from '../services/db.js';
import { createPin, getPinById, deletePin } from '../services/pinService.js';
import { uploadOriginalImage } from '../services/imageService.js';

const router = Router();

// Multer setup for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));
    }
  },
});

// GET /api/v1/pins/:pinId
router.get('/:pinId', async (req: Request, res: Response) => {
  try {
    const pin = await getPinById(req.params.pinId);

    if (!pin) {
      res.status(404).json({ error: 'Pin not found' });
      return;
    }

    // Check if current user has saved this pin
    let isSaved = false;
    let savedBoardId: string | null = null;
    if (req.session?.userId) {
      const saveResult = await query(
        `SELECT board_id FROM pin_saves WHERE pin_id = $1 AND user_id = $2 LIMIT 1`,
        [pin.id, req.session.userId],
      );
      if (saveResult.rows.length > 0) {
        isSaved = true;
        savedBoardId = saveResult.rows[0].board_id;
      }
    }

    // Get comments
    const comments = await query(
      `SELECT pc.*, u.username, u.display_name, u.avatar_url
       FROM pin_comments pc
       JOIN users u ON u.id = pc.user_id
       WHERE pc.pin_id = $1 AND pc.parent_comment_id IS NULL
       ORDER BY pc.created_at DESC
       LIMIT 20`,
      [pin.id],
    );

    res.json({
      pin: {
        id: pin.id,
        userId: pin.user_id,
        username: pin.username,
        displayName: pin.display_name,
        avatarUrl: pin.avatar_url,
        title: pin.title,
        description: pin.description,
        imageUrl: pin.image_url,
        imageWidth: pin.image_width,
        imageHeight: pin.image_height,
        aspectRatio: pin.aspect_ratio,
        dominantColor: pin.dominant_color,
        linkUrl: pin.link_url,
        status: pin.status,
        saveCount: pin.save_count,
        commentCount: pin.comment_count,
        isSaved,
        savedBoardId,
        createdAt: pin.created_at,
        comments: comments.rows.map((c) => ({
          id: c.id,
          userId: c.user_id,
          username: c.username,
          displayName: c.display_name,
          avatarUrl: c.avatar_url,
          content: c.content,
          createdAt: c.created_at,
        })),
      },
    });
  } catch (err) {
    logger.error({ err }, 'Get pin error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/pins - Create a new pin
router.post(
  '/',
  requireAuth,
  pinRateLimiter,
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'Image file is required' });
        return;
      }

      const { title, description, linkUrl, boardId } = req.body;

      // Create pin record first
      const pin = await createPin({
        userId: req.session.userId!,
        title,
        description,
        imageUrl: '', // Will be updated after upload
        linkUrl,
      });

      // Upload image and queue processing
      const { imageUrl } = await uploadOriginalImage(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        pin.id,
      );

      // Update pin with image URL
      await query('UPDATE pins SET image_url = $1 WHERE id = $2', [imageUrl, pin.id]);

      // If boardId specified, save to board
      if (boardId) {
        await query(
          `INSERT INTO board_pins (board_id, pin_id, position)
           VALUES ($1, $2, COALESCE((SELECT MAX(position) + 1 FROM board_pins WHERE board_id = $1), 0))
           ON CONFLICT DO NOTHING`,
          [boardId, pin.id],
        );
        await query(
          `INSERT INTO pin_saves (pin_id, user_id, board_id) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [pin.id, req.session.userId, boardId],
        );
        await query(`UPDATE boards SET pin_count = pin_count + 1 WHERE id = $1`, [boardId]);
      }

      pinsCreatedTotal.inc();

      res.status(201).json({
        pin: {
          id: pin.id,
          title: pin.title,
          description: pin.description,
          imageUrl,
          status: 'processing',
          createdAt: pin.created_at,
        },
      });
    } catch (err) {
      logger.error({ err }, 'Create pin error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// DELETE /api/v1/pins/:pinId
router.delete('/:pinId', requireAuth, async (req: Request, res: Response) => {
  try {
    const deleted = await deletePin(req.params.pinId, req.session.userId!);

    if (!deleted) {
      res.status(404).json({ error: 'Pin not found or unauthorized' });
      return;
    }

    res.json({ message: 'Pin deleted' });
  } catch (err) {
    logger.error({ err }, 'Delete pin error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/pins/:pinId/save
router.post('/:pinId/save', requireAuth, async (req: Request, res: Response) => {
  try {
    const { boardId } = req.body;

    if (!boardId) {
      res.status(400).json({ error: 'boardId is required' });
      return;
    }

    // Verify board belongs to user
    const boardResult = await query(
      `SELECT id FROM boards WHERE id = $1 AND user_id = $2`,
      [boardId, req.session.userId],
    );

    if (boardResult.rows.length === 0) {
      res.status(404).json({ error: 'Board not found' });
      return;
    }

    const { savePinToBoard } = await import('../services/pinService.js');
    const saved = await savePinToBoard(req.params.pinId, req.session.userId!, boardId);

    if (!saved) {
      res.status(500).json({ error: 'Failed to save pin' });
      return;
    }

    res.json({ message: 'Pin saved to board' });
  } catch (err) {
    logger.error({ err }, 'Save pin error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/v1/pins/:pinId/save
router.delete('/:pinId/save', requireAuth, async (req: Request, res: Response) => {
  try {
    const { boardId } = req.body;

    if (!boardId) {
      res.status(400).json({ error: 'boardId is required' });
      return;
    }

    const { unsavePinFromBoard } = await import('../services/pinService.js');
    const unsaved = await unsavePinFromBoard(req.params.pinId, req.session.userId!, boardId);

    if (!unsaved) {
      res.status(404).json({ error: 'Save not found' });
      return;
    }

    res.json({ message: 'Pin unsaved from board' });
  } catch (err) {
    logger.error({ err }, 'Unsave pin error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/pins/:pinId/comments
router.post('/:pinId/comments', requireAuth, async (req: Request, res: Response) => {
  try {
    const { content, parentCommentId } = req.body;

    if (!content || content.trim().length === 0) {
      res.status(400).json({ error: 'Comment content is required' });
      return;
    }

    const result = await query(
      `INSERT INTO pin_comments (pin_id, user_id, content, parent_comment_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.params.pinId, req.session.userId, content.trim(), parentCommentId || null],
    );

    // Update comment count
    await query(`UPDATE pins SET comment_count = comment_count + 1 WHERE id = $1`, [req.params.pinId]);

    const comment = result.rows[0];
    res.status(201).json({
      comment: {
        id: comment.id,
        pinId: comment.pin_id,
        userId: comment.user_id,
        content: comment.content,
        parentCommentId: comment.parent_comment_id,
        createdAt: comment.created_at,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Create comment error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/pins/:pinId/comments
router.get('/:pinId/comments', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const cursor = req.query.cursor as string | undefined;

    let result;
    if (cursor) {
      result = await query(
        `SELECT pc.*, u.username, u.display_name, u.avatar_url
         FROM pin_comments pc
         JOIN users u ON u.id = pc.user_id
         WHERE pc.pin_id = $1 AND pc.parent_comment_id IS NULL AND pc.created_at < $3
         ORDER BY pc.created_at DESC
         LIMIT $2`,
        [req.params.pinId, limit + 1, cursor],
      );
    } else {
      result = await query(
        `SELECT pc.*, u.username, u.display_name, u.avatar_url
         FROM pin_comments pc
         JOIN users u ON u.id = pc.user_id
         WHERE pc.pin_id = $1 AND pc.parent_comment_id IS NULL
         ORDER BY pc.created_at DESC
         LIMIT $2`,
        [req.params.pinId, limit + 1],
      );
    }

    const comments = result.rows;
    let nextCursor: string | null = null;

    if (comments.length > limit) {
      nextCursor = comments[limit - 1].created_at.toISOString();
      comments.splice(limit);
    }

    res.json({
      comments: comments.map((c) => ({
        id: c.id,
        userId: c.user_id,
        username: c.username,
        displayName: c.display_name,
        avatarUrl: c.avatar_url,
        content: c.content,
        parentCommentId: c.parent_comment_id,
        createdAt: c.created_at,
      })),
      nextCursor,
    });
  } catch (err) {
    logger.error({ err }, 'Get comments error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
