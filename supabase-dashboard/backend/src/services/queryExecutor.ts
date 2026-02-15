import pg from 'pg';
import { logger } from './logger.js';
import { activeConnections } from './metrics.js';

interface ConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

const targetPools = new Map<string, pg.Pool>();

function buildConnectionString(config: ConnectionConfig): string {
  return `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`;
}

/** Returns or creates a cached connection pool for a project's target database. */
export function getTargetPool(projectId: string, config: ConnectionConfig): pg.Pool {
  const existing = targetPools.get(projectId);
  if (existing) {
    return existing;
  }

  const connectionString = buildConnectionString(config);
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    logger.error({ err, projectId }, 'Target pool error');
    targetPools.delete(projectId);
    activeConnections.dec();
  });

  targetPools.set(projectId, pool);
  activeConnections.inc();
  logger.info({ projectId, host: config.host, database: config.database }, 'Target pool created');

  return pool;
}

/** Executes a SQL query against a project's target database using pooled connections. */
export async function executeQuery(
  projectId: string,
  config: ConnectionConfig,
  sql: string,
): Promise<{ rows: Record<string, unknown>[]; fields: { name: string; dataTypeID: number }[]; rowCount: number }> {
  const pool = getTargetPool(projectId, config);
  const result = await pool.query(sql);

  return {
    rows: result.rows,
    fields: result.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
    rowCount: result.rowCount ?? 0,
  };
}

/** Tests database connectivity with a temporary client connection. */
export async function testConnection(config: ConnectionConfig): Promise<{ success: boolean; error?: string }> {
  const connectionString = buildConnectionString(config);
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed';
    return { success: false, error: message };
  } finally {
    await client.end().catch(() => {});
  }
}

/** Closes all cached target database pools during graceful shutdown. */
export async function cleanupTargetPools(): Promise<void> {
  for (const [projectId, pool] of targetPools) {
    try {
      await pool.end();
      logger.info({ projectId }, 'Target pool closed');
    } catch (err) {
      logger.error({ err, projectId }, 'Error closing target pool');
    }
  }
  targetPools.clear();
  activeConnections.set(0);
}

/** Removes and closes a single project's cached target pool when config changes. */
export function removeTargetPool(projectId: string): void {
  const pool = targetPools.get(projectId);
  if (pool) {
    pool.end().catch(() => {});
    targetPools.delete(projectId);
    activeConnections.dec();
  }
}
