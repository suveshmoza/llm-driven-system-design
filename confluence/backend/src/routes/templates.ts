import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { pool } from '../services/db.js';
import { logger } from '../services/logger.js';

const router = Router();

// List templates (global + space-specific)
router.get('/', async (req: Request, res: Response) => {
  try {
    const spaceId = req.query.spaceId as string;

    let query = `
      SELECT t.*, u.username as creator_username
      FROM templates t
      JOIN users u ON u.id = t.created_by
      WHERE t.is_global = true
    `;
    const params: string[] = [];

    if (spaceId) {
      query += ' OR t.space_id = $1';
      params.push(spaceId);
    }

    query += ' ORDER BY t.name ASC';

    const result = await pool.query(query, params);
    res.json({ templates: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to list templates');
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

// Get template by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT t.*, u.username as creator_username
       FROM templates t
       JOIN users u ON u.id = t.created_by
       WHERE t.id = $1`,
      [req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    res.json({ template: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to get template');
    res.status(500).json({ error: 'Failed to get template' });
  }
});

// Create template
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, description, contentJson, spaceId, isGlobal } = req.body;

    if (!name || !contentJson) {
      res.status(400).json({ error: 'Name and content are required' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO templates (name, description, content_json, space_id, is_global, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, description || null, JSON.stringify(contentJson), spaceId || null, isGlobal || false, req.session.userId],
    );

    logger.info({ templateId: result.rows[0].id }, 'Template created');
    res.status(201).json({ template: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to create template');
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// Delete template
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query('DELETE FROM templates WHERE id = $1 RETURNING id', [req.params.id]);

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    res.json({ message: 'Template deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete template');
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

export default router;
