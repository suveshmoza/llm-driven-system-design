import express from 'express';
import cors from 'cors';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import redis from './services/redis.js';
import config from './config/index.js';
import { register, metricsMiddleware } from './services/metrics.js';
import { generalRateLimiter } from './services/rateLimiter.js';
import { logger } from './services/logger.js';

// Import routes
import authRoutes from './routes/auth.js';
import pinRoutes from './routes/pins.js';
import boardRoutes from './routes/boards.js';
import feedRoutes from './routes/feed.js';
import searchRoutes from './routes/search.js';
import userRoutes from './routes/users.js';

/** Express application configured with session auth, rate limiting, and Pinterest API routes. */
export const app = express();

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// CORS
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  }),
);

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Session
const sessionStore = new RedisStore({
  client: redis,
  prefix: 'pinterest:session:',
});

app.use(
  session({
    store: sessionStore,
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: config.session.maxAge,
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
    },
  }),
);

// Metrics middleware
app.use(metricsMiddleware as unknown as express.RequestHandler);

// Rate limiting
app.use('/api', generalRateLimiter as express.RequestHandler);

// Health endpoints
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/health/live', (_req, res) => {
  res.json({ status: 'alive' });
});

// Metrics endpoint
app.get('/metrics', async (_req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.end(metrics);
  } catch (err) {
    logger.error({ err }, 'Metrics error');
    res.status(500).end();
  }
});

// API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/pins', pinRoutes);
app.use('/api/v1/boards', boardRoutes);
app.use('/api/v1/feed', feedRoutes);
app.use('/api/v1/search', searchRoutes);
app.use('/api/v1/users', userRoutes);

// 404 handler
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logger.error({ err }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  },
);
