/**
 * Database migration runner for the Google Sheets application.
 * Executes the init.sql file to set up the database schema.
 * Migrations are idempotent and should be run before starting the server.
 *
 * @module db/migrate
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../shared/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Runs the init.sql file to set up the database schema.
 * "Already exists" errors are treated as success (idempotent design).
 */
async function runMigrations() {
  console.log('Running database migrations...');

  const initSqlPath = path.join(__dirname, 'init.sql');

  if (!fs.existsSync(initSqlPath)) {
    console.error(`init.sql not found at ${initSqlPath}`);
    process.exit(1);
  }

  try {
    const sql = fs.readFileSync(initSqlPath, 'utf8');
    console.log('Running: init.sql');
    await pool.query(sql);
    console.log('✓ init.sql completed');
    console.log('\nAll migrations completed successfully!');
  } catch (error) {
    // Ignore "already exists" errors for idempotency
    if ((error as Error).message.includes('already exists')) {
      console.log('⊘ init.sql (already applied)');
      console.log('\nAll migrations completed successfully!');
    } else if ((error as Error).message.includes('duplicate key value')) {
      console.log('⊘ init.sql (seed data already exists)');
      console.log('\nAll migrations completed successfully!');
    } else {
      console.error('Migration failed:', error);
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

runMigrations();
