import pino from 'pino';
import { config } from '../config/index.js';

/** Pino logger configured for development (debug level) or production (info level). */
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
