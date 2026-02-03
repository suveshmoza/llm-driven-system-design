/**
 * Database migration runner
 * @module db/migrate
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pool } from '../shared/db.js'
import { logger } from '../shared/logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function migrate(): Promise<void> {
  const sql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf-8')

  try {
    await pool.query(sql)
    logger.info('Database migration completed successfully')
  } catch (error) {
    logger.error(error, 'Migration failed')
    process.exit(1)
  } finally {
    await pool.end()
  }
}

migrate()
