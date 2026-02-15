import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { convertLead } from '../services/leadConversionService.js';
import { logger } from '../services/logger.js';

const router = Router();

const VALID_STATUSES = ['New', 'Contacted', 'Qualified', 'Unqualified', 'Converted'];
const VALID_SOURCES = ['Web', 'Phone', 'Email', 'Referral', 'Partner', 'Trade Show', 'Social Media', 'Other'];

// GET /api/leads
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { search, status, source, page = '1', limit = '20' } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    const params: (string | number)[] = [];
    const conditions: string[] = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(l.first_name ILIKE $${params.length} OR l.last_name ILIKE $${params.length} OR l.company ILIKE $${params.length} OR l.email ILIKE $${params.length})`);
    }
    if (status) {
      params.push(status as string);
      conditions.push(`l.status = $${params.length}`);
    }
    if (source) {
      params.push(source as string);
      conditions.push(`l.source = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(parseInt(limit as string));
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;

    const result = await pool.query(
      `SELECT l.*, u.display_name as owner_name
       FROM leads l
       LEFT JOIN users u ON l.owner_id = u.id
       ${whereClause}
       ORDER BY l.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params,
    );

    const countParams = params.slice(0, params.length - 2);
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM leads l ${whereClause}`,
      countParams,
    );

    res.json({
      leads: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page as string),
      limit: parseInt(limit as string),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch leads');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/leads/:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT l.*, u.display_name as owner_name
       FROM leads l
       LEFT JOIN users u ON l.owner_id = u.id
       WHERE l.id = $1`,
      [req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    res.json({ lead: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch lead');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/leads
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, email, phone, company, title, source, status } = req.body;

    if (!firstName || !lastName) {
      res.status(400).json({ error: 'First name and last name are required' });
      return;
    }

    const leadStatus = status || 'New';
    if (!VALID_STATUSES.includes(leadStatus)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }

    if (source && !VALID_SOURCES.includes(source)) {
      res.status(400).json({ error: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}` });
      return;
    }

    const result = await pool.query(
      `INSERT INTO leads (first_name, last_name, email, phone, company, title, source, status, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [firstName, lastName, email, phone, company, title, source, leadStatus, req.session.userId],
    );

    res.status(201).json({ lead: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to create lead');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/leads/:id
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, email, phone, company, title, source, status } = req.body;

    if (status && !VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }

    if (source && !VALID_SOURCES.includes(source)) {
      res.status(400).json({ error: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}` });
      return;
    }

    const result = await pool.query(
      `UPDATE leads
       SET first_name = COALESCE($1, first_name),
           last_name = COALESCE($2, last_name),
           email = COALESCE($3, email),
           phone = COALESCE($4, phone),
           company = COALESCE($5, company),
           title = COALESCE($6, title),
           source = COALESCE($7, source),
           status = COALESCE($8, status),
           updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [firstName, lastName, email, phone, company, title, source, status, req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    res.json({ lead: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to update lead');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/leads/:id/convert
router.post('/:id/convert', requireAuth, async (req: Request, res: Response) => {
  try {
    const { accountName, opportunityName, opportunityAmount, closeDate } = req.body;

    const result = await convertLead({
      leadId: req.params.id,
      accountName,
      opportunityName,
      opportunityAmount,
      closeDate,
      userId: req.session.userId!,
    });

    res.json({
      message: 'Lead converted successfully',
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lead conversion failed';
    logger.error({ err }, 'Lead conversion failed');
    res.status(400).json({ error: message });
  }
});

// DELETE /api/leads/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM leads WHERE id = $1 RETURNING id',
      [req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    res.json({ message: 'Lead deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete lead');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
