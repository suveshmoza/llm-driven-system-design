import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import rideRoutes from './routes/rides.js';
import driverRoutes from './routes/driver.js';
import { healthRouter } from './utils/health.js';
import { registry, metricsMiddleware } from './utils/metrics.js';
import { createLogger, requestLogger } from './utils/logger.js';

const appLogger = createLogger('app');

const app: Express = express();

// Middleware
app.use(cors());
app.use(express.json());

// Request logging with pino
app.use(requestLogger);

// Prometheus metrics middleware
app.use(metricsMiddleware);

// Health check endpoints (includes /health, /health/live, /health/ready)
healthRouter(app);

// Prometheus metrics endpoint
app.get('/metrics', async (_req: Request, res: Response): Promise<void> => {
  try {
    res.set('Content-Type', registry.contentType);
    const metrics = await registry.metrics();
    res.end(metrics);
  } catch (error) {
    const err = error as Error;
    appLogger.error({ error: err.message }, 'Failed to collect metrics');
    res.status(500).end();
  }
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/driver', driverRoutes);

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction): void => {
  appLogger.error({ error: err.message, stack: err.stack }, 'Unhandled server error');
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((_req: Request, res: Response): void => {
  res.status(404).json({ error: 'Not found' });
});

export { app };
export default app;
