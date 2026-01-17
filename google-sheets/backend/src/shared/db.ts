import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'sheets',
  user: process.env.PGUSER || 'sheets',
  password: process.env.PGPASSWORD || 'sheets123',
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});
