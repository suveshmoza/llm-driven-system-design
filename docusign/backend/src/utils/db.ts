import pg, { QueryResultRow } from 'pg';

const { Pool } = pg;

/** PostgreSQL connection pool configured for the DocuSign database. */
export const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB || 'docusign',
  user: process.env.POSTGRES_USER || 'docusign',
  password: process.env.POSTGRES_PASSWORD || 'docusign_dev',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/** Tests the database connection by executing a simple query. */
export async function initializeDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

/** Executes a parameterized SQL query and logs slow queries exceeding 100ms. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  const result = await pool.query<T>(text, params);
  const duration = Date.now() - start;
  if (duration > 100) {
    console.log('Slow query:', { text, duration, rows: result.rowCount });
  }
  return result;
}

/** Acquires a dedicated client from the pool for transaction support. */
export async function getClient(): Promise<pg.PoolClient> {
  return await pool.connect();
}
