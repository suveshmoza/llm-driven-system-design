import pino from 'pino';
import { config } from '../config/index.js';

/** Pino logger instance configured for the current environment. */
export const logger = pino({
  level: config.nodeEnv === 'test' ? 'silent' : 'info',
  transport:
    config.nodeEnv === 'development'
      ? { target: 'pino/file', options: { destination: 1 } }
      : undefined,
});
