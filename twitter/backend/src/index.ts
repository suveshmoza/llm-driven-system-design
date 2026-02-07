import dotenv from 'dotenv';

// Load environment variables first
dotenv.config();

// Import the Express app
import app from './app.js';

// Import database connections for graceful shutdown
import redis from './db/redis.js';
import pool from './db/pool.js';

// Import shared modules
import logger from './shared/logger.js';
import { validateRetentionConfig, logRetentionConfig } from './shared/retention.js';

const PORT = process.env.PORT || 3000;

// ============================================================================
// Startup Logging
// ============================================================================
logger.info({ port: PORT, nodeEnv: process.env.NODE_ENV }, 'Starting Twitter API server');

// Validate and log retention configuration
validateRetentionConfig();
logRetentionConfig();

// ============================================================================
// Graceful Shutdown
// ============================================================================
let server: ReturnType<typeof app.listen>;

const gracefulShutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Received shutdown signal, starting graceful shutdown');

  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      await pool.end();
      logger.info('Database pool closed');

      await redis.quit();
      logger.info('Redis connection closed');

      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Error during shutdown');
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

// ============================================================================
// Start Server
// ============================================================================
server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Twitter API server running');
});

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error: Error) => {
  logger.fatal({ error: error.message, stack: error.stack }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  logger.error({ reason, promise }, 'Unhandled promise rejection');
});

export default app;
