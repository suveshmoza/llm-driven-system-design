/**
 * Admin service for data management and model training.
 * Provides REST API endpoints for administrators to:
 * - View dashboard statistics
 * - Browse, flag, and delete drawings
 * - Analyze data quality
 * - Start training jobs and manage models
 * Requires session-based authentication.
 *
 * Enhanced with:
 * - Structured JSON logging for debugging and alerting
 * - Prometheus metrics for observability
 * - Health checks for container orchestration
 * - Circuit breakers for external service resilience
 *
 * @module admin
 */

import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'

// Shared modules
import { logger } from '../shared/logger.js'
import { metricsMiddleware, metricsHandler } from '../shared/metrics.js'
import { healthCheckRouter } from '../shared/healthCheck.js'

// Route modules
import { authRouter } from './auth.js'
import { statsRouter } from './stats.js'
import { drawingsRouter } from './drawings.js'
import { qualityRouter } from './quality.js'
import { trainingRouter } from './training.js'
import { modelsRouter } from './models.js'
import { cleanupRouter } from './cleanup.js'

// Import types (side effect for global declaration)
import './types.js'

const app = express()

/** Port for the admin service (default: 3002) */
const PORT = parseInt(process.env.PORT || '3002')

// Set service name for logging
process.env.SERVICE_NAME = 'admin'

// Middleware configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json())
app.use(cookieParser())

// Prometheus metrics middleware (must be before routes)
app.use(metricsMiddleware())

// Health check endpoints
app.use(healthCheckRouter())

// Prometheus metrics endpoint
app.get('/metrics', metricsHandler)

// Mount route modules
app.use('/api/admin/auth', authRouter)
app.use('/api/admin/stats', statsRouter)
app.use('/api/admin/drawings', drawingsRouter)
app.use('/api/admin/quality', qualityRouter)
app.use('/api/admin/training', trainingRouter)
app.use('/api/admin/models', modelsRouter)
app.use('/api/admin/cleanup', cleanupRouter)

// Start server
app.listen(PORT, () => {
  logger.info({
    msg: 'Admin service started',
    port: PORT,
    env: process.env.NODE_ENV || 'development',
  })
})

export { app }
