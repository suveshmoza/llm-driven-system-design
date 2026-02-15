import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';

const router = Router();

const VALID_STAGES = [
  'Prospecting',
  'Qualification',
  'Needs Analysis',
  'Proposal',
  'Negotiation',
  'Closed Won',
  'Closed Lost',
];

// GET /api/opportunities
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { search, stage, accountId, page = '1', limit = '50' } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    const params: (string | number)[] = [];
    const conditions: string[] = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`o.name ILIKE $${params.length}`);
    }
    if (stage) {
      params.push(stage as string);
      conditions.push(`o.stage = $${params.length}`);
    }
    if (accountId) {
      params.push(accountId as string);
      conditions.push(`o.account_id = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(parseInt(limit as string));
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;

    const result = await pool.query(
      `SELECT o.*, a.name as account_name, u.display_name as owner_name
       FROM opportunities o
       LEFT JOIN accounts a ON o.account_id = a.id
       LEFT JOIN users u ON o.owner_id = u.id
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params,
    );

    const countParams = params.slice(0, params.length - 2);
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM opportunities o ${whereClause}`,
      countParams,
    );

    res.json({
      opportunities: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page as string),
      limit: parseInt(limit as string),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch opportunities');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/opportunities/:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT o.*, a.name as account_name, u.display_name as owner_name
       FROM opportunities o
       LEFT JOIN accounts a ON o.account_id = a.id
       LEFT JOIN users u ON o.owner_id = u.id
       WHERE o.id = $1`,
      [req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Opportunity not found' });
      return;
    }

    res.json({ opportunity: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch opportunity');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/opportunities
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, accountId, amountCents, stage, probability, closeDate, description } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Opportunity name is required' });
      return;
    }

    const oppStage = stage || 'Prospecting';
    if (!VALID_STAGES.includes(oppStage)) {
      res.status(400).json({ error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` });
      return;
    }

    const result = await pool.query(
      `INSERT INTO opportunities (name, account_id, amount_cents, stage, probability, close_date, description, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [name, accountId, amountCents, oppStage, probability || 10, closeDate, description, req.session.userId],
    );

    res.status(201).json({ opportunity: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to create opportunity');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/opportunities/:id
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, accountId, amountCents, stage, probability, closeDate, description } = req.body;

    if (stage && !VALID_STAGES.includes(stage)) {
      res.status(400).json({ error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` });
      return;
    }

    const result = await pool.query(
      `UPDATE opportunities
       SET name = COALESCE($1, name),
           account_id = COALESCE($2, account_id),
           amount_cents = COALESCE($3, amount_cents),
           stage = COALESCE($4, stage),
           probability = COALESCE($5, probability),
           close_date = COALESCE($6, close_date),
           description = COALESCE($7, description),
           updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [name, accountId, amountCents, stage, probability, closeDate, description, req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Opportunity not found' });
      return;
    }

    res.json({ opportunity: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to update opportunity');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/opportunities/:id/stage - Kanban drag-drop stage update
router.put('/:id/stage', requireAuth, async (req: Request, res: Response) => {
  try {
    const { stage } = req.body;

    if (!stage || !VALID_STAGES.includes(stage)) {
      res.status(400).json({ error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` });
      return;
    }

    // Map stage to probability
    const probabilityMap: Record<string, number> = {
      'Prospecting': 10,
      'Qualification': 20,
      'Needs Analysis': 40,
      'Proposal': 60,
      'Negotiation': 80,
      'Closed Won': 100,
      'Closed Lost': 0,
    };

    const result = await pool.query(
      `UPDATE opportunities
       SET stage = $1, probability = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [stage, probabilityMap[stage], req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Opportunity not found' });
      return;
    }

    res.json({ opportunity: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to update opportunity stage');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/opportunities/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM opportunities WHERE id = $1 RETURNING id',
      [req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Opportunity not found' });
      return;
    }

    res.json({ message: 'Opportunity deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete opportunity');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
