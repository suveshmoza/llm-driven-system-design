import pg from 'pg';
import config from '../config/index.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
});

await pool.query(`SELECT 1`).catch(() => {
  // Connection will be retried by migrate
});

const { readFileSync } = await import('fs');
const { join, dirname } = await import('path');
const { fileURLToPath } = await import('url');

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, 'init.sql');

async function migrate(): Promise<void> {
  console.log('Running database migration...');
  try {
    const schema = readFileSync(schemaPath, 'utf-8');
    await pool.query(schema);
    console.log('Migration completed successfully');
  } catch (error) {
    const err = error as Error;
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
