import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';

const router = Router();

const VALID_TYPES = ['call', 'email', 'meeting', 'note'];
const VALID_RELATED_TYPES = ['account', 'contact', 'opportunity', 'lead'];

// GET /api/activities
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { relatedType, relatedId, completed, page = '1', limit = '20' } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    const params: (string | number | boolean)[] = [];
    const conditions: string[] = [];

    if (relatedType && relatedId) {
      params.push(relatedType as string);
      conditions.push(`related_type = $${params.length}`);
      params.push(relatedId as string);
      conditions.push(`related_id = $${params.length}`);
    }

    if (completed !== undefined) {
      params.push(completed === 'true');
      conditions.push(`completed = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(parseInt(limit as string));
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;

    const result = await pool.query(
      `SELECT a.*, u.display_name as owner_name
       FROM activities a
       LEFT JOIN users u ON a.owner_id = u.id
       ${whereClause}
       ORDER BY a.due_date ASC NULLS LAST, a.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params,
    );

    const countParams = params.slice(0, params.length - 2);
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM activities a ${whereClause}`,
      countParams,
    );

    res.json({
      activities: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page as string),
      limit: parseInt(limit as string),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch activities');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/activities/:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT a.*, u.display_name as owner_name
       FROM activities a
       LEFT JOIN users u ON a.owner_id = u.id
       WHERE a.id = $1`,
      [req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Activity not found' });
      return;
    }

    res.json({ activity: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch activity');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/activities
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { type, subject, description, dueDate, relatedType, relatedId } = req.body;

    if (!type || !subject) {
      res.status(400).json({ error: 'Type and subject are required' });
      return;
    }

    if (!VALID_TYPES.includes(type)) {
      res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
      return;
    }

    if (relatedType && !VALID_RELATED_TYPES.includes(relatedType)) {
      res.status(400).json({ error: `Invalid related type. Must be one of: ${VALID_RELATED_TYPES.join(', ')}` });
      return;
    }

    const result = await pool.query(
      `INSERT INTO activities (type, subject, description, due_date, related_type, related_id, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [type, subject, description, dueDate, relatedType, relatedId, req.session.userId],
    );

    res.status(201).json({ activity: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to create activity');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/activities/:id
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { type, subject, description, dueDate, completed, relatedType, relatedId } = req.body;

    if (type && !VALID_TYPES.includes(type)) {
      res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
      return;
    }

    const result = await pool.query(
      `UPDATE activities
       SET type = COALESCE($1, type),
           subject = COALESCE($2, subject),
           description = COALESCE($3, description),
           due_date = COALESCE($4, due_date),
           completed = COALESCE($5, completed),
           related_type = COALESCE($6, related_type),
           related_id = COALESCE($7, related_id)
       WHERE id = $8
       RETURNING *`,
      [type, subject, description, dueDate, completed, relatedType, relatedId, req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Activity not found' });
      return;
    }

    res.json({ activity: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to update activity');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/activities/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM activities WHERE id = $1 RETURNING id',
      [req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Activity not found' });
      return;
    }

    res.json({ message: 'Activity deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete activity');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
