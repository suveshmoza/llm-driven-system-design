import { Router, Request, Response } from 'express';
import { query } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import logger from '../../shared/logger.js';
import { getOrderWithDetails } from './helpers.js';

const router = Router();

// Get order by ID
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const order = await getOrderWithDetails(parseInt(id));

    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    // Check authorization
    const isCustomer = order.customer_id === req.user!.id;
    const isRestaurantOwner = order.restaurant?.owner_id === req.user!.id;
    const isDriver = order.driver?.user_id === req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    if (!isCustomer && !isRestaurantOwner && !isDriver && !isAdmin) {
      res.status(403).json({ error: 'Not authorized to view this order' });
      return;
    }

    res.json({ order });
  } catch (err) {
    const error = err as Error;
    logger.error({ error: error.message, orderId: req.params.id }, 'Get order error');
    res.status(500).json({ error: 'Failed to get order' });
  }
});

// Get customer's orders (list)
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, limit = '20', offset = '0' } = req.query;

    let sql = `
      SELECT o.*, r.name as restaurant_name, r.image_url as restaurant_image
      FROM orders o
      JOIN restaurants r ON o.restaurant_id = r.id
      WHERE o.customer_id = $1
    `;
    const params: unknown[] = [req.user!.id];

    if (status) {
      params.push(status);
      sql += ` AND o.status = $${params.length}`;
    }

    sql += ' ORDER BY o.placed_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(parseInt(limit as string), parseInt(offset as string));

    const result = await query(sql, params);

    res.json({ orders: result.rows });
  } catch (err) {
    const error = err as Error;
    logger.error({ error: error.message }, 'Get orders error');
    res.status(500).json({ error: 'Failed to get orders' });
  }
});

export default router;
