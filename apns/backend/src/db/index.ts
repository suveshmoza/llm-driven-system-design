import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

/**
 * PostgreSQL connection pool for the APNs backend.
 * Uses a pool to efficiently manage database connections across requests.
 * Configuration is read from DATABASE_URL environment variable.
 */
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://apns:apns_password@localhost:5432/apns",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
});

/**
 * Executes a parameterized SQL query against the database.
 * Automatically logs query timing in development mode.
 *
 * @param text - SQL query string with $1, $2, etc. placeholders
 * @param params - Array of parameter values to substitute
 * @returns Query result with rows typed as T
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  const result = await pool.query<T>(text, params);
  const duration = Date.now() - start;

  if (process.env.NODE_ENV === "development") {
    console.log("Executed query", { text, duration, rows: result.rowCount });
  }

  return result;
}

/**
 * Acquires a dedicated client from the connection pool.
 * Used for transactions or when multiple queries need the same connection.
 * Remember to call client.release() when done.
 *
 * @returns A PoolClient that must be released after use
 */
export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

/**
 * Executes a callback within a database transaction.
 * Automatically handles BEGIN, COMMIT, and ROLLBACK.
 * Releases the client back to the pool when done.
 *
 * @param callback - Async function receiving the transaction client
 * @returns The result of the callback function
 * @throws Re-throws any error after rolling back the transaction
 */
export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Verifies database connectivity by executing a simple query.
 * Used for health checks and startup validation.
 *
 * @returns True if database is reachable, false otherwise
 */
export async function checkConnection(): Promise<boolean> {
  try {
    await query("SELECT 1");
    return true;
  } catch (error) {
    console.error("Database connection failed:", error);
    return false;
  }
}

export default {
  query,
  getClient,
  transaction,
  checkConnection,
  pool,
};
