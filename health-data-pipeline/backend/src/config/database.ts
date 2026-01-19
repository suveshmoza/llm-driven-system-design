import pg, { Pool as PgPool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from './index.js';

const { Pool } = pg;

export const pool: PgPool = new Pool({
  connectionString: config.database.url,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err: Error) => {
  console.error('Unexpected database error:', err);
});

export interface DbClient {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) => Promise<QueryResult<T>>;
  getClient: () => Promise<PoolClient>;
  transaction: <T>(callback: (client: PoolClient) => Promise<T>) => Promise<T>;
}

export const db: DbClient = {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> =>
    pool.query<T>(text, params),

  getClient: async (): Promise<PoolClient> => {
    const client = await pool.connect();
    return client;
  },

  transaction: async <T>(callback: (client: PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
};

export async function initializeDatabase(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('Database connected:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('Database connection failed:', (error as Error).message);
    return false;
  }
}
