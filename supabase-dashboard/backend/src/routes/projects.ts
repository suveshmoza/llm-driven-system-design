import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { testConnection } from '../services/queryExecutor.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/projects
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT p.*, pm.role AS member_role
       FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
       WHERE p.created_by = $1 OR pm.user_id = $1
       ORDER BY p.created_at DESC`,
      [req.session.userId],
    );

    const projects = result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      dbHost: r.db_host,
      dbPort: r.db_port,
      dbName: r.db_name,
      dbUser: r.db_user,
      createdBy: r.created_by,
      memberRole: r.member_role || 'owner',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    res.json({ projects });
  } catch (err) {
    logger.error({ err }, 'Failed to list projects');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT p.*
       FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
       WHERE p.id = $1 AND (p.created_by = $2 OR pm.user_id = $2)`,
      [req.params.id, req.session.userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const r = result.rows[0];
    res.json({
      project: {
        id: r.id,
        name: r.name,
        description: r.description,
        dbHost: r.db_host,
        dbPort: r.db_port,
        dbName: r.db_name,
        dbUser: r.db_user,
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get project');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, description, dbHost, dbPort, dbName, dbUser, dbPassword } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Project name is required' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO projects (name, description, db_host, db_port, db_name, db_user, db_password, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        name,
        description || null,
        dbHost || 'localhost',
        dbPort || 5433,
        dbName || 'sample_db',
        dbUser || 'sample',
        dbPassword || 'sample123',
        req.session.userId,
      ],
    );

    const r = result.rows[0];
    res.status(201).json({
      project: {
        id: r.id,
        name: r.name,
        description: r.description,
        dbHost: r.db_host,
        dbPort: r.db_port,
        dbName: r.db_name,
        dbUser: r.db_user,
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to create project');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/projects/:id
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
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
       RETURNING *`,
      [name, description, dbHost, dbPort, dbName, dbUser, dbPassword, req.params.id, req.session.userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const r = result.rows[0];
    res.json({
      project: {
        id: r.id,
        name: r.name,
        description: r.description,
        dbHost: r.db_host,
        dbPort: r.db_port,
        dbName: r.db_name,
        dbUser: r.db_user,
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to update project');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/projects/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM projects WHERE id = $1 AND created_by = $2',
      [req.params.id, req.session.userId],
    );

    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({ message: 'Project deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete project');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects/:id/test-connection
router.post('/:id/test-connection', requireAuth, async (req: Request, res: Response) => {
  try {
    const project = await pool.query(
      'SELECT * FROM projects WHERE id = $1',
      [req.params.id],
    );

    if (project.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const p = project.rows[0];
    const result = await testConnection({
      host: p.db_host,
      port: p.db_port,
      database: p.db_name,
      user: p.db_user,
      password: p.db_password,
    });

    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Connection test failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id/members
router.get('/:id/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT pm.*, u.username, u.email, u.display_name
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1
       ORDER BY pm.joined_at`,
      [req.params.id],
    );

    const members = result.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username,
      email: r.email,
      displayName: r.display_name,
      role: r.role,
      joinedAt: r.joined_at,
    }));

    res.json({ members });
  } catch (err) {
    logger.error({ err }, 'Failed to list members');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects/:id/members
router.post('/:id/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId, role } = req.body;

    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = $3
       RETURNING *`,
      [req.params.id, userId, role || 'editor'],
    );

    res.status(201).json({ member: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to add member');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/projects/:id/members/:userId
router.delete('/:id/members/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query(
      'DELETE FROM project_members WHERE project_id = $1 AND user_id = $2',
      [req.params.id, req.params.userId],
    );
    res.json({ message: 'Member removed' });
  } catch (err) {
    logger.error({ err }, 'Failed to remove member');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Projects router for CRUD, connection testing, and member management. */
export default router;
