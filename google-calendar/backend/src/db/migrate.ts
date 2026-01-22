import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pool } from '../shared/db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf-8')

  try {
    await pool.query(sql)
    console.log('Database migration completed successfully')
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

migrate()
