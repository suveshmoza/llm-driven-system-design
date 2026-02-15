import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { pool } from '../services/db.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/payment-methods - List user's payment methods
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, type, label, last_four, is_default, created_at
       FROM payment_methods
       WHERE user_id = $1
       ORDER BY is_default DESC, created_at DESC`,
      [req.session.userId],
    );

    const paymentMethods = result.rows.map((row) => ({
      id: row.id,
      type: row.type,
      label: row.label,
      lastFour: row.last_four,
      isDefault: row.is_default,
      createdAt: row.created_at,
    }));

    res.json({ paymentMethods });
  } catch (err) {
    logger.error({ err }, 'Failed to get payment methods');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/payment-methods - Add a payment method
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { type, label, lastFour, isDefault } = req.body;

    if (!type || !['bank', 'card'].includes(type)) {
      res.status(400).json({ error: 'Type must be "bank" or "card"' });
      return;
    }

    if (!label) {
      res.status(400).json({ error: 'Label is required' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // If setting as default, unset others
      if (isDefault) {
        await client.query(
          'UPDATE payment_methods SET is_default = false WHERE user_id = $1',
          [req.session.userId],
        );
      }

      const result = await client.query(
        `INSERT INTO payment_methods (user_id, type, label, last_four, is_default)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, type, label, last_four, is_default, created_at`,
        [req.session.userId, type, label, lastFour || null, isDefault || false],
      );

      await client.query('COMMIT');

      const pm = result.rows[0];
      res.status(201).json({
        paymentMethod: {
          id: pm.id,
          type: pm.type,
          label: pm.label,
          lastFour: pm.last_four,
          isDefault: pm.is_default,
          createdAt: pm.created_at,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, 'Failed to add payment method');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/payment-methods/:id - Remove a payment method
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM payment_methods WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.session.userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Payment method not found' });
      return;
    }

    res.json({ message: 'Payment method removed' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete payment method');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/payment-methods/:id/default - Set as default
router.put('/:id/default', requireAuth, async (req: Request, res: Response) => {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verify ownership
      const check = await client.query(
        'SELECT id FROM payment_methods WHERE id = $1 AND user_id = $2',
        [req.params.id, req.session.userId],
      );

      if (check.rows.length === 0) {
        res.status(404).json({ error: 'Payment method not found' });
        await client.query('ROLLBACK');
        return;
      }

      // Unset all defaults
      await client.query(
        'UPDATE payment_methods SET is_default = false WHERE user_id = $1',
        [req.session.userId],
      );

      // Set new default
      await client.query(
        'UPDATE payment_methods SET is_default = true WHERE id = $1',
        [req.params.id],
      );

      await client.query('COMMIT');
      res.json({ message: 'Default payment method updated' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, 'Failed to set default payment method');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Payment methods router for CRUD operations and default management. */
export default router;
