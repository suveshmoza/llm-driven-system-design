/**
 * Database migration runner.
 * Executes the init.sql file to set up the database schema.
 * Idempotent - safe to run multiple times; skips already-applied objects.
 * @module db/migrate
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pool } from '../shared/db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Runs the init.sql file to set up the database schema.
 * "Already exists" errors are treated as success (idempotent design).
 */
async function migrate() {
  console.log('Running database migrations...')

  const initSqlPath = path.join(__dirname, 'init.sql')

  if (!fs.existsSync(initSqlPath)) {
    throw new Error(`init.sql not found at ${initSqlPath}`)
  }

  const sql = fs.readFileSync(initSqlPath, 'utf-8')

  console.log('Running: init.sql')

  try {
    await pool.query(sql)
    console.log('✓ init.sql')
  } catch (error) {
    // Ignore "already exists" errors for idempotency
    if ((error as Error).message.includes('already exists')) {
      console.log('⊘ init.sql (already applied)')
    } else if ((error as Error).message.includes('duplicate key value')) {
      console.log('⊘ init.sql (seed data already exists)')
    } else {
      console.error('✗ init.sql:', error)
      throw error
    }
  }

  // Run incremental migrations for existing databases
  await runIncrementalMigrations()

  console.log('Migrations complete!')
  await pool.end()
}

/**
 * Runs incremental ALTER TABLE migrations for existing databases.
 * These migrations add new columns and constraints to existing tables.
 */
async function runIncrementalMigrations() {
  console.log('Checking for incremental migrations...')

  // Migration: Add progress column to training_jobs
  try {
    await pool.query(`
      ALTER TABLE training_jobs
      ADD COLUMN IF NOT EXISTS progress JSONB DEFAULT '{}'
    `)
    console.log('✓ Added progress column to training_jobs')
  } catch (error) {
    // Column might already exist
    if (!(error as Error).message.includes('already exists')) {
      console.log('⊘ progress column already exists')
    }
  }

  // Migration: Update status check constraint to include 'cancelled'
  // First, check if 'cancelled' is already in the constraint
  try {
    const result = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) as definition
      FROM pg_constraint
      WHERE conrelid = 'training_jobs'::regclass
        AND conname = 'training_jobs_status_check'
    `)

    if (result.rows.length > 0) {
      const definition = result.rows[0].definition
      if (!definition.includes('cancelled')) {
        // Need to recreate the constraint with 'cancelled' included
        await pool.query('ALTER TABLE training_jobs DROP CONSTRAINT training_jobs_status_check')
        await pool.query(`
          ALTER TABLE training_jobs
          ADD CONSTRAINT training_jobs_status_check
          CHECK (status IN ('pending', 'queued', 'running', 'completed', 'failed', 'cancelled'))
        `)
        console.log('✓ Updated training_jobs status constraint to include cancelled')
      } else {
        console.log('⊘ training_jobs status constraint already includes cancelled')
      }
    }
  } catch (error) {
    // Constraint might not exist or already be correct
    console.log('⊘ Could not update status constraint (may already be correct)')
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
