import pg from 'pg';

const { Pool } = pg;

/** PostgreSQL connection pool for the plugin platform database. */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://plugin_user:plugin_pass@localhost:5432/plugin_platform',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error:', err);
});

/** Executes a parameterized SQL query against the connection pool. */
export async function query<T extends pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

/** Acquires a client from the pool for multi-statement transactions. */
export async function getClient(): Promise<pg.PoolClient> {
  return pool.connect();
}
