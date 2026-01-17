/**
 * @fileoverview Database migration script.
 *
 * This script initializes the database schema by running the migrations
 * defined in database.ts. It's idempotent - safe to run multiple times.
 *
 * Usage:
 *   npm run db:migrate
 *
 * The script:
 * 1. Connects to PostgreSQL
 * 2. Creates all tables and indexes if they don't exist
 * 3. Closes the connection and exits
 *
 * @module scripts/migrate
 */

import { initDatabase, closeDatabase } from '../models/database.js';

/**
 * Runs database migrations.
 *
 * This is the main function that initializes the database schema.
 * It uses IF NOT EXISTS clauses, so it's safe to run on an
 * already-migrated database.
 */
async function migrate() {
  try {
    console.log('Running database migrations...');
    await initDatabase();
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

migrate();
