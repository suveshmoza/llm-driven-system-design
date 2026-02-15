import { readFileSync } from 'fs';
import { pool } from '../services/db.js';
import { logger } from '../services/logger.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function migrate() {
  try {
    const sql = readFileSync(join(__dirname, 'init.sql'), 'utf-8');
    await pool.query(sql);
    logger.info('Database migration completed successfully');
  } catch (err) {
    logger.error({ err }, 'Database migration failed');
    throw err;
  } finally {
    await pool.end();
  }
}

migrate().catch(() => process.exit(1));
