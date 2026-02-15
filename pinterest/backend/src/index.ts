import { app } from './app.js';
import config from './config/index.js';
import { logger } from './services/logger.js';
import { initializeQueue } from './services/queue.js';
import { ensureBucket } from './services/storage.js';
import redis from './services/redis.js';

async function start() {
  try {
    // Connect to Redis
    await redis.connect();
    logger.info('Redis connected');

    // Initialize RabbitMQ
    await initializeQueue();

    // Ensure MinIO bucket exists
    await ensureBucket();

    // Start HTTP server
    const server = app.listen(config.port, () => {
      logger.info({ port: config.port }, `Pinterest API server started`);
    });

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down...');
      server.close();
      await redis.disconnect();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

start();
