import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { pool } from '../services/db.js';
import { testConnection } from '../services/queryExecutor.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/datasources - List user's data sources
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, type, config, created_at, updated_at FROM data_sources WHERE owner_id = $1 ORDER BY created_at DESC',
      [req.session.userId],
    );

    // Mask passwords in response
    const dataSources = result.rows.map((ds) => ({
      ...ds,
      config: {
        ...ds.config,
        password: ds.config.password ? '********' : undefined,
      },
    }));

    res.json({ dataSources });
  } catch (err) {
    logger.error({ err }, 'Failed to list data sources');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/datasources/:id - Get data source by ID
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, type, config, created_at, updated_at FROM data_sources WHERE id = $1 AND owner_id = $2',
      [req.params.id, req.session.userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Data source not found' });
      return;
    }

    const ds = result.rows[0];
    res.json({
      dataSource: {
        ...ds,
        config: {
          ...ds.config,
          password: ds.config.password ? '********' : undefined,
        },
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get data source');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/datasources - Create data source
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, type, config } = req.body;

    if (!name || !type || !config) {
      res.status(400).json({ error: 'Name, type, and config are required' });
      return;
    }

    if (!['postgresql', 'rest_api'].includes(type)) {
      res.status(400).json({ error: 'Type must be postgresql or rest_api' });
      return;
    }

    if (type === 'postgresql') {
      if (!config.host || !config.port || !config.database || !config.user) {
        res.status(400).json({ error: 'PostgreSQL config requires host, port, database, and user' });
        return;
      }
    }

    const result = await pool.query(
      `INSERT INTO data_sources (name, type, config, owner_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, type, created_at, updated_at`,
      [name, type, JSON.stringify(config), req.session.userId],
    );

    res.status(201).json({ dataSource: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to create data source');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/datasources/:id - Update data source
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, config } = req.body;

    const existing = await pool.query(
      'SELECT id FROM data_sources WHERE id = $1 AND owner_id = $2',
      [req.params.id, req.session.userId],
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Data source not found' });
      return;
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (name) {
      fields.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (config) {
      fields.push(`config = $${paramIndex++}`);
      values.push(JSON.stringify(config));
    }

    if (fields.length === 0) {
      res.status(400).json({ error: 'Nothing to update' });
      return;
    }

    fields.push(`updated_at = NOW()`);
    values.push(req.params.id);

    const result = await pool.query(
      `UPDATE data_sources SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING id, name, type, created_at, updated_at`,
      values,
    );

    res.json({ dataSource: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to update data source');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/datasources/:id - Delete data source
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM data_sources WHERE id = $1 AND owner_id = $2',
      [req.params.id, req.session.userId],
    );

    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'Data source not found' });
      return;
    }

    res.json({ message: 'Data source deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete data source');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/datasources/:id/test - Test data source connection
router.post('/:id/test', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT config FROM data_sources WHERE id = $1 AND owner_id = $2',
      [req.params.id, req.session.userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Data source not found' });
      return;
    }

    const testResult = await testConnection(result.rows[0].config);
    res.json(testResult);
  } catch (err) {
    logger.error({ err }, 'Failed to test data source');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
