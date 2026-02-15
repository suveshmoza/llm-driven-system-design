import pino from 'pino';
import { config } from '../config/index.js';

/** Pino structured logger, silent during tests and pretty-printed in development. */
export const logger = pino({
  level: config.nodeEnv === 'test' ? 'silent' : 'info',
  transport:
    config.nodeEnv === 'development'
      ? { target: 'pino/file', options: { destination: 1 } }
      : undefined,
});
