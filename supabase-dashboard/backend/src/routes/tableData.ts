import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { executeQuery } from '../services/queryExecutor.js';
import { logger } from '../services/logger.js';

const router = Router();

async function getProjectConfig(projectId: string) {
  const result = await pool.query(
    'SELECT db_host, db_port, db_name, db_user, db_password FROM projects WHERE id = $1',
    [projectId],
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return { host: r.db_host, port: r.db_port, database: r.db_name, user: r.db_user, password: r.db_password };
}

function sanitizeIdentifier(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '');
}

// GET /api/projects/:projectId/tables/:tableName/rows
router.get('/:projectId/tables/:tableName/rows', requireAuth, async (req: Request, res: Response) => {
  try {
    const config = await getProjectConfig(req.params.projectId);
    if (!config) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const tableName = sanitizeIdentifier(req.params.tableName);
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy ? sanitizeIdentifier(req.query.sortBy as string) : null;
    const sortOrder = req.query.sortOrder === 'desc' ? 'DESC' : 'ASC';

    // Get total count
    const countResult = await executeQuery(
      req.params.projectId,
      config,
      `SELECT COUNT(*) AS total FROM ${tableName}`,
    );
    const total = parseInt(countResult.rows[0]?.total as string) || 0;

    // Get rows
    const orderClause = sortBy ? `ORDER BY ${sortBy} ${sortOrder}` : '';
    const result = await executeQuery(
      req.params.projectId,
      config,
      `SELECT * FROM ${tableName} ${orderClause} LIMIT ${limit} OFFSET ${offset}`,
    );

    res.json({
      rows: result.rows,
      fields: result.fields,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch table data');
    const message = err instanceof Error ? err.message : 'Failed to fetch table data';
    res.status(500).json({ error: message });
  }
});

// POST /api/projects/:projectId/tables/:tableName/rows
router.post('/:projectId/tables/:tableName/rows', requireAuth, async (req: Request, res: Response) => {
  try {
    const config = await getProjectConfig(req.params.projectId);
    if (!config) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const tableName = sanitizeIdentifier(req.params.tableName);
    const { data } = req.body;

    if (!data || typeof data !== 'object') {
      res.status(400).json({ error: 'data object is required' });
      return;
    }

    const keys = Object.keys(data).map(sanitizeIdentifier);
    const values = Object.values(data);
    const placeholders = values.map((_, i) => `'${String(_).replace(/'/g, "''")}'`);

    const sql = `INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
    const result = await executeQuery(req.params.projectId, config, sql);

    res.status(201).json({ row: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to insert row');
    const message = err instanceof Error ? err.message : 'Failed to insert row';
    res.status(500).json({ error: message });
  }
});

// PUT /api/projects/:projectId/tables/:tableName/rows/:id
router.put('/:projectId/tables/:tableName/rows/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const config = await getProjectConfig(req.params.projectId);
    if (!config) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const tableName = sanitizeIdentifier(req.params.tableName);
    const { data, primaryKey } = req.body;

    if (!data || typeof data !== 'object') {
      res.status(400).json({ error: 'data object is required' });
      return;
    }

    const pkColumn = sanitizeIdentifier(primaryKey || 'id');
    const setClauses = Object.entries(data)
      .map(([key, value]) => `${sanitizeIdentifier(key)} = '${String(value).replace(/'/g, "''")}'`)
      .join(', ');

    const sql = `UPDATE ${tableName} SET ${setClauses} WHERE ${pkColumn} = '${String(req.params.id).replace(/'/g, "''")}' RETURNING *`;
    const result = await executeQuery(req.params.projectId, config, sql);

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Row not found' });
      return;
    }

    res.json({ row: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to update row');
    const message = err instanceof Error ? err.message : 'Failed to update row';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/projects/:projectId/tables/:tableName/rows/:id
router.delete('/:projectId/tables/:tableName/rows/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const config = await getProjectConfig(req.params.projectId);
    if (!config) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const tableName = sanitizeIdentifier(req.params.tableName);
    const primaryKey = sanitizeIdentifier((req.query.primaryKey as string) || 'id');

    const sql = `DELETE FROM ${tableName} WHERE ${primaryKey} = '${String(req.params.id).replace(/'/g, "''")}' RETURNING *`;
    const result = await executeQuery(req.params.projectId, config, sql);

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Row not found' });
      return;
    }

    res.json({ message: 'Row deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete row');
    const message = err instanceof Error ? err.message : 'Failed to delete row';
    res.status(500).json({ error: message });
  }
});

/** Table data router for paginated row queries, inserts, updates, and deletes. */
export default router;
