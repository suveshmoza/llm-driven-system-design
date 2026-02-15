import pino from 'pino';
import { config } from '../config/index.js';

/** Structured JSON logger using pino for the Coinbase API service. */
export const logger = pino({
  level: config.nodeEnv === 'development' ? 'debug' : 'info',
  transport:
    config.nodeEnv === 'development'
      ? {
          target: 'pino/file',
          options: { destination: 1 },
        }
      : undefined,
});
