import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import RedisStore from 'connect-redis';

import config from './config/index.js';
import * as db from './db/index.js';
import { client as redisClient, connect as connectRedis } from './db/redis.js';
import { initBuckets } from './db/minio.js';

// Shared modules for observability and resilience
import {
  logger,
  requestLoggerMiddleware,
  metricsMiddleware,
  metricsHandler,
  idempotencyMiddleware,
  getCircuitBreakerHealth
} from './shared/index.js';

// Routes
import authRoutes from './routes/auth.js';
import contentRoutes from './routes/content.js';
import streamingRoutes from './routes/streaming.js';
import watchProgressRoutes from './routes/watchProgress.js';
import watchlistRoutes from './routes/watchlist.js';
import subscriptionRoutes from './routes/subscription.js';
import recommendationsRoutes from './routes/recommendations.js';
import adminRoutes from './routes/admin.js';

const app: Application = express();

interface HealthCheck {
  status: string;
  timestamp: string;
  uptime: number;
  version: string;
  responseTime?: number;
  checks: {
    database?: { status: string; latency?: number; error?: string };
    redis?: { status: string; latency?: number; error?: string };
    circuitBreakers?: Record<string, unknown>;
  };
}

// Middleware - order matters
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Add metrics middleware early to track all requests
app.use(metricsMiddleware);

// Add structured logging middleware
app.use(requestLoggerMiddleware);

// Initialize function
async function init(): Promise<void> {
  // Connect to Redis
  await connectRedis();
  logger.info('Connected to Redis');

  // Initialize MinIO buckets
  try {
    await initBuckets();
    logger.info('MinIO buckets initialized');
  } catch (error) {
    logger.warn({ error: (error as Error).message }, 'MinIO initialization warning');
  }

  // Session middleware with Redis store
  app.use(session({
    store: new RedisStore({ client: redisClient }),
    secret: config.session.secret,
    name: config.session.name,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: config.session.maxAge,
      sameSite: 'lax'
    }
  }));

  // Add idempotency middleware after session (needs userId)
  app.use(idempotencyMiddleware(redisClient));

  // Prometheus metrics endpoint
  app.get('/metrics', metricsHandler);

  // Enhanced health check with detailed status
  app.get('/health', async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const health: HealthCheck = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      checks: {}
    };

    // Check PostgreSQL
    try {
      const dbStart = Date.now();
      await db.query('SELECT 1');
      health.checks.database = {
        status: 'healthy',
        latency: Date.now() - dbStart
      };
    } catch (error) {
      health.status = 'unhealthy';
      health.checks.database = {
        status: 'unhealthy',
        error: (error as Error).message
      };
    }

    // Check Redis
    try {
      const redisStart = Date.now();
      await redisClient.ping();
      health.checks.redis = {
        status: 'healthy',
        latency: Date.now() - redisStart
      };
    } catch (error) {
      health.status = 'unhealthy';
      health.checks.redis = {
        status: 'unhealthy',
        error: (error as Error).message
      };
    }

    // Check circuit breakers
    health.checks.circuitBreakers = getCircuitBreakerHealth();

    // Calculate total response time
    health.responseTime = Date.now() - startTime;

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  });

  // Liveness probe (simple check that server is running)
  app.get('/health/live', (req: Request, res: Response): void => {
    res.json({ status: 'alive', timestamp: new Date().toISOString() });
  });

  // Readiness probe (check if server is ready to accept traffic)
  app.get('/health/ready', async (req: Request, res: Response): Promise<void> => {
    try {
      await db.query('SELECT 1');
      await redisClient.ping();
      res.json({ status: 'ready', timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(503).json({ status: 'not_ready', error: (error as Error).message });
    }
  });

  // API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/content', contentRoutes);
  app.use('/api/stream', streamingRoutes);
  app.use('/api/watch', watchProgressRoutes);
  app.use('/api/watchlist', watchlistRoutes);
  app.use('/api/subscription', subscriptionRoutes);
  app.use('/api/recommendations', recommendationsRoutes);
  app.use('/api/admin', adminRoutes);

  // Error handling middleware with structured logging
  app.use((err: Error, req: Request, res: Response, _next: NextFunction): void => {
    const errorLog = {
      error: err.message,
      stack: err.stack,
      method: req.method,
      path: req.path,
      userId: req.session?.userId
    };

    if (req.log) {
      req.log.error(errorLog, 'Unhandled error');
    } else {
      logger.error(errorLog, 'Unhandled error');
    }

    res.status(500).json({ error: 'Internal server error' });
  });

  // Start server
  const port = config.port;
  app.listen(port, () => {
    logger.info({
      port,
      nodeEnv: process.env.NODE_ENV || 'development'
    }, 'Apple TV+ backend started');
    logger.info(`Health check: http://localhost:${port}/health`);
    logger.info(`Metrics: http://localhost:${port}/metrics`);
  });
}

// Handle graceful shutdown
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutdown signal received');

  try {
    await redisClient.quit();
    logger.info('Redis connection closed');
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Error closing Redis connection');
  }

  try {
    await db.pool.end();
    logger.info('Database pool closed');
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Error closing database pool');
  }

  logger.info('Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start the server
init().catch((err: Error) => {
  logger.error({ error: err.message, stack: err.stack }, 'Failed to start server');
  process.exit(1);
});
