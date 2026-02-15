import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redis } from './redis.js';

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args: string[]) => redis.call(...args) as never,
    prefix: 'rl:api:',
  }),
  message: { error: 'Too many requests, please try again later' },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args: string[]) => redis.call(...args) as never,
    prefix: 'rl:auth:',
  }),
  message: { error: 'Too many auth attempts, please try again later' },
});
