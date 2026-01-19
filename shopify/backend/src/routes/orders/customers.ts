import { Request, Response } from 'express';
import { queryWithTenant } from '../../services/db.js';

// List customers for store
export async function listCustomers(req: Request, res: Response): Promise<void> {
  const { storeId } = req;

  const result = await queryWithTenant(
    storeId!,
    `SELECT c.*,
            (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) as order_count,
            (SELECT COALESCE(SUM(total), 0) FROM orders o WHERE o.customer_id = c.id) as total_spent
     FROM customers c
     ORDER BY c.created_at DESC`
  );

  res.json({ customers: result.rows });
}

// Get single customer
export async function getCustomer(req: Request, res: Response): Promise<void | Response> {
  const { storeId } = req;
  const { customerId } = req.params;

  const result = await queryWithTenant(
    storeId!,
    `SELECT c.*,
            (SELECT json_agg(a.*) FROM customer_addresses a WHERE a.customer_id = c.id) as addresses,
            (SELECT json_agg(o.* ORDER BY o.created_at DESC) FROM orders o WHERE o.customer_id = c.id) as orders
     FROM customers c
     WHERE c.id = $1`,
    [customerId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  res.json({ customer: result.rows[0] });
}
