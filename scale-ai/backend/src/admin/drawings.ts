/**
 * Drawing management routes for the admin service.
 * Handles listing, flagging, deleting, and restoring drawings.
 * @module admin/drawings
 */

import { Router, Request, Response } from 'express'
import { pool } from '../shared/db.js'
import { getDrawing } from '../shared/storage.js'
import { cacheDelete, CacheKeys } from '../shared/cache.js'
import { logger, logError } from '../shared/logger.js'
import { minioCircuitBreaker, CircuitBreakerOpenError } from '../shared/circuitBreaker.js'
import { trackExternalCall } from '../shared/metrics.js'
import { scoreDrawing, type StrokeData } from '../shared/quality.js'
import { requireAdmin } from './auth.js'

const router = Router()

/**
 * GET /api/admin/drawings - Lists drawings with pagination and filters.
 * Supports filtering by shape, date range, flagged status, and soft-deleted items.
 */
router.get('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100)
    const offset = (page - 1) * limit
    const shape = req.query.shape as string
    const flagged = req.query.flagged === 'true'
    const includeDeleted = req.query.includeDeleted === 'true'
    const startDate = req.query.startDate as string
    const endDate = req.query.endDate as string

    let whereClause = 'WHERE 1=1'
    const params: (string | boolean | number)[] = []

    // Exclude soft-deleted drawings by default
    if (!includeDeleted) {
      whereClause += ' AND d.deleted_at IS NULL'
    }

    if (shape) {
      params.push(shape)
      whereClause += ` AND s.name = $${params.length}`
    }

    if (flagged) {
      whereClause += ' AND d.is_flagged = TRUE'
    }

    // Date range filter
    if (startDate) {
      params.push(startDate)
      whereClause += ` AND d.created_at >= $${params.length}::date`
    }

    if (endDate) {
      params.push(endDate)
      whereClause += ` AND d.created_at < ($${params.length}::date + interval '1 day')`
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as count
      FROM drawings d
      JOIN shapes s ON d.shape_id = s.id
      ${whereClause}
    `
    const countResult = await pool.query(countQuery, params)
    const total = parseInt(countResult.rows[0].count)

    // Get drawings
    params.push(limit, offset)
    const query = `
      SELECT d.id, d.stroke_data_path, d.metadata, d.quality_score,
             d.is_flagged, d.deleted_at, d.created_at, s.name as shape
      FROM drawings d
      JOIN shapes s ON d.shape_id = s.id
      ${whereClause}
      ORDER BY d.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `

    const result = await pool.query(query, params)

    res.json({
      drawings: result.rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    logError(error as Error, { endpoint: '/api/admin/drawings' })
    res.status(500).json({ error: 'Failed to fetch drawings' })
  }
})

/**
 * POST /api/admin/drawings/:id/flag - Flags or unflags a drawing.
 * Flagged drawings can be excluded from training data.
 */
router.post('/:id/flag', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { flagged } = req.body

    await pool.query(
      'UPDATE drawings SET is_flagged = $1 WHERE id = $2',
      [flagged !== false, id]
    )

    // Invalidate stats cache since flagged count changed
    await cacheDelete(CacheKeys.adminStats())

    logger.info({ msg: 'Drawing flagged', drawingId: id, flagged: flagged !== false })
    res.json({ success: true })
  } catch (error) {
    logError(error as Error, { endpoint: '/api/admin/drawings/:id/flag' })
    res.status(500).json({ error: 'Failed to flag drawing' })
  }
})

/**
 * DELETE /api/admin/drawings/:id - Soft-deletes a drawing.
 * Sets deleted_at timestamp; drawing can be restored later.
 */
router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    await pool.query(
      'UPDATE drawings SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [id]
    )

    // Invalidate stats cache
    await cacheDelete(CacheKeys.adminStats())

    logger.info({ msg: 'Drawing soft-deleted', drawingId: id })
    res.json({ success: true })
  } catch (error) {
    logError(error as Error, { endpoint: '/api/admin/drawings/:id' })
    res.status(500).json({ error: 'Failed to delete drawing' })
  }
})

/**
 * POST /api/admin/drawings/:id/restore - Restores a soft-deleted drawing.
 * Clears the deleted_at timestamp.
 */
router.post('/:id/restore', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    await pool.query(
      'UPDATE drawings SET deleted_at = NULL WHERE id = $1',
      [id]
    )

    // Invalidate stats cache
    await cacheDelete(CacheKeys.adminStats())

    logger.info({ msg: 'Drawing restored', drawingId: id })
    res.json({ success: true })
  } catch (error) {
    logError(error as Error, { endpoint: '/api/admin/drawings/:id/restore' })
    res.status(500).json({ error: 'Failed to restore drawing' })
  }
})

/**
 * GET /api/admin/drawings/:id/strokes - Returns the raw stroke data for a drawing.
 * Fetches from MinIO object storage.
 */
router.get('/:id/strokes', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    // Get the stroke data path from the database
    const result = await pool.query(
      'SELECT stroke_data_path FROM drawings WHERE id = $1',
      [id]
    )

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Drawing not found' })
      return
    }

    const strokeDataPath = result.rows[0].stroke_data_path

    // Fetch from MinIO with circuit breaker
    const strokeData = await minioCircuitBreaker.execute(async () => {
      return trackExternalCall('minio', 'getObject', async () => {
        return getDrawing(strokeDataPath)
      })
    })

    res.json(strokeData)
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      res.status(503).json({
        error: 'Storage temporarily unavailable',
        retryAfter: Math.ceil(error.retryAfterMs / 1000),
      })
      return
    }

    logError(error as Error, { endpoint: '/api/admin/drawings/:id/strokes' })
    res.status(500).json({ error: 'Failed to fetch stroke data' })
  }
})

/**
 * GET /api/admin/drawings/:id/quality - Analyzes quality of a single drawing.
 * Returns detailed quality score with individual check results.
 */
router.get('/:id/quality', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    // Get the stroke data path from the database
    const result = await pool.query(
      'SELECT stroke_data_path FROM drawings WHERE id = $1',
      [id]
    )

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Drawing not found' })
      return
    }

    const strokeDataPath = result.rows[0].stroke_data_path

    // Fetch from MinIO
    const strokeData = await getDrawing(strokeDataPath) as StrokeData

    // Score the drawing
    const quality = scoreDrawing(strokeData)

    res.json({
      drawingId: id,
      quality,
    })
  } catch (error) {
    logError(error as Error, { endpoint: '/api/admin/drawings/:id/quality' })
    res.status(500).json({ error: 'Failed to analyze drawing quality' })
  }
})

export { router as drawingsRouter }
