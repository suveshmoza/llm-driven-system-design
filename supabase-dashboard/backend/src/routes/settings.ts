import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { removeTargetPool } from '../services/queryExecutor.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/projects/:projectId/settings
router.get('/:projectId/settings', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, db_host, db_port, db_name, db_user, created_at, updated_at
       FROM projects
       WHERE id = $1 AND created_by = $2`,
      [req.params.projectId, req.session.userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const r = result.rows[0];
    res.json({
      settings: {
        id: r.id,
        name: r.name,
        description: r.description,
        dbHost: r.db_host,
        dbPort: r.db_port,
        dbName: r.db_name,
        dbUser: r.db_user,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get project settings');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/projects/:projectId/settings
router.put('/:projectId/settings', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, description, dbHost, dbPort, dbName, dbUser, dbPassword } = req.body;

    const result = await pool.query(
      `UPDATE projects
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           db_host = COALESCE($3, db_host),
           db_port = COALESCE($4, db_port),
           db_name = COALESCE($5, db_name),
           db_user = COALESCE($6, db_user),
           db_password = COALESCE($7, db_password),
           updated_at = NOW()
       WHERE id = $8 AND created_by = $9
       RETURNING id, name, description, db_host, db_port, db_name, db_user, created_at, updated_at`,
      [name, description, dbHost, dbPort, dbName, dbUser, dbPassword, req.params.projectId, req.session.userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Remove cached pool since connection config may have changed
    removeTargetPool(req.params.projectId);

    const r = result.rows[0];
    res.json({
      settings: {
        id: r.id,
        name: r.name,
        description: r.description,
        dbHost: r.db_host,
        dbPort: r.db_port,
        dbName: r.db_name,
        dbUser: r.db_user,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to update project settings');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Settings router for reading and updating project database connection configuration. */
export default router;
