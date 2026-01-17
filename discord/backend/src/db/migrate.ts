/**
 * Database Migration Script
 *
 * Initializes the Baby Discord database schema by running the SQL definitions
 * from init.sql. This script should be run once before starting the application
 * for the first time, or when the schema needs to be reset.
 *
 * Usage: npm run db:migrate
 *
 * The script connects to PostgreSQL using DATABASE_URL environment variable
 * or defaults to local development credentials.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Run database migrations.
 * Reads and executes the init.sql file to create tables, indexes, and functions.
 * Exits with code 1 on failure.
 */
async function migrate() {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      'postgresql://discord:discord@localhost:5432/babydiscord',
  });

  try {
    console.log('Running database migrations...');

    const initSql = readFileSync(join(__dirname, 'init.sql'), 'utf-8');
    await pool.query(initSql);

    console.log('Database migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
