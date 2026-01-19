import { createClient, RedisClientType } from 'redis';
import config from '../config/index.js';

const client: RedisClientType = createClient({
  url: config.redis.url
});

client.on('error', (err: Error): void => {
  console.error('Redis client error:', err);
});

client.on('connect', (): void => {
  console.log('Connected to Redis');
});

const connect = async (): Promise<void> => {
  await client.connect();
};

export { client, connect };
