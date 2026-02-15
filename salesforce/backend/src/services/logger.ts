import pino from 'pino';
import { config } from '../config/index.js';

/** Structured JSON logger configured for environment-appropriate log level and output. */
export const logger = pino({
  level: config.nodeEnv === 'test' ? 'silent' : 'info',
  transport:
    config.nodeEnv === 'development'
      ? { target: 'pino/file', options: { destination: 1 } }
      : undefined,
});
