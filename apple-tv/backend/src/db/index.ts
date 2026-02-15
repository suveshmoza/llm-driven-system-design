import { Pool, QueryResult, QueryResultRow } from 'pg';
import config from '../config/index.js';

/** PostgreSQL connection pool for the Apple TV+ content catalog and user data. */
const pool = new Pool(config.database);

pool.on('connect', (): void => {
  console.log('Connected to PostgreSQL');
});

pool.on('error', (err: Error): void => {
  console.error('PostgreSQL pool error:', err);
});

/** Executes a parameterized SQL query against the PostgreSQL pool. */
export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export { pool };
