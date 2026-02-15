import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { executeTransfer } from '../services/transferService.js';
import { transferLimiter } from '../services/rateLimiter.js';
import { pool } from '../services/db.js';
import { logger } from '../services/logger.js';

const router = Router();

// POST /api/transfers - Send money (P2P transfer with idempotency)
router.post('/', requireAuth, transferLimiter, async (req: Request, res: Response) => {
  try {
    const { recipientId, amountCents, note, idempotencyKey } = req.body;

    if (!recipientId) {
      res.status(400).json({ error: 'Recipient is required' });
      return;
    }

    if (!amountCents || amountCents <= 0) {
      res.status(400).json({ error: 'Amount must be positive' });
      return;
    }

    if (amountCents > 5000000) { // $50,000 limit
      res.status(400).json({ error: 'Transfer amount exceeds limit' });
      return;
    }

    const result = await executeTransfer(
      req.session.userId!,
      recipientId,
      amountCents,
      note,
      idempotencyKey,
    );

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transfer failed';
    logger.error({ err }, 'Transfer failed');

    if (message === 'Insufficient funds') {
      res.status(400).json({ error: message });
    } else if (message === 'Cannot transfer to yourself') {
      res.status(400).json({ error: message });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

// GET /api/transfers - Get transaction history
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const { type, limit = '50', offset = '0' } = req.query;

    let query = `
      SELECT t.id, t.sender_id, t.recipient_id, t.amount_cents, t.currency,
             t.type, t.status, t.note, t.created_at,
             su.username as sender_username, su.display_name as sender_display_name,
             ru.username as recipient_username, ru.display_name as recipient_display_name
      FROM transactions t
      LEFT JOIN users su ON t.sender_id = su.id
      LEFT JOIN users ru ON t.recipient_id = ru.id
      WHERE (t.sender_id = $1 OR t.recipient_id = $1)
    `;

    const params: (string | number)[] = [userId];
    let paramIndex = 2;

    if (type && typeof type === 'string' && ['transfer', 'deposit', 'withdrawal'].includes(type)) {
      query += ` AND t.type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    query += ` ORDER BY t.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit as string, 10), parseInt(offset as string, 10));

    const result = await pool.query(query, params);

    const transactions = result.rows.map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      recipientId: row.recipient_id,
      amountCents: parseInt(row.amount_cents, 10),
      currency: row.currency,
      type: row.type,
      status: row.status,
      note: row.note,
      createdAt: row.created_at,
      senderUsername: row.sender_username,
      senderDisplayName: row.sender_display_name,
      recipientUsername: row.recipient_username,
      recipientDisplayName: row.recipient_display_name,
    }));

    res.json({ transactions });
  } catch (err) {
    logger.error({ err }, 'Failed to get transactions');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Transfers router for P2P money sends with idempotency and transaction history. */
export default router;
