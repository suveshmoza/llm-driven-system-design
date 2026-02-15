import http from 'http';
import { WebSocketServer } from 'ws';
import { app } from './app.js';
import config from './config/index.js';
import redis from './services/redis.js';
import logger, { logError } from './services/logger.js';
import pool from './services/db.js';
import { setupWebSocket } from './websocket/handler.js';

const startServer = async (): Promise<void> => {
  try {
    // Create HTTP server from Express app
    const server = http.createServer(app);

    // Create WebSocket server attached to the same HTTP server
    const wss = new WebSocketServer({ server, path: '/ws' });
    setupWebSocket(wss);

    // Start the server
    server.listen(config.port, () => {
      logger.info(
        {
          port: config.port,
          env: config.nodeEnv,
          pid: process.pid,
        },
        `Excalidraw API server running on port ${config.port}`
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

  try {
    await pool.end();
    logger.info('Database connections closed');
  } catch (err) {
    logError(err as Error, { context: 'shutdown', component: 'database' });
  }

  try {
    await redis.quit();
    logger.info('Redis connection closed');
  } catch (err) {
    logError(err as Error, { context: 'shutdown', component: 'redis' });
  }

  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();
