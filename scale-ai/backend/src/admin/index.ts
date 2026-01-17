import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { pool } from '../shared/db.js'
import { publishTrainingJob } from '../shared/queue.js'
import { getDrawing } from '../shared/storage.js'
import { cacheGet, cacheSet, cacheDelete, CacheKeys } from '../shared/cache.js'
import { validateLogin, createSession, getSession, deleteSession } from '../shared/auth.js'
import { scoreDrawing, type StrokeData } from '../shared/quality.js'
import { v4 as uuidv4 } from 'uuid'

const app = express()
const PORT = parseInt(process.env.PORT || '3002')

// Session interface for typed requests
interface AdminSession {
  userId: string
  email: string
  name: string | null
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      adminSession?: AdminSession
    }
  }
}

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json())
app.use(cookieParser())

// Auth middleware - now uses session cookies
async function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const sessionId = req.cookies.adminSession

  if (!sessionId) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  const session = await getSession(sessionId)
  if (!session) {
    return res.status(401).json({ error: 'Session expired' })
  }

  // Attach session to request
  req.adminSession = {
    userId: session.userId,
    email: session.email,
    name: session.name,
  }

  next()
}

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'admin' })
})

// Login endpoint
app.post('/api/admin/auth/login', async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }

    const user = await validateLogin(email, password)
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const { sessionId, ttl } = await createSession(user.id, user.email, user.name, rememberMe)

    res.cookie('adminSession', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: ttl * 1000, // Convert seconds to milliseconds
    })

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ error: 'Login failed' })
  }
})

// Logout endpoint
app.post('/api/admin/auth/logout', async (req, res) => {
  const sessionId = req.cookies.adminSession

  if (sessionId) {
    await deleteSession(sessionId)
  }

  res.clearCookie('adminSession')
  res.json({ success: true })
})

// Get current user
app.get('/api/admin/auth/me', requireAdmin, (req, res) => {
  res.json({ user: req.adminSession })
})

// Dashboard stats (cached for 30 seconds)
app.get('/api/admin/stats', requireAdmin, async (_req, res) => {
  try {
    // Check cache first
    const cacheKey = CacheKeys.adminStats()
    const cached = await cacheGet<object>(cacheKey)
    if (cached) {
      return res.json(cached)
    }

    // Total drawings
    const totalDrawings = await pool.query('SELECT COUNT(*) as count FROM drawings')

    // Drawings per shape
    const perShape = await pool.query(`
      SELECT s.name, COUNT(d.id) as count
      FROM shapes s
      LEFT JOIN drawings d ON d.shape_id = s.id
      GROUP BY s.id, s.name
      ORDER BY s.name
    `)

    // Flagged drawings
    const flagged = await pool.query(
      'SELECT COUNT(*) as count FROM drawings WHERE is_flagged = TRUE'
    )

    // Today's drawings
    const today = await pool.query(`
      SELECT COUNT(*) as count FROM drawings
      WHERE created_at > NOW() - INTERVAL '1 day'
    `)

    // Total users
    const totalUsers = await pool.query('SELECT COUNT(*) as count FROM users')

    // Active model
    const activeModel = await pool.query(`
      SELECT id, version, accuracy, created_at
      FROM models WHERE is_active = TRUE
    `)

    // Recent training jobs
    const recentJobs = await pool.query(`
      SELECT id, status, created_at, completed_at,
             metrics->>'accuracy' as accuracy
      FROM training_jobs
      ORDER BY created_at DESC
      LIMIT 5
    `)

    const stats = {
      total_drawings: parseInt(totalDrawings.rows[0].count),
      drawings_per_shape: perShape.rows,
      flagged_count: parseInt(flagged.rows[0].count),
      today_count: parseInt(today.rows[0].count),
      total_users: parseInt(totalUsers.rows[0].count),
      active_model: activeModel.rows[0] || null,
      recent_jobs: recentJobs.rows,
    }

    // Cache for 30 seconds
    await cacheSet(cacheKey, stats, 30)

    res.json(stats)
  } catch (error) {
    console.error('Error fetching stats:', error)
    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})

// List drawings with pagination and filters
app.get('/api/admin/drawings', requireAdmin, async (req, res) => {
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
    console.error('Error fetching drawings:', error)
    res.status(500).json({ error: 'Failed to fetch drawings' })
  }
})

