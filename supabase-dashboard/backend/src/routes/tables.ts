import { Router, Request, Response } from 'express';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { introspectTables, introspectIndexes } from '../services/schemaIntrospector.js';
import { generateCreateTable, generateAddColumn, generateDropColumn, generateRenameColumn, generateDropTable } from '../services/ddlGenerator.js';
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

// GET /api/projects/:projectId/tables
router.get('/:projectId/tables', requireAuth, async (req: Request, res: Response) => {
  try {
    const config = await getProjectConfig(req.params.projectId);
    if (!config) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const tables = await introspectTables(config);
    res.json({ tables });
  } catch (err) {
    logger.error({ err }, 'Failed to introspect tables');
    res.status(500).json({ error: 'Failed to introspect database schema' });
  }
});

// GET /api/projects/:projectId/tables/:tableName/indexes
router.get('/:projectId/tables/:tableName/indexes', requireAuth, async (req: Request, res: Response) => {
  try {
    const config = await getProjectConfig(req.params.projectId);
    if (!config) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const indexes = await introspectIndexes(config, req.params.tableName);
    res.json({ indexes });
  } catch (err) {
    logger.error({ err }, 'Failed to introspect indexes');
    res.status(500).json({ error: 'Failed to introspect indexes' });
  }
});

// POST /api/projects/:projectId/tables
router.post('/:projectId/tables', requireAuth, async (req: Request, res: Response) => {
  try {
    const config = await getProjectConfig(req.params.projectId);
    if (!config) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const { tableName, columns } = req.body;
    if (!tableName || !columns || !Array.isArray(columns) || columns.length === 0) {
      res.status(400).json({ error: 'tableName and columns are required' });
      return;
    }

    const ddl = generateCreateTable(tableName, columns);
    await executeQuery(req.params.projectId, config, ddl);

    res.status(201).json({ message: `Table ${tableName} created`, sql: ddl });
  } catch (err) {
    logger.error({ err }, 'Failed to create table');
    const message = err instanceof Error ? err.message : 'Failed to create table';
    res.status(500).json({ error: message });
  }
});

// PUT /api/projects/:projectId/tables/:tableName
router.put('/:projectId/tables/:tableName', requireAuth, async (req: Request, res: Response) => {
  try {
    const config = await getProjectConfig(req.params.projectId);
    if (!config) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const { action, column, oldName, newName } = req.body;
    let ddl: string;

    switch (action) {
      case 'addColumn':
        if (!column) {
          res.status(400).json({ error: 'column definition is required' });
          return;
        }
        ddl = generateAddColumn(req.params.tableName, column);
        break;
      case 'dropColumn':
        if (!column?.name) {
          res.status(400).json({ error: 'column.name is required' });
          return;
        }
        ddl = generateDropColumn(req.params.tableName, column.name);
        break;
      case 'renameColumn':
        if (!oldName || !newName) {
          res.status(400).json({ error: 'oldName and newName are required' });
          return;
        }
        ddl = generateRenameColumn(req.params.tableName, oldName, newName);
        break;
      default:
        res.status(400).json({ error: 'Invalid action. Use addColumn, dropColumn, or renameColumn' });
        return;
    }

    await executeQuery(req.params.projectId, config, ddl);
    res.json({ message: `Table ${req.params.tableName} altered`, sql: ddl });
  } catch (err) {
    logger.error({ err }, 'Failed to alter table');
    const message = err instanceof Error ? err.message : 'Failed to alter table';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/projects/:projectId/tables/:tableName
router.delete('/:projectId/tables/:tableName', requireAuth, async (req: Request, res: Response) => {
  try {
    const config = await getProjectConfig(req.params.projectId);
    if (!config) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const ddl = generateDropTable(req.params.tableName);
    await executeQuery(req.params.projectId, config, ddl);
    res.json({ message: `Table ${req.params.tableName} dropped`, sql: ddl });
  } catch (err) {
    logger.error({ err }, 'Failed to drop table');
    const message = err instanceof Error ? err.message : 'Failed to drop table';
    res.status(500).json({ error: message });
  }
});

/** Tables router for schema introspection, table creation, alteration, and deletion. */
export default router;
