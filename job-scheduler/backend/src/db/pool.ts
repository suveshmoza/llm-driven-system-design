/**
 * PostgreSQL connection pool module.
 * Provides database connectivity with connection pooling for efficient query execution.
 * Used by all database operations in the job scheduler.
 * @module db/pool
 */

import { Pool, PoolConfig } from 'pg';
import { logger } from '../utils/logger';

/** Pool configuration with sensible defaults for the job scheduler workload */
const poolConfig: PoolConfig = {
  connectionString: process.env.DATABASE_URL || 'postgres://scheduler:scheduler@localhost:5432/job_scheduler',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

/**
 * PostgreSQL connection pool instance.
 * Manages a pool of reusable database connections for concurrent operations.
 */
export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
});

pool.on('connect', () => {
  logger.debug('New client connected to PostgreSQL');
});

/**
 * Executes a SQL query and returns the result rows.
 * Logs query duration for performance monitoring.
 *
 * @description Executes a parameterized SQL query against the PostgreSQL database
 * and returns all matching rows. Query execution time is logged for performance analysis.
 *
 * @template T - The expected row type for the query results
 * @param {string} text - SQL query string with optional $1, $2, etc. placeholders
 * @param {unknown[]} [params] - Parameter values to substitute into the query placeholders
 * @returns {Promise<T[]>} Array of result rows typed as T
 * @throws {Error} Database errors are logged and re-thrown to the caller
 *
 * @example
 * // Simple query
 * const jobs = await query<Job>('SELECT * FROM jobs WHERE status = $1', ['SCHEDULED']);
 *
 * @example
 * // Query with multiple parameters
 * const executions = await query<JobExecution>(
 *   'SELECT * FROM job_executions WHERE job_id = $1 AND status = $2',
 *   [jobId, 'COMPLETED']
 * );
 */
export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug(`Query executed in ${duration}ms`, { text: text.substring(0, 100), rowCount: result.rowCount });
    return result.rows as T[];
  } catch (error) {
    logger.error('Database query error', { text: text.substring(0, 100), error });
    throw error;
  }
}

/**
 * Executes a SQL query and returns the first row or null.
 *
 * @description Convenience wrapper for queries expected to return a single row.
 * Useful for lookups by primary key or unique constraints.
 *
 * @template T - The expected row type for the query result
 * @param {string} text - SQL query string with optional placeholders
 * @param {unknown[]} [params] - Parameter values to substitute into the query
 * @returns {Promise<T | null>} First result row or null if no rows returned
 * @throws {Error} Database errors are logged and re-thrown to the caller
 *
 * @example
 * // Lookup by primary key
 * const job = await queryOne<Job>('SELECT * FROM jobs WHERE id = $1', [jobId]);
 * if (job) {
 *   console.log(job.name);
 * }
 *
 * @example
 * // Lookup by unique constraint
 * const user = await queryOne<User>('SELECT * FROM users WHERE username = $1', ['admin']);
 */
export async function queryOne<T>(text: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

/**
 * Executes a callback within a database transaction.
 *
 * @description Wraps multiple database operations in a transaction, automatically
 * handling BEGIN, COMMIT, and ROLLBACK. Ensures atomicity for multi-statement
 * operations like creating a job with its initial execution record.
 *
 * @template T - The return type of the callback function
 * @param {(client: { query: typeof query }) => Promise<T>} callback - Function receiving
 *   a query interface to execute operations within the transaction context
 * @returns {Promise<T>} Result from the callback function
 * @throws {Error} Rolls back transaction and re-throws any errors from the callback
 *
 * @example
 * // Create job and initial execution atomically
 * const result = await transaction(async (client) => {
 *   const [job] = await client.query<Job>(
 *     'INSERT INTO jobs (name, handler) VALUES ($1, $2) RETURNING *',
 *     ['my-job', 'http.webhook']
 *   );
 *   const [execution] = await client.query<JobExecution>(
 *     'INSERT INTO job_executions (job_id, status) VALUES ($1, $2) RETURNING *',
 *     [job.id, 'PENDING']
 *   );
 *   return { job, execution };
 * });
 */
export async function transaction<T>(
  callback: (client: { query: typeof query }) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const clientQuery = async <R>(text: string, params?: unknown[]): Promise<R[]> => {
      const result = await client.query(text, params);
      return result.rows as R[];
    };
    const result = await callback({ query: clientQuery });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Checks if the database connection is healthy.
 *
 * @description Used by health check endpoints to verify database availability.
 * Executes a simple query to validate the connection pool is functional.
 *
 * @returns {Promise<boolean>} True if the database is reachable, false otherwise
 *
 * @example
 * // Health check endpoint
 * app.get('/health', async (req, res) => {
 *   const dbHealthy = await healthCheck();
 *   res.json({ database: dbHealthy ? 'healthy' : 'unhealthy' });
 * });
 */
export async function healthCheck(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
