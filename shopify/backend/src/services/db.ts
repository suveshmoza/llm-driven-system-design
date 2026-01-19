import pg, { Pool, PoolClient, QueryResult } from 'pg';
import config from '../config/index.js';

// Main pool for general queries
const pool: Pool = new pg.Pool(config.database);

// Test connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL');
});

pool.on('error', (err: Error) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Execute a query with tenant context set
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

// Execute a query without tenant context (for platform operations)
export async function query(queryText: string, params: unknown[] = []): Promise<QueryResult> {
  return pool.query(queryText, params);
}

// Get a client with tenant context set (for transactions)
export async function getClientWithTenant(storeId: number): Promise<PoolClient> {
  const client = await pool.connect();
  await client.query(`SET app.current_store_id = '${storeId}'`);
  return client;
}

export default pool;
