import pg from 'pg'

const { Pool } = pg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://calendar_user:calendar_pass@localhost:5432/google_calendar',
})
