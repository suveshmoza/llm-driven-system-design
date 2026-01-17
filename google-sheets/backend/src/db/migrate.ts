/**
 * Database migration runner for the Google Sheets application.
 * Executes SQL migration files in sorted order to set up the schema.
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
 * Runs all SQL migration files from the migrations directory.
 * Files are executed in alphabetical order (e.g., 001_initial.sql, 002_cells.sql).
 * Exits with code 1 on failure, closes pool on completion.
 */
async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');

  console.log('Running database migrations...');

  try {
    // Get all migration files sorted by name
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      console.log(`Running migration: ${file}`);
      await pool.query(sql);
      console.log(`✓ ${file} completed`);
    }

    console.log('\nAll migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