// Flag/unflag a drawing
app.post('/api/admin/drawings/:id/flag', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { flagged } = req.body

    await pool.query(
      'UPDATE drawings SET is_flagged = $1 WHERE id = $2',
      [flagged !== false, id]
    )

    // Invalidate stats cache since flagged count changed
    await cacheDelete(CacheKeys.adminStats())

    res.json({ success: true })
  } catch (error) {
    console.error('Error flagging drawing:', error)
    res.status(500).json({ error: 'Failed to flag drawing' })
  }
})

// Soft delete a drawing
app.delete('/api/admin/drawings/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params

    await pool.query(
      'UPDATE drawings SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [id]
    )

    // Invalidate stats cache
    await cacheDelete(CacheKeys.adminStats())

    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting drawing:', error)
    res.status(500).json({ error: 'Failed to delete drawing' })
  }
})

// Restore a soft-deleted drawing
app.post('/api/admin/drawings/:id/restore', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params

    await pool.query(
      'UPDATE drawings SET deleted_at = NULL WHERE id = $1',
      [id]
    )

    // Invalidate stats cache
    await cacheDelete(CacheKeys.adminStats())

    res.json({ success: true })
  } catch (error) {
    console.error('Error restoring drawing:', error)
    res.status(500).json({ error: 'Failed to restore drawing' })
  }
})

// Get stroke data for a drawing
app.get('/api/admin/drawings/:id/strokes', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params

    // Get the stroke data path from the database
    const result = await pool.query(
      'SELECT stroke_data_path FROM drawings WHERE id = $1',
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Drawing not found' })
    }

    const strokeDataPath = result.rows[0].stroke_data_path

    // Fetch from MinIO
    const strokeData = await getDrawing(strokeDataPath)

    res.json(strokeData)
  } catch (error) {
    console.error('Error fetching stroke data:', error)
    res.status(500).json({ error: 'Failed to fetch stroke data' })
  }
})

// Analyze quality of a single drawing
app.get('/api/admin/drawings/:id/quality', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params

    // Get the stroke data path from the database
    const result = await pool.query(
      'SELECT stroke_data_path FROM drawings WHERE id = $1',
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Drawing not found' })
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
    console.error('Error analyzing drawing quality:', error)
    res.status(500).json({ error: 'Failed to analyze drawing quality' })
  }
})

