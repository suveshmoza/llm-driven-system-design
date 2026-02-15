import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Pool } = pg;

async function migrate() {
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'pinterest',
    user: process.env.PGUSER || 'pinterest',
    password: process.env.PGPASSWORD || 'pinterest123',
  });

  try {
    console.log('Running database migration...');

    const initSql = readFileSync(join(__dirname, 'init.sql'), 'utf-8');
    await pool.query(initSql);

    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
