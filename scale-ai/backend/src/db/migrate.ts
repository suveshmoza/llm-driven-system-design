import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pool } from '../shared/db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function migrate() {
  console.log('Running database migrations...')

  const migrationsDir = path.join(__dirname, 'migrations')
  const files = fs.readdirSync(migrationsDir).sort()

  for (const file of files) {
    if (!file.endsWith('.sql')) continue

    const filePath = path.join(migrationsDir, file)
    const sql = fs.readFileSync(filePath, 'utf-8')

    console.log(`Running: ${file}`)

    try {
      await pool.query(sql)
      console.log(`✓ ${file}`)
    } catch (error) {
      // Ignore "already exists" errors for idempotency
      if ((error as Error).message.includes('already exists')) {
        console.log(`⊘ ${file} (already applied)`)
      } else {
        console.error(`✗ ${file}:`, error)
        throw error
      }
    }
  }

  console.log('Migrations complete!')
  await pool.end()
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
