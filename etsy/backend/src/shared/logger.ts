import pino, { Logger } from 'pino';
import pinoHttp, { HttpLogger } from 'pino-http';
import config from '../config.js';

// Structured JSON logger with context support
const logger: Logger = pino({
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
  formatters: {
    level: (label: string) => {
      return { level: label };
    },
  },
  base: {
    service: 'etsy-backend',
    environment: config.nodeEnv,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Pretty print in development
  transport:
    config.nodeEnv !== 'production'
      ? {
          target: 'pino/file',
          options: { destination: 1 }, // stdout
        }
      : undefined,
});

// HTTP request logger middleware
export const httpLogger: HttpLogger = pinoHttp({
  logger,
  // Don't log health checks
  autoLogging: {
    ignore: (req) => req.url === '/api/health' || req.url === '/metrics',
  },
  // Custom serializers
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      query: req.query,
      userId: (req.raw as { session?: { userId?: number } })?.session?.userId || null,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
  // Add custom fields
  customProps: (req) => ({
    userId: (req as { session?: { userId?: number } }).session?.userId || null,
    sessionId: (req as { sessionID?: string }).sessionID || null,
  }),
  // Custom log level based on status code
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // Custom success message
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  // Custom error message
  customErrorMessage: (req, _res, err) => {
    return `${req.method} ${req.url} failed: ${err.message}`;
  },
});

// Create child loggers for specific contexts
export function createLogger(context: string): Logger {
  return logger.child({ context });
}

// Specific module loggers
export const dbLogger: Logger = createLogger('database');
export const cacheLogger: Logger = createLogger('cache');
export const searchLogger: Logger = createLogger('elasticsearch');
export const orderLogger: Logger = createLogger('orders');
export const paymentLogger: Logger = createLogger('payment');

export default logger;
