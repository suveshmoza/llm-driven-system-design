import express from 'express';
import cors from 'cors';
import session from 'express-session';
import RedisStore from 'connect-redis';
import pinoHttpModule from 'pino-http';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pinoHttp = (pinoHttpModule as any).pinoHttp || (pinoHttpModule as any).default || pinoHttpModule;
import { config } from './config/index.js';
import { redis } from './services/redis.js';
import { logger } from './services/logger.js';
import { register } from './services/metrics.js';
import { apiLimiter } from './services/rateLimiter.js';
import { pool } from './services/db.js';
import authRoutes from './routes/auth.js';
import videoRoutes from './routes/videos.js';
import uploadRoutes from './routes/upload.js';
import commentRoutes from './routes/comments.js';
import shareRoutes from './routes/shares.js';
import analyticsRoutes from './routes/analytics.js';
import folderRoutes from './routes/folders.js';

/** Express application with session auth, rate limiting, and video platform routes. */
export const app = express();

// Middleware
app.use(
  cors({
    origin: config.cors.origin,
    credentials: config.cors.credentials,
  }),
);
app.use(express.json({ limit: '10mb' }));

if (config.nodeEnv !== 'test') {
  app.use(pinoHttp({ logger }));
}

// Session
const redisStore = new RedisStore({
  client: redis,
  prefix: 'loom:session:',
});

app.use(
  session({
    store: redisStore,
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

// Rate limiting
app.use('/api', apiLimiter);

// Health check
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'unhealthy', timestamp: new Date().toISOString() });
  }
});

// Metrics
app.get('/metrics', async (_req, res) => {
  try {
    const metrics = await register.metrics();
    res.set('Content-Type', register.contentType);
    res.end(metrics);
  } catch {
    res.status(500).end();
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/videos', commentRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/share', shareRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/folders', folderRoutes);
