import express, { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import config from './config/index.js';
import redis from './services/redis.js';
import logger, { logRequest, logError, ExtendedRequest } from './services/logger.js';
import { register, metricsMiddleware } from './services/metrics.js';
import { attachUserContext, AuthenticatedRequest } from './middleware/auth.js';
import { generalRateLimiter } from './services/rateLimiter.js';
import pool from './services/db.js';

// Import routes
import authRoutes from './routes/auth.js';
import threadRoutes from './routes/threads.js';
import messageRoutes from './routes/messages.js';
import labelRoutes from './routes/labels.js';
import draftRoutes from './routes/drafts.js';
import searchRoutes from './routes/search.js';
import contactRoutes from './routes/contacts.js';

const app = express();

// Trust proxy for rate limiting behind load balancer
app.set('trust proxy', 1);

// CORS configuration
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  })
);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request ID / Trace ID middleware
app.use((req: ExtendedRequest, res: Response, next: NextFunction) => {
  req.traceId = (req.headers['x-trace-id'] as string) || uuidv4();
  res.setHeader('x-trace-id', req.traceId);
  next();
});

// Request timing and logging middleware
app.use((req: ExtendedRequest, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logRequest(req, res, duration);
  });

  next();
});

// Prometheus metrics middleware
app.use(metricsMiddleware);

// Session configuration with Redis store
const redisStore = new RedisStore({
  client: redis,
  prefix: 'sess:',
});

app.use(
  session({
    store: redisStore,
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: config.nodeEnv === 'production',
      httpOnly: true,
      maxAge: config.session.maxAge,
      sameSite: 'lax',
    },
  })
);

// Attach user context
app.use(attachUserContext as express.RequestHandler);

// General rate limiter
app.use('/api/', generalRateLimiter);

// ============================================
// Health and Metrics Endpoints
// ============================================

app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    const err = error as Error;
    logError(err, { endpoint: '/metrics' });
    res.status(500).json({ error: 'Failed to collect metrics' });
  }
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/health/detailed', async (_req: Request, res: Response) => {
  const health: {
    status: string;
    timestamp: string;
    components: Record<string, { status: string; latencyMs?: number; error?: string }>;
  } = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    components: {},
  };

  // Check PostgreSQL
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    health.components.database = { status: 'ok', latencyMs: Date.now() - start };
  } catch (error) {
    health.status = 'degraded';
    health.components.database = { status: 'error', error: (error as Error).message };
  }

  // Check Redis
  try {
    const start = Date.now();
    await redis.ping();
    health.components.redis = { status: 'ok', latencyMs: Date.now() - start };
  } catch (error) {
    health.status = 'degraded';
    health.components.redis = { status: 'error', error: (error as Error).message };
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

app.get('/api/health/live', (_req: Request, res: Response) => {
  res.json({ status: 'alive' });
});

// ============================================
// API Routes
// ============================================

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/threads', threadRoutes);
app.use('/api/v1/messages', messageRoutes);
app.use('/api/v1/labels', labelRoutes);
app.use('/api/v1/drafts', draftRoutes);
app.use('/api/v1/search', searchRoutes);
app.use('/api/v1/contacts', contactRoutes);

// ============================================
// Error Handling
// ============================================

interface HttpError extends Error {
  statusCode?: number;
}

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
const errorHandler: ErrorRequestHandler = (
  err: HttpError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const extReq = req as AuthenticatedRequest;
  logError(err, {
    requestId: (req as ExtendedRequest).traceId,
    method: req.method,
    path: req.path,
    userId: extReq.session?.userId,
  });

  if (err.statusCode) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  if (err.name === 'RateLimitError') {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }

  res.status(500).json({ error: 'Internal server error' });
};

app.use(errorHandler);

export { app };
export default app;
