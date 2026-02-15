import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../services/db.js';
import { logger } from '../services/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function migrate() {
  try {
    const sqlPath = path.join(__dirname, 'init.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    await pool.query(sql);
    logger.info('Database migration completed successfully');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Database migration failed');
    process.exit(1);
  }
}

migrate();
