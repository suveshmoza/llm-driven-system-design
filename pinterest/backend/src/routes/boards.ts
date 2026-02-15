import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../services/db.js';
import { cacheGet, cacheSet, cacheDel } from '../services/redis.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/v1/boards/:boardId
router.get('/:boardId', async (req: Request, res: Response) => {
  try {
    const cacheKey = `board:${req.params.boardId}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const boardResult = await query(
      `SELECT b.*, u.username, u.display_name, u.avatar_url
       FROM boards b
       JOIN users u ON u.id = b.user_id
       WHERE b.id = $1`,
      [req.params.boardId],
    );

    if (boardResult.rows.length === 0) {
      res.status(404).json({ error: 'Board not found' });
      return;
    }

    const board = boardResult.rows[0];

    // Check private access
    if (board.is_private && req.session?.userId !== board.user_id) {
      res.status(403).json({ error: 'This board is private' });
      return;
    }

    const response = {
      board: {
        id: board.id,
        userId: board.user_id,
        username: board.username,
        displayName: board.display_name,
        avatarUrl: board.avatar_url,
        name: board.name,
        description: board.description,
        coverPinId: board.cover_pin_id,
        isPrivate: board.is_private,
        pinCount: board.pin_count,
        createdAt: board.created_at,
      },
    };

    await cacheSet(cacheKey, response, 120);
    res.json(response);
  } catch (err) {
    logger.error({ err }, 'Get board error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/boards/:boardId/pins
router.get('/:boardId/pins', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const cursor = req.query.cursor as string | undefined;

    let result;
    if (cursor) {
      result = await query(
        `SELECT p.*, u.username, u.display_name, u.avatar_url, bp.position
         FROM board_pins bp
         JOIN pins p ON p.id = bp.pin_id
         JOIN users u ON u.id = p.user_id
         WHERE bp.board_id = $1 AND p.status = 'published' AND bp.created_at < $3
         ORDER BY bp.position DESC, bp.created_at DESC
         LIMIT $2`,
        [req.params.boardId, limit + 1, cursor],
      );
    } else {
      result = await query(
        `SELECT p.*, u.username, u.display_name, u.avatar_url, bp.position
         FROM board_pins bp
         JOIN pins p ON p.id = bp.pin_id
         JOIN users u ON u.id = p.user_id
         WHERE bp.board_id = $1 AND p.status = 'published'
         ORDER BY bp.position DESC, bp.created_at DESC
         LIMIT $2`,
        [req.params.boardId, limit + 1],
      );
    }

    const pins = result.rows;
    let nextCursor: string | null = null;

    if (pins.length > limit) {
      nextCursor = pins[limit - 1].created_at.toISOString();
      pins.splice(limit);
    }

    res.json({
      pins: pins.map((p) => ({
        id: p.id,
        userId: p.user_id,
        username: p.username,
        displayName: p.display_name,
        avatarUrl: p.avatar_url,
        title: p.title,
        description: p.description,
        imageUrl: p.image_url,
        imageWidth: p.image_width,
        imageHeight: p.image_height,
        aspectRatio: p.aspect_ratio,
        dominantColor: p.dominant_color,
        saveCount: p.save_count,
        createdAt: p.created_at,
      })),
      nextCursor,
    });
  } catch (err) {
    logger.error({ err }, 'Get board pins error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/boards
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, description, isPrivate } = req.body;

    if (!name || name.trim().length === 0) {
      res.status(400).json({ error: 'Board name is required' });
      return;
    }

    if (name.length > 100) {
      res.status(400).json({ error: 'Board name must be 100 characters or less' });
      return;
    }

    const result = await query(
      `INSERT INTO boards (user_id, name, description, is_private)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.session.userId, name.trim(), description || null, isPrivate || false],
    );

    const board = result.rows[0];
    res.status(201).json({
      board: {
        id: board.id,
        userId: board.user_id,
        name: board.name,
        description: board.description,
        isPrivate: board.is_private,
        pinCount: board.pin_count,
        createdAt: board.created_at,
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      res.status(409).json({ error: 'A board with this name already exists' });
      return;
    }
    logger.error({ err }, 'Create board error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/v1/boards/:boardId
router.put('/:boardId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, description, isPrivate } = req.body;

    const result = await query(
      `UPDATE boards SET
        name = COALESCE($3, name),
        description = COALESCE($4, description),
        is_private = COALESCE($5, is_private),
        updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [req.params.boardId, req.session.userId, name, description, isPrivate],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Board not found or unauthorized' });
      return;
    }

    const board = result.rows[0];
    await cacheDel(`board:${board.id}`);

    res.json({
      board: {
        id: board.id,
        userId: board.user_id,
        name: board.name,
        description: board.description,
        isPrivate: board.is_private,
        pinCount: board.pin_count,
        createdAt: board.created_at,
        updatedAt: board.updated_at,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Update board error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/v1/boards/:boardId
router.delete('/:boardId', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `DELETE FROM boards WHERE id = $1 AND user_id = $2`,
      [req.params.boardId, req.session.userId],
    );

    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'Board not found or unauthorized' });
      return;
    }

    await cacheDel(`board:${req.params.boardId}`);
    res.json({ message: 'Board deleted' });
  } catch (err) {
    logger.error({ err }, 'Delete board error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/boards/:boardId/pins - Add pin to board
router.post('/:boardId/pins', requireAuth, async (req: Request, res: Response) => {
  try {
    const { pinId } = req.body;

    if (!pinId) {
      res.status(400).json({ error: 'pinId is required' });
      return;
    }

    // Verify board belongs to user
    const boardCheck = await query(
      `SELECT id FROM boards WHERE id = $1 AND user_id = $2`,
      [req.params.boardId, req.session.userId],
    );

    if (boardCheck.rows.length === 0) {
      res.status(404).json({ error: 'Board not found or unauthorized' });
      return;
    }

    const { savePinToBoard } = await import('../services/pinService.js');
    await savePinToBoard(pinId, req.session.userId!, req.params.boardId);

    res.json({ message: 'Pin added to board' });
  } catch (err) {
    logger.error({ err }, 'Add pin to board error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/v1/boards/:boardId/pins/:pinId - Remove pin from board
router.delete('/:boardId/pins/:pinId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { unsavePinFromBoard } = await import('../services/pinService.js');
    await unsavePinFromBoard(req.params.pinId, req.session.userId!, req.params.boardId);

    res.json({ message: 'Pin removed from board' });
  } catch (err) {
    logger.error({ err }, 'Remove pin from board error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
