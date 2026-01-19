/**
 * Training job routes for the admin service.
 * Handles starting, listing, and cancelling training jobs.
 * @module admin/training
 */

import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { pool } from '../shared/db.js'
import { publishTrainingJob } from '../shared/queue.js'
import { createChildLogger, logError } from '../shared/logger.js'
import { rabbitCircuitBreaker, CircuitBreakerOpenError } from '../shared/circuitBreaker.js'
import { withRetry, RetryPresets } from '../shared/retry.js'
import { trainingJobsTotal, trackExternalCall } from '../shared/metrics.js'
import { requireAdmin } from './auth.js'

const router = Router()

/**
 * POST /api/admin/training/start - Starts a new model training job.
 * Creates a job record and publishes to RabbitMQ for async processing.
 */
router.post('/start', requireAdmin, async (req: Request, res: Response) => {
  const reqLogger = createChildLogger({ endpoint: '/api/admin/training/start' })

  try {
    const config = req.body.config || {}

    // Create training job record
    const jobId = uuidv4()
    await pool.query(
      `INSERT INTO training_jobs (id, status, config)
       VALUES ($1, 'queued', $2)`,
      [jobId, JSON.stringify(config)]
    )

    // Publish to queue with circuit breaker and retry
    try {
      await rabbitCircuitBreaker.execute(async () => {
        return await withRetry(
          async () => {
            return trackExternalCall('rabbitmq', 'publish', async () => {
              return publishTrainingJob(jobId, config)
            })
          },
          RetryPresets.rabbitmq
        )
      })
    } catch (error) {
      // If queue fails, update job status to 'failed'
      await pool.query(
        `UPDATE training_jobs SET status = 'failed', error_message = $1 WHERE id = $2`,
        ['Failed to queue job: ' + (error instanceof Error ? error.message : String(error)), jobId]
      )

      if (error instanceof CircuitBreakerOpenError) {
        reqLogger.warn({ msg: 'RabbitMQ circuit breaker open' })
        res.status(503).json({
          error: 'Queue temporarily unavailable',
          retryAfter: Math.ceil(error.retryAfterMs / 1000),
        })
        return
      }
      throw error
    }

    // Record metric
    trainingJobsTotal.labels('queued').inc()

    reqLogger.info({ msg: 'Training job queued', jobId })

    res.status(201).json({
      id: jobId,
      status: 'queued',
      message: 'Training job queued',
    })
  } catch (error) {
    logError(error as Error, { endpoint: '/api/admin/training/start' })
    res.status(500).json({ error: 'Failed to start training job' })
  }
})

/**
 * GET /api/admin/training/:id - Returns status and details of a training job.
 */
router.get('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const result = await pool.query(
      `SELECT id, status, config, error_message, started_at, completed_at, metrics, model_path
       FROM training_jobs WHERE id = $1`,
      [id]
    )

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Training job not found' })
      return
    }

    res.json(result.rows[0])
  } catch (error) {
    logError(error as Error, { endpoint: '/api/admin/training/:id' })
    res.status(500).json({ error: 'Failed to fetch training job' })
  }
})

/**
 * GET /api/admin/training - Lists all training jobs (most recent first).
 */
router.get('/', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT id, status, config, started_at, completed_at, created_at, progress,
             metrics->>'accuracy' as accuracy, error_message
      FROM training_jobs
      ORDER BY created_at DESC
      LIMIT 50
    `)

    res.json(result.rows)
  } catch (error) {
    logError(error as Error, { endpoint: '/api/admin/training' })
    res.status(500).json({ error: 'Failed to fetch training jobs' })
  }
})

/**
 * POST /api/admin/training/:id/cancel - Cancels a training job.
 * Only pending, queued, or running jobs can be cancelled.
 */
router.post('/:id/cancel', requireAdmin, async (req: Request, res: Response) => {
  const reqLogger = createChildLogger({ endpoint: '/api/admin/training/:id/cancel' })

  try {
    const { id } = req.params

    // Check current status
    const result = await pool.query(
      'SELECT status FROM training_jobs WHERE id = $1',
      [id]
    )

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Training job not found' })
      return
    }

    const currentStatus = result.rows[0].status
    if (!['pending', 'queued', 'running'].includes(currentStatus)) {
      res.status(400).json({
        error: `Cannot cancel job with status '${currentStatus}'`,
      })
      return
    }

    // Update status to cancelled
    await pool.query(
      `UPDATE training_jobs
       SET status = 'cancelled', completed_at = NOW()
       WHERE id = $1`,
      [id]
    )

    reqLogger.info({ msg: 'Training job cancelled', jobId: id })
    res.json({ success: true, message: 'Training job cancelled' })
  } catch (error) {
    logError(error as Error, { endpoint: '/api/admin/training/:id/cancel' })
    res.status(500).json({ error: 'Failed to cancel training job' })
  }
})

export { router as trainingRouter }
