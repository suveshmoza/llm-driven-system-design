import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { executeTransfer } from '../services/transferService.js';
import { pool } from '../services/db.js';
import { logger } from '../services/logger.js';

const router = Router();

// POST /api/requests - Request money from another user
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { payerId, amountCents, note } = req.body;

    if (!payerId) {
      res.status(400).json({ error: 'Payer is required' });
      return;
    }

    if (!amountCents || amountCents <= 0) {
      res.status(400).json({ error: 'Amount must be positive' });
      return;
    }

    if (payerId === req.session.userId) {
      res.status(400).json({ error: 'Cannot request money from yourself' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO transfer_requests (requester_id, payer_id, amount_cents, note)
       VALUES ($1, $2, $3, $4)
       RETURNING id, requester_id, payer_id, amount_cents, currency, note, status, created_at`,
      [req.session.userId, payerId, amountCents, note || null],
    );

    const request = result.rows[0];

    res.status(201).json({
      request: {
        id: request.id,
        requesterId: request.requester_id,
        payerId: request.payer_id,
        amountCents: parseInt(request.amount_cents, 10),
        currency: request.currency,
        note: request.note,
        status: request.status,
        createdAt: request.created_at,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to create request');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/requests - Get incoming and outgoing requests
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const { direction = 'all', status } = req.query;

    let query = `
      SELECT r.id, r.requester_id, r.payer_id, r.amount_cents, r.currency,
             r.note, r.status, r.created_at, r.updated_at,
             req.username as requester_username, req.display_name as requester_display_name,
             pay.username as payer_username, pay.display_name as payer_display_name
      FROM transfer_requests r
      JOIN users req ON r.requester_id = req.id
      JOIN users pay ON r.payer_id = pay.id
      WHERE 1=1
    `;

    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (direction === 'incoming') {
      query += ` AND r.payer_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    } else if (direction === 'outgoing') {
      query += ` AND r.requester_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    } else {
      query += ` AND (r.requester_id = $${paramIndex} OR r.payer_id = $${paramIndex})`;
      params.push(userId);
      paramIndex++;
    }

    if (status && typeof status === 'string' && ['pending', 'paid', 'declined', 'cancelled'].includes(status)) {
      query += ` AND r.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ' ORDER BY r.created_at DESC LIMIT 50';

    const result = await pool.query(query, params);

    const requests = result.rows.map((row) => ({
      id: row.id,
      requesterId: row.requester_id,
      payerId: row.payer_id,
      amountCents: parseInt(row.amount_cents, 10),
      currency: row.currency,
      note: row.note,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      requesterUsername: row.requester_username,
      requesterDisplayName: row.requester_display_name,
      payerUsername: row.payer_username,
      payerDisplayName: row.payer_display_name,
    }));

    res.json({ requests });
  } catch (err) {
    logger.error({ err }, 'Failed to get requests');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/requests/:id/pay - Pay a transfer request
router.post('/:id/pay', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.session.userId!;

    // Get the request
    const requestResult = await pool.query(
      `SELECT id, requester_id, payer_id, amount_cents, status, note
       FROM transfer_requests WHERE id = $1`,
      [id],
    );

    if (requestResult.rows.length === 0) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    const request = requestResult.rows[0];

    if (request.payer_id !== userId) {
      res.status(403).json({ error: 'Only the payer can pay this request' });
      return;
    }

    if (request.status !== 'pending') {
      res.status(400).json({ error: `Request is already ${request.status}` });
      return;
    }

    // Execute the transfer
    const transferResult = await executeTransfer(
      userId,
      request.requester_id,
      parseInt(request.amount_cents, 10),
      request.note || `Payment for request`,
    );

    // Update request status
    await pool.query(
      `UPDATE transfer_requests SET status = 'paid', updated_at = NOW()
       WHERE id = $1`,
      [id],
    );

    res.json({
      request: { id, status: 'paid' },
      transaction: transferResult.transaction,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Payment failed';
    logger.error({ err }, 'Failed to pay request');
    res.status(400).json({ error: message });
  }
});

// POST /api/requests/:id/decline - Decline a transfer request
router.post('/:id/decline', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.session.userId!;

    const requestResult = await pool.query(
      `SELECT id, payer_id, requester_id, status FROM transfer_requests WHERE id = $1`,
      [id],
    );

    if (requestResult.rows.length === 0) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    const request = requestResult.rows[0];

    // Both payer (decline) and requester (cancel) can reject
    if (request.payer_id !== userId && request.requester_id !== userId) {
      res.status(403).json({ error: 'Not authorized to decline this request' });
      return;
    }

    if (request.status !== 'pending') {
      res.status(400).json({ error: `Request is already ${request.status}` });
      return;
    }

    const newStatus = request.payer_id === userId ? 'declined' : 'cancelled';

    await pool.query(
      `UPDATE transfer_requests SET status = $1, updated_at = NOW()
       WHERE id = $2`,
      [newStatus, id],
    );

    res.json({ request: { id, status: newStatus } });
  } catch (err) {
    logger.error({ err }, 'Failed to decline request');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Transfer requests router for creating, paying, and declining money requests. */
export default router;
