import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

/** Redis client instance for caching timelines, sessions, and trend tracking. */
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redis.on('error', (err: Error) => {
  console.error('Redis connection error:', err);
});

redis.on('connect', () => {
  console.log('Connected to Redis');
});

export default redis;
