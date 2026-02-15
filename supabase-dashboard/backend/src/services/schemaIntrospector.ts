import pg from 'pg';
import { logger } from './logger.js';

interface ConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface TableInfo {
  tableName: string;
  schema: string;
  columns: ColumnInfo[];
  rowCount?: number;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  columnDefault: string | null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  foreignKeyRef?: string;
  ordinalPosition: number;
}

export interface IndexInfo {
  indexName: string;
  tableName: string;
  indexDef: string;
}

function buildConnectionString(config: ConnectionConfig): string {
  return `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`;
}

/** Introspects all public tables with columns, primary keys, foreign keys, and row count estimates. */
export async function introspectTables(config: ConnectionConfig): Promise<TableInfo[]> {
  const client = new pg.Client({
    connectionString: buildConnectionString(config),
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();

    // Get all user tables
    const tablesResult = await client.query(`
      SELECT table_name, table_schema
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const tables: TableInfo[] = [];

    for (const row of tablesResult.rows) {
      const tableName = row.table_name;
      const schema = row.table_schema;

      // Get columns
      const columnsResult = await client.query(`
        SELECT
          c.column_name,
          c.data_type,
          c.is_nullable,
          c.column_default,
          c.ordinal_position
        FROM information_schema.columns c
        WHERE c.table_schema = $1 AND c.table_name = $2
        ORDER BY c.ordinal_position
      `, [schema, tableName]);

      // Get primary keys
      const pkResult = await client.query(`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = $1
          AND tc.table_name = $2
      `, [schema, tableName]);
      const pkColumns = new Set(pkResult.rows.map((r: { column_name: string }) => r.column_name));

      // Get foreign keys
      const fkResult = await client.query(`
        SELECT
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = $1
          AND tc.table_name = $2
      `, [schema, tableName]);
      const fkMap = new Map<string, string>();
      for (const fk of fkResult.rows) {
        fkMap.set(fk.column_name, `${fk.foreign_table_name}.${fk.foreign_column_name}`);
      }

      // Get row count estimate
      const countResult = await client.query(`
        SELECT reltuples::bigint AS estimate
        FROM pg_class
        WHERE relname = $1
      `, [tableName]);
      const rowCount = countResult.rows[0]?.estimate ?? 0;

      const columns: ColumnInfo[] = columnsResult.rows.map((col: {
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
        ordinal_position: number;
      }) => ({
        name: col.column_name,
        dataType: col.data_type,
        isNullable: col.is_nullable === 'YES',
        columnDefault: col.column_default,
        isPrimaryKey: pkColumns.has(col.column_name),
        isForeignKey: fkMap.has(col.column_name),
        foreignKeyRef: fkMap.get(col.column_name),
        ordinalPosition: col.ordinal_position,
      }));

      tables.push({ tableName, schema, columns, rowCount: Math.max(0, Number(rowCount)) });
    }

    return tables;
  } catch (err) {
    logger.error({ err }, 'Schema introspection failed');
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
}

/** Retrieves all indexes for a specific table from pg_indexes. */
export async function introspectIndexes(config: ConnectionConfig, tableName: string): Promise<IndexInfo[]> {
  const client = new pg.Client({
    connectionString: buildConnectionString(config),
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    const result = await client.query(`
      SELECT indexname AS index_name, tablename AS table_name, indexdef AS index_def
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = $1
      ORDER BY indexname
    `, [tableName]);

    return result.rows.map((r: { index_name: string; table_name: string; index_def: string }) => ({
      indexName: r.index_name,
      tableName: r.table_name,
      indexDef: r.index_def,
    }));
  } finally {
    await client.end().catch(() => {});
  }
}
