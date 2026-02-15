import { app } from './app.js';
import { config } from './config/index.js';
import { logger } from './services/logger.js';
import { connectRedis } from './services/redis.js';
import { pool } from './services/db.js';
import { ensureBucket } from './services/storageService.js';

async function start() {
  try {
    // Connect to Redis
    await connectRedis();

    // Test database connection
    await pool.query('SELECT 1');
    logger.info('Database connected');

    // Ensure MinIO bucket exists
    await ensureBucket();
    logger.info('MinIO storage ready');

    const server = app.listen(config.port, () => {
      logger.info({ port: config.port }, 'Loom backend server started');
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down gracefully');
      server.close(async () => {
        await pool.end();
        logger.info('Server shut down');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

start();
