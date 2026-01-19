import express, { Request, Response, NextFunction, Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import RedisStore from 'connect-redis';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'http';

import config from './config.js';
import redis from './services/redis.js';
import db from './db/index.js';
import { initializeIndex } from './services/elasticsearch.js';

// Shared modules
import logger, { httpLogger } from './shared/logger.js';
import { metricsMiddleware, getMetrics, getMetricsContentType, dbConnectionsActive } from './shared/metrics.js';
import { getCircuitBreakerStatus } from './shared/circuit-breaker.js';

// Routes
import authRoutes from './routes/auth.js';
import shopsRoutes from './routes/shops.js';
import productsRoutes from './routes/products.js';
import cartRoutes from './routes/cart.js';
import ordersRoutes from './routes/orders.js';
import favoritesRoutes from './routes/favorites.js';
import reviewsRoutes from './routes/reviews.js';
import categoriesRoutes from './routes/categories.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Application = express();

// Trust proxy for session cookies
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS configuration
app.use(cors({
  origin: config.frontend.url,
  credentials: true,
}));

// Structured JSON logging (replaces morgan)
app.use(httpLogger);

// Prometheus metrics middleware
app.use(metricsMiddleware);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Session configuration with Redis store
app.use(session({
  store: new RedisStore({ client: redis }),
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.nodeEnv === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: config.nodeEnv === 'production' ? 'strict' : 'lax',
  },
}));

interface HealthResponse {
  status: string;
  timestamp: string;
  version: string;
  uptime: number;
  services: Record<string, unknown>;
  circuitBreakers?: Record<string, unknown>;
}

// Prometheus metrics endpoint
app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    // Update database connection gauge
    const poolInfo = db.pool;
    dbConnectionsActive.set(poolInfo.totalCount - poolInfo.idleCount);

    res.set('Content-Type', getMetricsContentType());
    res.end(await getMetrics());
  } catch (error) {
    logger.error({ error }, 'Error generating metrics');
    res.status(500).end('Error generating metrics');
  }
});

// Comprehensive health check endpoint
app.get('/api/health', async (_req: Request, res: Response) => {
  const health: HealthResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime(),
    services: {},
  };

  // Check PostgreSQL
  try {
    const dbStart = Date.now();
    await db.query('SELECT 1');
    health.services.postgres = {
      status: 'healthy',
      latencyMs: Date.now() - dbStart,
      connections: {
        total: db.pool.totalCount,
        idle: db.pool.idleCount,
        waiting: db.pool.waitingCount,
      },
    };
  } catch (error) {
    health.status = 'degraded';
    health.services.postgres = {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Check Redis
  try {
    const redisStart = Date.now();
    await redis.ping();
    health.services.redis = {
      status: 'healthy',
      latencyMs: Date.now() - redisStart,
    };
  } catch (error) {
    health.status = 'degraded';
    health.services.redis = {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Get circuit breaker status
  health.circuitBreakers = getCircuitBreakerStatus();

  // Return appropriate status code
  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Readiness probe (for Kubernetes)
app.get('/api/ready', async (_req: Request, res: Response) => {
  try {
    await db.query('SELECT 1');
    await redis.ping();
    res.json({ ready: true });
  } catch (error) {
    res.status(503).json({ ready: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Liveness probe (for Kubernetes)
app.get('/api/live', (_req: Request, res: Response) => {
  res.json({ alive: true });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/shops', shopsRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/categories', categoriesRoutes);

// Error handling middleware
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error({
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    userId: req.session?.userId,
  }, 'Unhandled error');

  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
let server: Server;

function gracefulShutdown(signal: string): void {
  logger.info({ signal }, 'Received shutdown signal');

  // Close server
  server.close(() => {
    logger.info('HTTP server closed');

    // Close database pool
    db.pool.end(() => {
      logger.info('Database pool closed');

      // Close Redis connection
      redis.quit().then(() => {
        logger.info('Redis connection closed');
        process.exit(0);
      });
    });
  });

  // Force exit after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

// Start server
const PORT = config.port;

async function startServer(): Promise<void> {
  try {
    // Initialize Elasticsearch index
    await initializeIndex();

    server = app.listen(PORT, () => {
      logger.info({
        port: PORT,
        environment: config.nodeEnv,
      }, 'Server started');
    });

    // Handle graceful shutdown
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

startServer();

export default app;
