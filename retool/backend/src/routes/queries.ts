import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { executeQuery } from '../services/queryExecutor.js';
import { pool } from '../services/db.js';
import { queryLimiter } from '../services/rateLimiter.js';
import { logger } from '../services/logger.js';

const router = Router();

// POST /api/queries/execute - Execute a query against a data source
router.post('/execute', requireAuth, queryLimiter, async (req: Request, res: Response) => {
  try {
    const { dataSourceId, queryText, context, allowWrite } = req.body;

    if (!dataSourceId || !queryText) {
      res.status(400).json({ error: 'dataSourceId and queryText are required' });
      return;
    }

    const result = await executeQuery(
      dataSourceId,
      queryText,
      context || {},
      allowWrite || false,
    );

    if (result.error) {
      res.status(400).json(result);
      return;
    }

    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Query execution failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/queries/saved/:appId - List saved queries for an app
router.get('/saved/:appId', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT sq.*, ds.name AS data_source_name
       FROM saved_queries sq
       LEFT JOIN data_sources ds ON sq.data_source_id = ds.id
       WHERE sq.app_id = $1
       ORDER BY sq.created_at`,
      [req.params.appId],
    );
    res.json({ queries: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to list saved queries');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/queries/saved - Create a saved query
router.post('/saved', requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId, name, dataSourceId, queryText, transformJs, trigger } = req.body;

    if (!appId || !name) {
      res.status(400).json({ error: 'appId and name are required' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO saved_queries (app_id, name, data_source_id, query_text, transform_js, trigger)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [appId, name, dataSourceId || null, queryText || '', transformJs || null, trigger || 'manual'],
    );

    res.status(201).json({ query: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to create saved query');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/queries/saved/:id - Update a saved query
router.put('/saved/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, dataSourceId, queryText, transformJs, trigger } = req.body;

    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (dataSourceId !== undefined) {
      fields.push(`data_source_id = $${paramIndex++}`);
      values.push(dataSourceId);
    }
    if (queryText !== undefined) {
      fields.push(`query_text = $${paramIndex++}`);
      values.push(queryText);
    }
    if (transformJs !== undefined) {
      fields.push(`transform_js = $${paramIndex++}`);
      values.push(transformJs);
    }
    if (trigger !== undefined) {
      fields.push(`trigger = $${paramIndex++}`);
      values.push(trigger);
    }

    if (fields.length === 0) {
      res.status(400).json({ error: 'Nothing to update' });
      return;
    }

    fields.push(`updated_at = NOW()`);
    values.push(req.params.id);

    const result = await pool.query(
      `UPDATE saved_queries SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values,
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Saved query not found' });
      return;
    }

    res.json({ query: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to update saved query');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/queries/saved/:id - Delete a saved query
router.delete('/saved/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM saved_queries WHERE id = $1',
      [req.params.id],
    );

    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'Saved query not found' });
      return;
    }

    res.json({ message: 'Saved query deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete saved query');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
