/**
 * @fileoverview Main Express API server for the web crawler.
 *
 * This is the entry point for the API server component of the distributed
 * web crawler. The server provides:
 * - REST API endpoints for dashboard and administration
 * - Health check endpoint for container orchestration
 * - Rate limiting to prevent API abuse
 * - Security middleware (helmet, CORS)
 *
 * The server runs independently from crawler workers and handles all
 * HTTP requests for the dashboard and management operations.
 *
 * @module server
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { config } from './config.js';
import { initDatabase, pool } from './models/database.js';
import { redis } from './models/redis.js';
import frontierRoutes from './routes/frontier.js';
import statsRoutes from './routes/stats.js';
import pagesRoutes from './routes/pages.js';
import domainsRoutes from './routes/domains.js';

/**
 * Express application instance.
 * Configured with security, compression, and logging middleware.
 */
const app = express();

// Security middleware
app.use(helmet());

// Enable CORS for frontend access
app.use(cors());

// Compress responses for better performance
app.use(compression());

// Parse JSON request bodies
app.use(express.json());

// Request logging
app.use(morgan('combined'));

/**
 * Rate limiter for API endpoints.
 * Limits each IP to 100 requests per minute to prevent abuse.
 */
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', limiter);

/**
 * GET /health
 *
 * Health check endpoint for container orchestration.
 * Verifies connectivity to PostgreSQL and Redis.
 * Returns 200 if healthy, 503 if any service is unavailable.
 */
app.get('/health', async (_req, res) => {
  try {
    // Check database connection
    await pool.query('SELECT 1');

    // Check Redis connection
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
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Mount API route handlers
app.use('/api/frontier', frontierRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/pages', pagesRoutes);
app.use('/api/domains', domainsRoutes);

/**
 * GET /
 *
 * Root endpoint returning API information.
 * Useful for API discovery and documentation.
 */
app.get('/', (_req, res) => {
  res.json({
    name: 'Web Crawler API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      frontier: '/api/frontier',
      stats: '/api/stats',
      pages: '/api/pages',
      domains: '/api/domains',
    },
  });
});

/**
 * Global error handler.
 * Catches unhandled errors and returns appropriate response.
 * In development, includes error message; in production, hides details.
 */
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: config.nodeEnv === 'development' ? err.message : undefined,
    });
  }
);

/**
 * Starts the API server.
 *
 * Initializes the database schema and starts listening for HTTP requests.
 * Called when this module is run directly.
 */
async function start() {
  try {
    // Initialize database
    await initDatabase();
    console.log('Database initialized');

    // Start server
    app.listen(config.port, () => {
      console.log(`Web Crawler API server running on port ${config.port}`);
      console.log(`Environment: ${config.nodeEnv}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * SIGTERM handler for graceful shutdown.
 * Closes database and Redis connections before exiting.
 */
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await pool.end();
  await redis.quit();
  process.exit(0);
});

/**
 * SIGINT handler for graceful shutdown (Ctrl+C).
 * Closes database and Redis connections before exiting.
 */
process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  await pool.end();
  await redis.quit();
  process.exit(0);
});

start();
