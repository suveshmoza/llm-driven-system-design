import pg, { PoolClient, QueryResult } from 'pg';
import { config } from '../config/index.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: config.database.url,
});

pool.on('error', (err: Error) => {
  console.error('Unexpected error on idle client', err);
});

/** Executes a parameterized SQL query against the connection pool with optional development logging. */
export const query = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> => {
  const start = Date.now();
  const res = await pool.query<T>(text, params);
  const duration = Date.now() - start;
  if (config.nodeEnv === 'development') {
    console.log('Executed query', { text: text.substring(0, 50), duration, rows: res.rowCount });
  }
  return res;
};

/** Acquires a client from the pool for multi-statement transactions. */
export const getClient = async (): Promise<PoolClient> => {
  return await pool.connect();
};

/** Closes all connections in the pool for graceful shutdown. */
export const end = async (): Promise<void> => {
  await pool.end();
};

/** Aggregated database access object exposing query, getClient, pool, and end. */
export const db = {
  query,
  getClient,
  pool,
  end,
};
