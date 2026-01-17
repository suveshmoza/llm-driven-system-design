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

  console.log('Migrations complete!')
  await pool.end()
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
