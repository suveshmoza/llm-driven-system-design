import pino from 'pino';
import { config } from '../config/index.js';

/** Structured Pino logger with environment-aware level and transport configuration. */
export const logger = pino({
  level: config.nodeEnv === 'test' ? 'silent' : 'info',
  transport:
    config.nodeEnv === 'development'
      ? { target: 'pino/file', options: { destination: 1 } }
      : undefined,
});
