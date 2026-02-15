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
import walletRoutes from './routes/wallet.js';
import transferRoutes from './routes/transfers.js';
import requestRoutes from './routes/requests.js';
import paymentMethodRoutes from './routes/paymentMethods.js';
import userRoutes from './routes/users.js';

/** Express application with session auth, rate limiting, and PayPal payment routes. */
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
  prefix: 'paypal:session:',
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
app.use('/api/wallet', walletRoutes);
app.use('/api/transfers', transferRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/payment-methods', paymentMethodRoutes);
app.use('/api/users', userRoutes);
