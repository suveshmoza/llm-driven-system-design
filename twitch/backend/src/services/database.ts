import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://twitch:twitch_dev_password@localhost:5432/twitch_db',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/** Verifies PostgreSQL connectivity by executing a test query. */
async function initDatabase(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('SELECT NOW()');
    return true;
  } finally {
    client.release();
  }
}

/** Executes a parameterized SQL query against the connection pool with slow-query logging. */
async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  const result = await pool.query<T>(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development' && duration > 100) {
    console.log('Slow query:', { text, duration, rows: result.rowCount });
  }
  return result;
}

/** Acquires a dedicated client from the connection pool for transaction use. */
async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

export {
  initDatabase,
  query,
  getClient,
  pool
};
