import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { executeQuery } from '../services/queryExecutor.js';
import { queryLimiter } from '../services/rateLimiter.js';
import { queryExecutionDuration } from '../services/metrics.js';
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

// POST /api/projects/:projectId/sql/execute
router.post('/:projectId/sql/execute', requireAuth, queryLimiter, async (req: Request, res: Response) => {
  try {
    const config = await getProjectConfig(req.params.projectId);
    if (!config) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const { sql } = req.body;

    if (!sql || typeof sql !== 'string') {
      res.status(400).json({ error: 'SQL query string is required' });
      return;
    }

    if (sql.trim().length === 0) {
      res.status(400).json({ error: 'SQL query cannot be empty' });
      return;
    }

    const timer = queryExecutionDuration.startTimer({
      project_id: req.params.projectId,
      query_type: sql.trim().split(/\s+/)[0]?.toUpperCase() || 'UNKNOWN',
    });

    try {
      const result = await executeQuery(req.params.projectId, config, sql);
      timer();

      res.json({
        rows: result.rows,
        fields: result.fields,
        rowCount: result.rowCount,
      });
    } catch (queryErr) {
      timer();
      const message = queryErr instanceof Error ? queryErr.message : 'Query execution failed';
      res.status(400).json({ error: message });
    }
  } catch (err) {
    logger.error({ err }, 'SQL execution error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:projectId/sql/saved
router.get('/:projectId/sql/saved', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT sq.*, u.username AS created_by_username
       FROM saved_queries sq
       LEFT JOIN users u ON u.id = sq.created_by
       WHERE sq.project_id = $1
       ORDER BY sq.updated_at DESC`,
      [req.params.projectId],
    );

    const queries = result.rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      name: r.name,
      queryText: r.query_text,
      createdBy: r.created_by,
      createdByUsername: r.created_by_username,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    res.json({ queries });
  } catch (err) {
    logger.error({ err }, 'Failed to list saved queries');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects/:projectId/sql/saved
router.post('/:projectId/sql/saved', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, queryText } = req.body;

    if (!name || !queryText) {
      res.status(400).json({ error: 'name and queryText are required' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO saved_queries (project_id, name, query_text, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.params.projectId, name, queryText, req.session.userId],
    );

    const r = result.rows[0];
    res.status(201).json({
      query: {
        id: r.id,
        projectId: r.project_id,
        name: r.name,
        queryText: r.query_text,
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to save query');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/projects/:projectId/sql/saved/:queryId
router.put('/:projectId/sql/saved/:queryId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, queryText } = req.body;

    const result = await pool.query(
      `UPDATE saved_queries
       SET name = COALESCE($1, name),
           query_text = COALESCE($2, query_text),
           updated_at = NOW()
       WHERE id = $3 AND project_id = $4
       RETURNING *`,
      [name, queryText, req.params.queryId, req.params.projectId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Saved query not found' });
      return;
    }

    const r = result.rows[0];
    res.json({
      query: {
        id: r.id,
        projectId: r.project_id,
        name: r.name,
        queryText: r.query_text,
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to update saved query');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/projects/:projectId/sql/saved/:queryId
router.delete('/:projectId/sql/saved/:queryId', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM saved_queries WHERE id = $1 AND project_id = $2',
      [req.params.queryId, req.params.projectId],
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

/** SQL router for executing arbitrary queries and managing saved queries per project. */
export default router;
