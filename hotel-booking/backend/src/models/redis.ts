import Redis from 'ioredis';
import config from '../config/index.js';

const redis: Redis = new Redis(config.redis.url);

redis.on('error', (err: Error) => {
  console.error('Redis connection error:', err);
});

redis.on('connect', () => {
  console.log('Connected to Redis');
});

export default redis;
