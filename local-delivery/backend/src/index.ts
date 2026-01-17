/**
 * Main entry point for the local delivery backend server.
 * Initializes Express, connects to PostgreSQL and Redis,
 * sets up WebSocket server, and configures API routes.
 *
 * @module index
 */
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';

import { pool } from './utils/db.js';
import { redis, publisher, initRedis } from './utils/redis.js';
import { setupWebSocket } from './websocket/handler.js';

import authRoutes from './routes/auth.js';
import merchantRoutes from './routes/merchants.js';
import orderRoutes from './routes/orders.js';
import driverRoutes from './routes/driver.js';
import adminRoutes from './routes/admin.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3000');

/**
 * CORS and JSON body parsing middleware.
 * Allows cross-origin requests for frontend development.
 */
app.use(cors());
app.use(express.json());

/**
 * Request logging middleware.
 * Logs HTTP method, path, status code, and response time for debugging.
 */
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

/**
 * Health check endpoint for load balancer and monitoring.
 * Verifies database and Redis connectivity.
 */
app.get('/health', async (_req, res) => {
  try {
    // Check database
    await pool.query('SELECT 1');
    // Check Redis
    await redis.ping();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        redis: 'connected',
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: (error as Error).message,
    });
  }
});

/**
 * API Routes registration.
 * All routes are prefixed with /api/v1 for versioning.
 */
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/merchants', merchantRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/driver', driverRoutes);
app.use('/api/v1/admin', adminRoutes);

/**
 * 404 handler for unknown routes.
 */
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
  });
});

/**
 * Global error handler for unhandled exceptions.
 */
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
});

/**
 * HTTP server instance.
 * WebSocket server is attached to this for connection upgrades.
 */
const server = createServer(app);

/**
 * Attach WebSocket server for real-time communication.
 */
setupWebSocket(server);

/**
 * Initializes database and Redis connections, then starts the HTTP server.
 * Logs connection status and available endpoints.
 */
async function start() {
  try {
    // Connect to Redis
    await initRedis();
    console.log('Connected to Redis');

    // Test database connection
    await pool.query('SELECT 1');
    console.log('Connected to PostgreSQL');

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
      console.log(`API base URL: http://localhost:${PORT}/api/v1`);
      console.log(`WebSocket URL: ws://localhost:${PORT}/ws`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * Graceful shutdown handlers.
 * Closes all connections cleanly when receiving termination signals.
 */
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  server.close();
  await pool.end();
  await redis.quit();
  await publisher.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down...');
  server.close();
  await pool.end();
  await redis.quit();
  await publisher.quit();
  process.exit(0);
});

start();
