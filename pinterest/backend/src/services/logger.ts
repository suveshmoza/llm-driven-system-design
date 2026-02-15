import pino from 'pino';
import config from '../config/index.js';

/** Pino logger instance configured for the Pinterest API service. */
export const logger = pino({
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
  transport:
    config.nodeEnv === 'development'
      ? {
          target: 'pino/file',
          options: { destination: 1 },
        }
      : undefined,
  base: {
    service: 'pinterest-api',
    env: config.nodeEnv,
  },
});

export default logger;