// Batch analyze quality and update scores
app.post('/api/admin/quality/analyze-batch', requireAdmin, async (req, res) => {
  try {
    const { minScore, limit = 100, updateScores = false } = req.body

    // Fetch drawings that need quality analysis (null quality_score)
    let query = `
      SELECT d.id, d.stroke_data_path, s.name as shape
      FROM drawings d
      JOIN shapes s ON d.shape_id = s.id
      WHERE d.quality_score IS NULL AND d.deleted_at IS NULL
      LIMIT $1
    `
    const result = await pool.query(query, [limit])

    const analyzed: {
      id: string
      shape: string
      score: number
      passed: boolean
      recommendation: string
    }[] = []

    const failed: { id: string; error: string }[] = []

    for (const drawing of result.rows) {
      try {
        // Fetch stroke data
        const strokeData = await getDrawing(drawing.stroke_data_path) as StrokeData

        // Score the drawing
        const quality = scoreDrawing(strokeData)

        analyzed.push({
          id: drawing.id,
          shape: drawing.shape,
          score: quality.score,
          passed: quality.passed,
          recommendation: quality.recommendation,
        })

        // Update quality score in database if requested
        if (updateScores) {
          await pool.query(
            'UPDATE drawings SET quality_score = $1 WHERE id = $2',
            [quality.score, drawing.id]
          )
        }
      } catch (error) {
        failed.push({
          id: drawing.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    // Compute summary statistics
    const passedCount = analyzed.filter((d) => d.passed).length
    const avgScore = analyzed.length > 0
      ? analyzed.reduce((sum, d) => sum + d.score, 0) / analyzed.length
      : 0

    // If minScore is provided, auto-flag low quality drawings
    let flaggedCount = 0
    if (minScore !== undefined && updateScores) {
      const lowQuality = analyzed.filter((d) => d.score < minScore)
      for (const drawing of lowQuality) {
        await pool.query(
          'UPDATE drawings SET is_flagged = TRUE WHERE id = $1',
          [drawing.id]
        )
        flaggedCount++
      }
      if (flaggedCount > 0) {
        await cacheDelete(CacheKeys.adminStats())
      }
    }

    res.json({
      analyzed: analyzed.length,
      failed: failed.length,
      passed: passedCount,
      avgScore: Math.round(avgScore * 10) / 10,
      flagged: flaggedCount,
      results: analyzed,
      errors: failed,
      message: updateScores
        ? `Analyzed ${analyzed.length} drawings, updated scores${flaggedCount > 0 ? `, flagged ${flaggedCount} low quality` : ''}`
        : `Analyzed ${analyzed.length} drawings (dry run, scores not saved)`,
    })
  } catch (error) {
    console.error('Error in batch quality analysis:', error)
    res.status(500).json({ error: 'Failed to analyze drawings' })
  }
})

// Get quality statistics
app.get('/api/admin/quality/stats', requireAdmin, async (_req, res) => {
  try {
    // Overall quality score distribution
    const distribution = await pool.query(`
      SELECT
        CASE
          WHEN quality_score >= 70 THEN 'high'
          WHEN quality_score >= 50 THEN 'medium'
          WHEN quality_score IS NOT NULL THEN 'low'
          ELSE 'unscored'
        END as quality_tier,
        COUNT(*) as count
      FROM drawings
      WHERE deleted_at IS NULL
      GROUP BY quality_tier
    `)

    // Average score per shape
    const perShape = await pool.query(`
      SELECT s.name as shape, AVG(d.quality_score) as avg_score, COUNT(d.id) as count
      FROM drawings d
      JOIN shapes s ON d.shape_id = s.id
      WHERE d.quality_score IS NOT NULL AND d.deleted_at IS NULL
      GROUP BY s.name
      ORDER BY s.name
    `)

    // Unscored count
    const unscored = await pool.query(`
      SELECT COUNT(*) as count
      FROM drawings
      WHERE quality_score IS NULL AND deleted_at IS NULL
    `)

    res.json({
      distribution: distribution.rows,
      perShape: perShape.rows.map((r) => ({
        shape: r.shape,
        avgScore: r.avg_score ? Math.round(parseFloat(r.avg_score) * 10) / 10 : null,
        count: parseInt(r.count),
      })),
      unscoredCount: parseInt(unscored.rows[0].count),
    })
  } catch (error) {
    console.error('Error fetching quality stats:', error)
    res.status(500).json({ error: 'Failed to fetch quality statistics' })
  }
})

// Start a training job
app.post('/api/admin/training/start', requireAdmin, async (req, res) => {
  try {
    const config = req.body.config || {}

    // Create training job record
    const jobId = uuidv4()
    await pool.query(
      `INSERT INTO training_jobs (id, status, config)
       VALUES ($1, 'queued', $2)`,
      [jobId, JSON.stringify(config)]
    )

    // Publish to queue
    await publishTrainingJob(jobId, config)

    res.status(201).json({
      id: jobId,
      status: 'queued',
      message: 'Training job queued',
    })
  } catch (error) {
    console.error('Error starting training job:', error)
    res.status(500).json({ error: 'Failed to start training job' })
  }
})

// Get training job status
app.get('/api/admin/training/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params

    const result = await pool.query(
      `SELECT id, status, config, error_message, started_at, completed_at, metrics, model_path
       FROM training_jobs WHERE id = $1`,
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Training job not found' })
    }

    res.json(result.rows[0])
  } catch (error) {
    console.error('Error fetching training job:', error)
    res.status(500).json({ error: 'Failed to fetch training job' })
  }
})

// List all training jobs
app.get('/api/admin/training', requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, status, config, started_at, completed_at,
             metrics->>'accuracy' as accuracy
      FROM training_jobs
      ORDER BY created_at DESC
      LIMIT 50
    `)

    res.json(result.rows)
  } catch (error) {
    console.error('Error fetching training jobs:', error)
    res.status(500).json({ error: 'Failed to fetch training jobs' })
  }
})

// List models
app.get('/api/admin/models', requireAdmin, async (_req, res) => {
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
    console.error('Error fetching models:', error)
    res.status(500).json({ error: 'Failed to fetch models' })
  }
})

// Activate a model
app.post('/api/admin/models/:id/activate', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params

    // Deactivate all models first
    await pool.query('UPDATE models SET is_active = FALSE')

    // Activate the selected model
    await pool.query('UPDATE models SET is_active = TRUE WHERE id = $1', [id])

    res.json({ success: true, message: 'Model activated' })
  } catch (error) {
    console.error('Error activating model:', error)
    res.status(500).json({ error: 'Failed to activate model' })
  }
})

// Start server
app.listen(PORT, () => {
  console.log(`Admin service running on http://localhost:${PORT}`)
})
