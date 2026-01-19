import { Request, Response } from 'express';
import { queryWithTenant } from '../../services/db.js';

// List orders for store
export async function listOrders(req: Request, res: Response): Promise<void> {
  const { storeId } = req;

  const result = await queryWithTenant(
    storeId!,
    `SELECT o.*,
            (SELECT json_agg(oi.*) FROM order_items oi WHERE oi.order_id = o.id) as items
     FROM orders o
     ORDER BY o.created_at DESC`
  );

  res.json({ orders: result.rows });
}

// Get single order
export async function getOrder(req: Request, res: Response): Promise<void | Response> {
  const { storeId } = req;
  const { orderId } = req.params;

  const result = await queryWithTenant(
    storeId!,
    `SELECT o.*,
            (SELECT json_agg(oi.*) FROM order_items oi WHERE oi.order_id = o.id) as items
     FROM orders o
     WHERE o.id = $1`,
    [orderId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Order not found' });
  }

  res.json({ order: result.rows[0] });
}
