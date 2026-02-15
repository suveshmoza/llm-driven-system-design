import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from './logger.js';

/** PostgreSQL connection pool for the PayPal metadata database. */
export const pool = new pg.Pool({
  connectionString: config.database.url,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected pool error');
});

pool.on('connect', () => {
  logger.debug('New database connection established');
});
