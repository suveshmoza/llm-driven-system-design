/**
 * Model management routes for the admin service.
 * Handles listing models and activating models for inference.
 * @module admin/models
 */

import { Router, Request, Response } from 'express'
import { pool } from '../shared/db.js'
import { logger, createChildLogger, logError } from '../shared/logger.js'
import { computePrototypes } from '../shared/prototype.js'
import { requireAdmin } from './auth.js'

const router = Router()

/**
 * GET /api/admin/models - Lists all trained models.
 */
router.get('/', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT m.id, m.version, m.is_active, m.accuracy, m.model_path, m.created_at,
             tj.config as training_config
      FROM models m
      LEFT JOIN training_jobs tj ON m.training_job_id = tj.id
      ORDER BY m.created_at DESC
    `)

    res.json(result.rows)
  } catch (error) {
    logError(error as Error, { endpoint: '/api/admin/models' })
    res.status(500).json({ error: 'Failed to fetch models' })
  }
})

/**
 * POST /api/admin/models/:id/activate - Activates a model for inference.
 * Deactivates all other models first (only one active at a time).
 * Computes prototype strokes from training data for shape generation.
 */
router.post('/:id/activate', requireAdmin, async (req: Request, res: Response) => {
  const reqLogger = createChildLogger({ endpoint: '/api/admin/models/:id/activate' })

  try {
    const { id } = req.params

    reqLogger.info({ msg: 'Activating model', modelId: id })

    // Compute prototypes from training data
    reqLogger.info({ msg: 'Computing shape prototypes from training data' })
    let prototypeData
    try {
      prototypeData = await computePrototypes(50)
      reqLogger.info({
        msg: 'Prototypes computed',
        shapes: Object.keys(prototypeData.prototypes),
        sampleCounts: Object.fromEntries(
          Object.entries(prototypeData.prototypes).map(([k, v]) => [k, (v as { sampleCount: number }).sampleCount])
        ),
      })
    } catch (protoErr) {
      reqLogger.warn({
        msg: 'Failed to compute prototypes, will use procedural fallbacks',
        error: (protoErr as Error).message,
      })
      prototypeData = null
    }

    // Deactivate all models first
    await pool.query('UPDATE models SET is_active = FALSE')

    // Activate the selected model and store prototype data in config
    if (prototypeData) {
      await pool.query(
        'UPDATE models SET is_active = TRUE, config = $2 WHERE id = $1',
        [id, JSON.stringify(prototypeData)]
      )
    } else {
      await pool.query('UPDATE models SET is_active = TRUE WHERE id = $1', [id])
    }

    logger.info({ msg: 'Model activated', modelId: id })
    res.json({ success: true, message: 'Model activated' })
  } catch (error) {
    logError(error as Error, { endpoint: '/api/admin/models/:id/activate' })
    res.status(500).json({ error: 'Failed to activate model' })
  }
})

export { router as modelsRouter }
