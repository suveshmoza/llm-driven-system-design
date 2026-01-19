import { createClient, RedisClientType } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const client: RedisClientType = createClient({
  url: process.env.REDIS_URL,
});

client.on('error', (err: Error) => console.error('Redis Client Error', err));

let isConnected = false;

export const connectRedis = async (): Promise<RedisClientType> => {
  if (!isConnected) {
    await client.connect();
    isConnected = true;
    console.log('Connected to Redis');
  }
  return client;
};

export const getRedis = (): RedisClientType => client;

export default client;
