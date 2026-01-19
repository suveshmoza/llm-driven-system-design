import pg, { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import config from '../config.js';

const { Pool: PgPool } = pg;

const pool: Pool = new PgPool({
  connectionString: config.database.url,
});

pool.on('error', (err: Error) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export interface Database {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) => Promise<QueryResult<T>>;
  getClient: () => Promise<PoolClient>;
  pool: Pool;
}

const db: Database = {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> =>
    pool.query<T>(text, params),
  getClient: (): Promise<PoolClient> => pool.connect(),
  pool,
};

export default db;
