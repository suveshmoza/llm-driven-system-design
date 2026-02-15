import pg, { Pool, PoolClient, QueryResult } from 'pg';
import config from '../config/index.js';

/** PostgreSQL connection pool with multi-tenant Row-Level Security support via store_id context. */
const pool: Pool = new pg.Pool(config.database);

// Test connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL');
});

pool.on('error', (err: Error) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

/** Executes a SQL query with tenant isolation by setting the RLS store_id context before querying. */
export async function queryWithTenant(
  storeId: number,
  queryText: string,
  params: unknown[] = []
): Promise<QueryResult> {
  const client = await pool.connect();
  try {
    // Set the tenant context for Row-Level Security
    await client.query(`SET app.current_store_id = '${storeId}'`);
    const result = await client.query(queryText, params);
    return result;
  } finally {
    client.release();
  }
}

/** Executes a SQL query without tenant context for platform-wide operations. */
export async function query(queryText: string, params: unknown[] = []): Promise<QueryResult> {
  return pool.query(queryText, params);
}

/** Acquires a pool client with tenant RLS context for multi-statement transactions. */
export async function getClientWithTenant(storeId: number): Promise<PoolClient> {
  const client = await pool.connect();
  await client.query(`SET app.current_store_id = '${storeId}'`);
  return client;
}

export default pool;
