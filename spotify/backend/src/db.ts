import pg from 'pg';
import { createClient } from 'redis';

const { Pool } = pg;

// PostgreSQL connection pool
/** PostgreSQL connection pool for the Spotify metadata database. */
export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'spotify',
  user: process.env.DB_USER || 'spotify',
  password: process.env.DB_PASSWORD || 'spotify_secret',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Redis client
/** Redis client for session storage, playback state caching, and rate limiting. */
export const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

/** Initializes the database connection and Redis client. */
export async function initializeDatabase() {
  await redisClient.connect();
  console.log('Connected to Redis');

  const client = await pool.connect();
  console.log('Connected to PostgreSQL');
  client.release();
}
