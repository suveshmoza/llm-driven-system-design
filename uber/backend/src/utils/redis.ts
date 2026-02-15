import Redis from 'ioredis';
import config from '../config/index.js';

/** Redis client for driver geo-indexing, session tokens, surge pricing cache, and ride state. */
const redis = new Redis.default(config.redis.url);

redis.on('error', (err: Error): void => {
  console.error('Redis error:', err);
});

redis.on('connect', (): void => {
  console.log('Connected to Redis');
});

export default redis;
