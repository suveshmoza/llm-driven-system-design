/**
 * Main API server entry point for the job scheduler.
 * Sets up Express app, middleware, routes, and starts the server.
 * @module api/index
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { logger } from '../utils/logger.js';
import { migrate } from '../db/migrate.js';
import { ensureAdminUser } from '../shared/auth.js';
import { metricsMiddleware } from '../shared/metrics.js';

// Import middleware
import { requestLogger, errorHandler } from './middleware.js';

// Import route modules
import { jobRoutes } from './job-routes.js';
import { scheduleRoutes } from './schedule-routes.js';
import { executionRoutes } from './execution-routes.js';
import { adminRoutes } from './admin-routes.js';

/** Express application instance */
const app = express();
/** API server port from environment */
const PORT = process.env.PORT || 3000;

// === Core Middleware ===

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Metrics middleware - track all requests
app.use(metricsMiddleware);

// Request logging
app.use(requestLogger);

// === Routes ===

// Health, metrics, and system routes (some public, some authenticated)
app.use(scheduleRoutes);

// Authentication and admin routes
app.use('/api', adminRoutes);

// Job management routes
app.use('/api/v1/jobs', jobRoutes);

// Execution routes
app.use('/api/v1', executionRoutes);

// === Error Handling ===

app.use(errorHandler);

/**
 * Starts the API server.
 * Runs database migrations and ensures admin user before listening for requests.
 */
async function start(): Promise<void> {
  // Run migrations
  await migrate();

  // Ensure default admin user exists
  await ensureAdminUser();

  app.listen(PORT, () => {
    logger.info({ port: PORT }, `API server listening on port ${PORT}`);
  });
}

start().catch((error) => {
  logger.error({ err: error }, 'Failed to start API server');
  process.exit(1);
});

export { app };
