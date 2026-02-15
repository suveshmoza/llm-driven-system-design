import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/accounts
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { search, industry, page = '1', limit = '20' } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    const params: (string | number)[] = [];
    const conditions: string[] = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`name ILIKE $${params.length}`);
    }
    if (industry) {
      params.push(industry as string);
      conditions.push(`industry = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(parseInt(limit as string));
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;

    const result = await pool.query(
      `SELECT a.*, u.display_name as owner_name
       FROM accounts a
       LEFT JOIN users u ON a.owner_id = u.id
       ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params,
    );

    const countParams = params.slice(0, params.length - 2);
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM accounts ${whereClause}`,
      countParams,
    );

    res.json({
      accounts: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page as string),
      limit: parseInt(limit as string),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch accounts');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/accounts/:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT a.*, u.display_name as owner_name
       FROM accounts a
       LEFT JOIN users u ON a.owner_id = u.id
       WHERE a.id = $1`,
      [req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    res.json({ account: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch account');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/accounts
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const {
      name, industry, website, phone,
      addressStreet, addressCity, addressState, addressCountry,
      annualRevenueCents, employeeCount,
    } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Account name is required' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO accounts (name, industry, website, phone, address_street, address_city, address_state, address_country, annual_revenue_cents, employee_count, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [name, industry, website, phone, addressStreet, addressCity, addressState, addressCountry, annualRevenueCents, employeeCount, req.session.userId],
    );

    res.status(201).json({ account: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to create account');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/accounts/:id
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const {
      name, industry, website, phone,
      addressStreet, addressCity, addressState, addressCountry,
      annualRevenueCents, employeeCount,
    } = req.body;

    const result = await pool.query(
      `UPDATE accounts
       SET name = COALESCE($1, name),
           industry = COALESCE($2, industry),
           website = COALESCE($3, website),
           phone = COALESCE($4, phone),
           address_street = COALESCE($5, address_street),
           address_city = COALESCE($6, address_city),
           address_state = COALESCE($7, address_state),
           address_country = COALESCE($8, address_country),
           annual_revenue_cents = COALESCE($9, annual_revenue_cents),
           employee_count = COALESCE($10, employee_count),
           updated_at = NOW()
       WHERE id = $11
       RETURNING *`,
      [name, industry, website, phone, addressStreet, addressCity, addressState, addressCountry, annualRevenueCents, employeeCount, req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    res.json({ account: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to update account');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/accounts/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM accounts WHERE id = $1 RETURNING id',
      [req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    res.json({ message: 'Account deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete account');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/accounts/:id/contacts
router.get('/:id/contacts', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT c.*, u.display_name as owner_name
       FROM contacts c
       LEFT JOIN users u ON c.owner_id = u.id
       WHERE c.account_id = $1
       ORDER BY c.created_at DESC`,
      [req.params.id],
    );

    res.json({ contacts: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch account contacts');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/accounts/:id/opportunities
router.get('/:id/opportunities', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT o.*, u.display_name as owner_name
       FROM opportunities o
       LEFT JOIN users u ON o.owner_id = u.id
       WHERE o.account_id = $1
       ORDER BY o.created_at DESC`,
      [req.params.id],
    );

    res.json({ opportunities: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch account opportunities');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
