import { Pool, QueryResult, QueryResultRow } from 'pg';
import config from '../config/index.js';

const pool = new Pool(config.database);

pool.on('connect', (): void => {
  console.log('Connected to PostgreSQL');
});

pool.on('error', (err: Error): void => {
  console.error('PostgreSQL pool error:', err);
});

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export { pool };
