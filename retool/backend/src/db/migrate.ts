import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://retool:retool123@localhost:5432/retool';

async function migrate() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    const sql = readFileSync(join(__dirname, 'init.sql'), 'utf-8');
    await client.query(sql);
    console.log('Migration completed successfully');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
