import { Router, Request, Response } from 'express';
import { query } from '../../db.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import logger from '../../shared/logger.js';

const router = Router();

// Restaurant: Get incoming orders
router.get(
  '/restaurant/:restaurantId',
  requireAuth,
  requireRole('restaurant_owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { restaurantId } = req.params;
      const { status, limit = '50' } = req.query;

      // Check ownership
      const restaurant = await query('SELECT owner_id FROM restaurants WHERE id = $1', [restaurantId]);
      if (restaurant.rows.length === 0) {
        res.status(404).json({ error: 'Restaurant not found' });
        return;
      }
      if (restaurant.rows[0].owner_id !== req.user!.id && req.user!.role !== 'admin') {
        res.status(403).json({ error: 'Not authorized' });
        return;
      }

      let sql = `
      SELECT o.*, u.name as customer_name, u.phone as customer_phone
      FROM orders o
      JOIN users u ON o.customer_id = u.id
      WHERE o.restaurant_id = $1
    `;
      const params: unknown[] = [restaurantId];

      if (status) {
        if (status === 'active') {
          sql += ` AND o.status NOT IN ('DELIVERED', 'COMPLETED', 'CANCELLED')`;
        } else {
          params.push(status);
          sql += ` AND o.status = $${params.length}`;
        }
      }

      sql += ' ORDER BY o.placed_at DESC LIMIT $' + (params.length + 1);
      params.push(parseInt(limit as string));

      const result = await query(sql, params);

      // Get items for each order
      const orders = await Promise.all(
        result.rows.map(async (order: { id: number }) => {
          const itemsResult = await query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
          return { ...order, items: itemsResult.rows };
        })
      );

      res.json({ orders });
    } catch (err) {
      const error = err as Error;
      logger.error({ error: error.message, restaurantId: req.params.restaurantId }, 'Get restaurant orders error');
      res.status(500).json({ error: 'Failed to get orders' });
    }
  }
);

export default router;
