import pg, { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import config from '../config/index.js';

/** PostgreSQL connection pool for the Uber ride-hailing service data. */
const pool: Pool = new pg.Pool({
  connectionString: config.database.url,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err: Error): void => {
  console.error('Unexpected database error:', err);
});

/** Executes a parameterized SQL query against the connection pool. */
export const query = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> => pool.query<T>(text, params);

/** Acquires a pool client for multi-statement transactions. */
export const getClient = (): Promise<PoolClient> => pool.connect();

export default pool;
