import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/contacts
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { search, accountId, page = '1', limit = '20' } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    const params: (string | number)[] = [];
    const conditions: string[] = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(c.first_name ILIKE $${params.length} OR c.last_name ILIKE $${params.length} OR c.email ILIKE $${params.length})`);
    }
    if (accountId) {
      params.push(accountId as string);
      conditions.push(`c.account_id = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(parseInt(limit as string));
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;

    const result = await pool.query(
      `SELECT c.*, a.name as account_name, u.display_name as owner_name
       FROM contacts c
       LEFT JOIN accounts a ON c.account_id = a.id
       LEFT JOIN users u ON c.owner_id = u.id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params,
    );

    const countParams = params.slice(0, params.length - 2);
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM contacts c ${whereClause}`,
      countParams,
    );

    res.json({
      contacts: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page as string),
      limit: parseInt(limit as string),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch contacts');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/contacts/:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT c.*, a.name as account_name, u.display_name as owner_name
       FROM contacts c
       LEFT JOIN accounts a ON c.account_id = a.id
       LEFT JOIN users u ON c.owner_id = u.id
       WHERE c.id = $1`,
      [req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    res.json({ contact: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch contact');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/contacts
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, email, phone, title, department, accountId } = req.body;

    if (!firstName || !lastName) {
      res.status(400).json({ error: 'First name and last name are required' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO contacts (first_name, last_name, email, phone, title, department, account_id, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [firstName, lastName, email, phone, title, department, accountId, req.session.userId],
    );

    res.status(201).json({ contact: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to create contact');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/contacts/:id
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, email, phone, title, department, accountId } = req.body;

    const result = await pool.query(
      `UPDATE contacts
       SET first_name = COALESCE($1, first_name),
           last_name = COALESCE($2, last_name),
           email = COALESCE($3, email),
           phone = COALESCE($4, phone),
           title = COALESCE($5, title),
           department = COALESCE($6, department),
           account_id = COALESCE($7, account_id),
           updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [firstName, lastName, email, phone, title, department, accountId, req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    res.json({ contact: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to update contact');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/contacts/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM contacts WHERE id = $1 RETURNING id',
      [req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    res.json({ message: 'Contact deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete contact');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
