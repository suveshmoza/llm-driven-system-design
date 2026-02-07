import { app } from './app.js';
import config from './config/index.js';
import redis from './services/redis.js';
import { ensureBucket } from './services/storage.js';
import logger, { logError } from './services/logger.js';
import pool from './services/db.js';
import { initCassandra, closeCassandra } from './services/cassandra.js';
import { initializeQueue, closeQueue } from './services/queue.js';

// ============================================
// Server Startup
// ============================================

const startServer = async (): Promise<void> => {
  try {
    // Ensure MinIO bucket exists
    await ensureBucket();

    // Initialize Cassandra for DMs (non-blocking - DMs are optional)
    initCassandra().catch((err: Error) => {
      logger.warn({ error: err.message }, 'Cassandra initialization failed - DMs will be unavailable');
    });

    // Initialize RabbitMQ for async image processing (non-blocking)
    initializeQueue().catch((err: Error) => {
      logger.warn({ error: err.message }, 'RabbitMQ initialization failed - posts will not process');
    });

    // Start the server
    app.listen(config.port, () => {
      logger.info(
        {
          port: config.port,
          env: config.nodeEnv,
          pid: process.pid,
        },
        `Instagram API server running on port ${config.port}`
      );
    });
  } catch (error) {
    const err = error as Error;
    logError(err, { context: 'startup' });
    process.exit(1);
  }
};

// Graceful shutdown
const gracefulShutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, `Received ${signal}, starting graceful shutdown`);

  // Close database pool
  try {
    await pool.end();
    logger.info('Database connections closed');
  } catch (err) {
    logError(err as Error, { context: 'shutdown', component: 'database' });
  }

  // Close Redis connection
  try {
    await redis.quit();
    logger.info('Redis connection closed');
  } catch (err) {
    logError(err as Error, { context: 'shutdown', component: 'redis' });
  }

  // Close Cassandra connection
  try {
    await closeCassandra();
    logger.info('Cassandra connection closed');
  } catch (err) {
    logError(err as Error, { context: 'shutdown', component: 'cassandra' });
  }

  // Close RabbitMQ connection
  try {
    await closeQueue();
    logger.info('RabbitMQ connection closed');
  } catch (err) {
    logError(err as Error, { context: 'shutdown', component: 'rabbitmq' });
  }

  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();
