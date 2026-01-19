import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import config from './config/index.js';
import * as elasticsearch from './models/elasticsearch.js';
import bookingService from './services/booking/index.js';

// Import shared modules
import {
  logger,
  requestLoggerMiddleware,
  metricsMiddleware,
  getMetrics,
  getContentType,
  createHealthRouter,
  metrics,
} from './shared/index.js';

// Import routes
import authRoutes from './routes/auth.js';
import hotelRoutes from './routes/hotels.js';
import bookingRoutes from './routes/bookings.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use(requestLoggerMiddleware);

// Metrics middleware
app.use(metricsMiddleware);

// Health check endpoints
app.use('/health', createHealthRouter(express));

// Simple health check (backward compatibility)
app.get('/healthz', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Prometheus metrics endpoint
app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const metricsData = await getMetrics();
    res.set('Content-Type', getContentType());
    res.send(metricsData);
  } catch (error) {
    logger.error({ error }, 'Error collecting metrics');
    res.status(500).json({ error: 'Failed to collect metrics' });
  }
});

// API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/hotels', hotelRoutes);
app.use('/api/v1/bookings', bookingRoutes);

// Error handling middleware
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const log = req.log || logger;
  log.error({ error: err, stack: err.stack }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Background job: Expire stale reservations
let expiryInterval: ReturnType<typeof setInterval> | undefined;

async function startExpiryJob(): Promise<void> {
  expiryInterval = setInterval(async () => {
    try {
      const expired = await bookingService.expireStaleReservations();
      if (expired > 0) {
        logger.info({ expiredCount: expired }, 'Expired stale reservations');
        metrics.bookingsExpiredTotal.inc(expired);
      }
    } catch (error) {
      logger.error({ error }, 'Error expiring reservations');
    }
  }, 60000); // Run every minute
}

// Start server
async function start(): Promise<void> {
  try {
    // Setup Elasticsearch index
    await elasticsearch.setupIndex();
    logger.info('Elasticsearch index ready');

    // Start background jobs
    startExpiryJob();

    app.listen(config.port, () => {
      logger.info(
        { port: config.port, env: config.nodeEnv },
        `Server running on port ${config.port}`
      );
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  if (expiryInterval) {
    clearInterval(expiryInterval);
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  if (expiryInterval) {
    clearInterval(expiryInterval);
  }
  process.exit(0);
});

start();
