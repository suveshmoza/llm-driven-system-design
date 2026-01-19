import express, { type Request, type Response } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import { pool } from '../db/pool.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { idempotencyMiddleware, STATUS } from '../shared/idempotency.js';
import { logger } from '../shared/logger.js';
import { executeTransfer, getTransferById, MAX_TRANSFER_AMOUNT } from '../services/transfer.js';

const router = express.Router();

interface SendRequest {
  recipientUsername: string;
  amount: number | string;
  note?: string;
  visibility?: 'public' | 'friends' | 'private';
}

interface CommentRow {
  id: string;
  user_id: string;
  transfer_id: string;
  content: string;
  created_at: Date;
  username: string;
  name: string | null;
  avatar_url: string | null;
}

/**
 * Send money to another user
 *
 * CRITICAL: This endpoint uses idempotency middleware to prevent duplicate transfers.
 * Clients MUST provide an Idempotency-Key header (UUID v4 recommended).
 *
 * WHY: Without idempotency, network retries or double-clicks could result in
 * sending money twice. The idempotency key ensures each logical payment intent
 * is only processed once, even if the request is received multiple times.
 */
router.post('/send', authMiddleware, idempotencyMiddleware('transfer'), async (req: Request<ParamsDictionary, unknown, SendRequest>, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const log = logger.child({
    operation: 'send_transfer',
    userId: authReq.user.id,
    requestId: authReq.requestId,
  });

  try {
    const { recipientUsername, amount, note, visibility = 'public' } = req.body;

    if (!recipientUsername || !amount) {
      res.status(400).json({ error: 'Recipient and amount are required' });
      return;
    }

    // Convert amount to cents
    const amountCents = Math.round(parseFloat(String(amount)) * 100);

    if (isNaN(amountCents) || amountCents <= 0) {
      res.status(400).json({ error: 'Invalid amount' });
      return;
    }

    if (amountCents > MAX_TRANSFER_AMOUNT) {
      res.status(400).json({ error: `Maximum transfer amount is $${MAX_TRANSFER_AMOUNT / 100}` });
      return;
    }

    // Look up recipient by username
    const recipientResult = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE username = $1',
      [recipientUsername.toLowerCase()]
    );

    if (recipientResult.rows.length === 0) {
      res.status(404).json({ error: 'Recipient not found' });
      return;
    }

    const recipientId = recipientResult.rows[0].id;

    // Execute the transfer with idempotency key and request context
    const transfer = await executeTransfer(
      authReq.user.id,
      recipientId,
      amountCents,
      note || '',
      visibility,
      {
        idempotencyKey: authReq.idempotencyKey, // From idempotency middleware
        request: req, // For audit logging (IP, user agent)
      }
    );

    // Get full transfer details
    const fullTransfer = await getTransferById(transfer.id);

    // Store success in idempotency cache (if middleware is active)
    if (authReq.storeIdempotencyResult && !transfer._cached) {
      await authReq.storeIdempotencyResult(STATUS.COMPLETED, fullTransfer);
    }

    log.info({
      event: 'transfer_sent',
      transferId: transfer.id,
      amount: amountCents,
      recipient: recipientUsername,
      cached: transfer._cached || false,
    });

    res.status(201).json(fullTransfer);
  } catch (error) {
    log.error({
      event: 'transfer_failed',
      error: (error as Error).message,
    });

    // Store failure in idempotency cache
    if (authReq.storeIdempotencyResult) {
      await authReq.storeIdempotencyResult(STATUS.FAILED, {
        error: (error as Error).message,
        statusCode: 400,
      });
    }

    res.status(400).json({ error: (error as Error).message || 'Transfer failed' });
  }
});

// Get transfer by ID
router.get('/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const transfer = await getTransferById(req.params.id);

    if (!transfer) {
      res.status(404).json({ error: 'Transfer not found' });
      return;
    }

    // Check if user is participant or can see based on visibility
    const isParticipant = transfer.sender_id === authReq.user.id || transfer.receiver_id === authReq.user.id;

    if (!isParticipant && transfer.visibility === 'private') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Get likes count
    const likesResult = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM transfer_likes WHERE transfer_id = $1',
      [req.params.id]
    );

    // Check if current user liked
    const userLikedResult = await pool.query(
      'SELECT 1 FROM transfer_likes WHERE user_id = $1 AND transfer_id = $2',
      [authReq.user.id, req.params.id]
    );

    // Get comments
    const commentsResult = await pool.query<CommentRow>(
      `SELECT c.*, u.username, u.name, u.avatar_url
       FROM transfer_comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.transfer_id = $1
       ORDER BY c.created_at ASC`,
      [req.params.id]
    );

    res.json({
      ...transfer,
      likes_count: parseInt(likesResult.rows[0].count),
      user_liked: userLikedResult.rows.length > 0,
      comments: commentsResult.rows,
    });
  } catch (error) {
    logger.error({
      event: 'get_transfer_error',
      error: (error as Error).message,
      transferId: req.params.id,
    });
    res.status(500).json({ error: 'Failed to get transfer' });
  }
});

// Like a transfer
router.post('/:id/like', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    await pool.query(
      `INSERT INTO transfer_likes (user_id, transfer_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [authReq.user.id, req.params.id]
    );

    const countResult = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM transfer_likes WHERE transfer_id = $1',
      [req.params.id]
    );

    res.json({ likes_count: parseInt(countResult.rows[0].count), user_liked: true });
  } catch (error) {
    logger.error({
      event: 'like_transfer_error',
      error: (error as Error).message,
      transferId: req.params.id,
    });
    res.status(500).json({ error: 'Failed to like transfer' });
  }
});

// Unlike a transfer
router.delete('/:id/like', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    await pool.query(
      'DELETE FROM transfer_likes WHERE user_id = $1 AND transfer_id = $2',
      [authReq.user.id, req.params.id]
    );

    const countResult = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM transfer_likes WHERE transfer_id = $1',
      [req.params.id]
    );

    res.json({ likes_count: parseInt(countResult.rows[0].count), user_liked: false });
  } catch (error) {
    logger.error({
      event: 'unlike_transfer_error',
      error: (error as Error).message,
      transferId: req.params.id,
    });
    res.status(500).json({ error: 'Failed to unlike transfer' });
  }
});

// Add comment to transfer
router.post('/:id/comments', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { content } = req.body as { content?: string };

    if (!content || !content.trim()) {
      res.status(400).json({ error: 'Comment content is required' });
      return;
    }

    const result = await pool.query<{ id: string; user_id: string; transfer_id: string; content: string; created_at: Date }>(
      `INSERT INTO transfer_comments (user_id, transfer_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [authReq.user.id, req.params.id, content.trim()]
    );

    res.status(201).json({
      ...result.rows[0],
      username: authReq.user.username,
      name: authReq.user.name,
      avatar_url: authReq.user.avatar_url,
    });
  } catch (error) {
    logger.error({
      event: 'add_comment_error',
      error: (error as Error).message,
      transferId: req.params.id,
    });
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

export default router;
