import pg from 'pg';
import { readdirSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Pool } = pg;

/**
 * Database migration runner for Instagram.
 * Tracks applied migrations and applies pending ones.
 */

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'instagram',
  user: process.env.DB_USER || 'instagram',
  password: process.env.DB_PASSWORD || 'instagram123',
});

const MIGRATIONS_DIR = join(__dirname, 'migrations');

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations() {
  const result = await pool.query(
    'SELECT version FROM schema_migrations ORDER BY version'
  );
  return new Set(result.rows.map(r => r.version));
}

function getMigrationFiles() {
  if (!existsSync(MIGRATIONS_DIR)) {
    console.log('No migrations directory found. Creating...');
    mkdirSync(MIGRATIONS_DIR, { recursive: true });
    return [];
  }

  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && !f.includes('.rollback.'))
    .sort();
}

async function migrate() {
  console.log('Running migrations...');

  await ensureMigrationsTable();

  const applied = await getAppliedMigrations();
  const files = getMigrationFiles();

  let appliedCount = 0;

  for (const file of files) {
    const version = file.replace('.sql', '');

    if (applied.has(version)) {
      continue;
    }

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    console.log(`  Applying: ${file}`);

    try {
      await pool.query(sql);
      await pool.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [version]
      );
      console.log(`  Applied successfully`);
      appliedCount++;
    } catch (error) {
      console.error(`  FAILED: ${error.message}`);
      process.exit(1);
    }
  }

  if (appliedCount === 0) {
    console.log('  No pending migrations.');
  } else {
    console.log(`  Successfully applied ${appliedCount} migration(s).`);
  }
}

async function run() {
  try {
    await migrate();
  } finally {
    await pool.end();
  }
}

run().then(() => process.exit(0)).catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});
