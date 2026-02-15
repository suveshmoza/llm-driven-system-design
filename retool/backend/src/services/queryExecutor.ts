import pg from 'pg';
import { pool } from './db.js';
import { resolveBindings } from './bindingEngine.js';
import { logger } from './logger.js';
import { queryExecutionDuration } from './metrics.js';

interface QueryResult {
  rows: Record<string, unknown>[];
  fields: { name: string; dataType: string }[];
  rowCount: number;
  error?: string;
}

interface DataSourceConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

// Cache target DB pools by data source ID to avoid creating new connections per query
const targetPools = new Map<string, pg.Pool>();

function getTargetPool(dataSourceId: string, config: DataSourceConfig): pg.Pool {
  const existing = targetPools.get(dataSourceId);
  if (existing) return existing;

  const targetPool = new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: 5,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 10000,
  });

  targetPool.on('error', (err) => {
    logger.error({ err, dataSourceId }, 'Target pool error');
    targetPools.delete(dataSourceId);
  });

  targetPools.set(dataSourceId, targetPool);
  return targetPool;
}

async function getDataSourceConfig(
  dataSourceId: string,
): Promise<{ type: string; config: DataSourceConfig } | null> {
  const result = await pool.query(
    'SELECT type, config FROM data_sources WHERE id = $1',
    [dataSourceId],
  );
  if (result.rows.length === 0) return null;
  return {
    type: result.rows[0].type,
    config: result.rows[0].config as DataSourceConfig,
  };
}

/**
 * Determine the pg type OID name from OID number.
 */
function oidToTypeName(oid: number): string {
  const typeMap: Record<number, string> = {
    16: 'boolean',
    20: 'bigint',
    21: 'smallint',
    23: 'integer',
    25: 'text',
    700: 'float4',
    701: 'float8',
    1043: 'varchar',
    1082: 'date',
    1114: 'timestamp',
    1184: 'timestamptz',
    1700: 'numeric',
    2950: 'uuid',
    3802: 'jsonb',
    114: 'json',
  };
  return typeMap[oid] || 'text';
}

/** Executes a data source query with binding resolution and caches the result. */
export async function executeQuery(
  dataSourceId: string,
  queryText: string,
  context: Record<string, unknown> = {},
  allowWrite = false,
): Promise<QueryResult> {
  const timer = queryExecutionDuration.startTimer({ data_source_type: 'postgresql' });

  try {
    const dataSource = await getDataSourceConfig(dataSourceId);
    if (!dataSource) {
      return {
        rows: [],
        fields: [],
        rowCount: 0,
        error: 'Data source not found',
      };
    }

    if (dataSource.type !== 'postgresql') {
      return {
        rows: [],
        fields: [],
        rowCount: 0,
        error: `Unsupported data source type: ${dataSource.type}`,
      };
    }

    // Resolve bindings in the query text
    const resolvedQuery = resolveBindings(queryText, context);

    // Safety check: only allow SELECT unless allowWrite is true
    if (!allowWrite) {
      const trimmed = resolvedQuery.trim().toUpperCase();
      if (
        !trimmed.startsWith('SELECT') &&
        !trimmed.startsWith('WITH') &&
        !trimmed.startsWith('EXPLAIN')
      ) {
        return {
          rows: [],
          fields: [],
          rowCount: 0,
          error: 'Only SELECT, WITH, and EXPLAIN queries are allowed in read-only mode',
        };
      }
    }

    const targetPool = getTargetPool(dataSourceId, dataSource.config);
    const result = await targetPool.query(resolvedQuery);

    const fields = (result.fields || []).map((f) => ({
      name: f.name,
      dataType: oidToTypeName(f.dataTypeID),
    }));

    timer({ data_source_type: 'postgresql' });

    return {
      rows: result.rows,
      fields,
      rowCount: result.rowCount ?? 0,
    };
  } catch (err) {
    timer({ data_source_type: 'postgresql' });
    const message = err instanceof Error ? err.message : 'Unknown query error';
    logger.error({ err, dataSourceId }, 'Query execution failed');
    return {
      rows: [],
      fields: [],
      rowCount: 0,
      error: message,
    };
  }
}

/**
 * Test a data source connection.
 */
export async function testConnection(
  config: DataSourceConfig,
): Promise<{ success: boolean; error?: string }> {
  const client = new pg.Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionTimeoutMillis: 5000,
  });

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

/**
 * Clean up all cached target pools on shutdown.
 */
export async function cleanupTargetPools(): Promise<void> {
  for (const [id, targetPool] of targetPools) {
    await targetPool.end().catch(() => {});
    targetPools.delete(id);
  }
}
