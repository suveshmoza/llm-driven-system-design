import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { pool } from '../services/db.js';

const router = Router();

// GET /api/v1/transactions - Get transaction history
/** GET /api/v1/transactions - Returns paginated transaction history with optional type filter. */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const type = req.query.type as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    let query = `
      SELECT t.id, t.type, t.currency_id AS "currencyId",
             t.amount::text, t.fee::text,
             t.reference_id AS "referenceId",
             t.status, t.created_at AS "createdAt"
      FROM transactions t
      WHERE t.user_id = $1
    `;

    const params: (string | number)[] = [userId];

    if (type) {
      params.push(type);
      query += ` AND t.type = $${params.length}`;
    }

    query += ` ORDER BY t.created_at DESC`;

    params.push(limit);
    query += ` LIMIT $${params.length}`;

    params.push(offset);
    query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM transactions WHERE user_id = $1`;
    const countParams: string[] = [userId];

    if (type) {
      countParams.push(type);
      countQuery += ` AND type = $${countParams.length}`;
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      transactions: result.rows,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ error: 'Failed to get transactions' });
  }
});

export default router;
