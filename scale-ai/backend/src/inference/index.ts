/**
 * Inference service for ML model predictions.
 * Provides API endpoints for classifying drawings using trained models.
 * Currently uses heuristic-based classification; replace with actual ML inference in production.
 * @module inference
 */

import express from 'express'
import cors from 'cors'
import { pool } from '../shared/db.js'
import { getModel } from '../shared/storage.js'

const app = express()

/** Port for the inference service (default: 3003) */
const PORT = parseInt(process.env.PORT || '3003')

/** Shape class names - must match training data order */
const SHAPE_NAMES = ['circle', 'heart', 'line', 'square', 'triangle']

// Middleware
app.use(cors())
app.use(express.json({ limit: '1mb' }))

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'inference' })
})

/**
 * GET /api/inference/model/info - Returns information about the active model.
 * Returns 404 if no model is active (train and activate one first).
 */
app.get('/api/inference/model/info', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.id, m.version, m.accuracy, m.model_path, m.created_at,
             tj.config as training_config,
             tj.metrics as training_metrics
      FROM models m
      LEFT JOIN training_jobs tj ON m.training_job_id = tj.id
      WHERE m.is_active = TRUE
    `)

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'No active model',
        message: 'Train a model first, then activate it',
      })
    }

    const model = result.rows[0]
    res.json({
      id: model.id,
      version: model.version,
      accuracy: model.accuracy,
      created_at: model.created_at,
      class_names: SHAPE_NAMES,
    })
  } catch (error) {
    console.error('Error fetching model info:', error)
    res.status(500).json({ error: 'Failed to fetch model info' })
  }
})

/**
 * POST /api/inference/classify - Classifies a drawing.
 * Accepts stroke data and returns predicted shape with confidence scores.
 * Note: Currently uses heuristic analysis. For production, integrate actual ML model.
 */
app.post('/api/inference/classify', async (req, res) => {
  try {
    const { strokes, canvas } = req.body

    if (!strokes || !Array.isArray(strokes)) {
      return res.status(400).json({ error: 'Missing strokes data' })
    }

    // Check if we have an active model
    const modelResult = await pool.query(
      'SELECT id, version, model_path FROM models WHERE is_active = TRUE'
    )

    if (modelResult.rows.length === 0) {
      return res.status(503).json({
        error: 'No active model',
        message: 'Train and activate a model first',
      })
    }

    const activeModel = modelResult.rows[0]

    // In a real implementation, you would:
    // 1. Convert strokes to 64x64 image
    // 2. Load the model (cached in memory)
    // 3. Run inference
    // 4. Return predictions

    // For demo purposes, we'll return a mock prediction
    // based on simple heuristics

    const prediction = analyzeStrokes(strokes, canvas)

    const startTime = Date.now()
    // Simulate inference time
    await new Promise((resolve) => setTimeout(resolve, 50))
    const inferenceTime = Date.now() - startTime

    res.json({
      prediction: prediction.shape,
      confidence: prediction.confidence,
      all_probabilities: prediction.probabilities,
      class_names: SHAPE_NAMES,
      model_version: activeModel.version,
      inference_time_ms: inferenceTime,
    })
  } catch (error) {
    console.error('Error classifying drawing:', error)
    res.status(500).json({ error: 'Failed to classify drawing' })
  }
})

/**
 * Represents a point in a stroke.
 */
interface StrokePoint {
  x: number
  y: number
}

/**
 * Represents a stroke with its points.
 */
interface Stroke {
  points: StrokePoint[]
}

/**
 * Canvas dimensions.
 */
interface Canvas {
  width: number
  height: number
}

/**
 * Analyzes stroke data using heuristics to predict the drawn shape.
 * This is a placeholder for real ML inference - uses bounding box aspect ratio,
 * stroke count, and other simple features to make predictions.
 *
 * @param strokes - Array of strokes from the drawing
 * @param canvas - Canvas dimensions
 * @returns Prediction with shape name, confidence, and all class probabilities
 */
function analyzeStrokes(strokes: Stroke[], canvas: Canvas) {
  const allPoints: StrokePoint[] = strokes.flatMap((s) => s.points)

  if (allPoints.length < 2) {
    return {
      shape: 'line',
      confidence: 0.5,
      probabilities: SHAPE_NAMES.map((name) => ({
        class: name,
        probability: name === 'line' ? 0.5 : 0.125,
      })),
    }
  }

  // Calculate bounding box
  const xs = allPoints.map((p) => p.x)
  const ys = allPoints.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const width = maxX - minX
  const height = maxY - minY

  // Calculate aspect ratio
  const aspectRatio = width / (height || 1)

  // Count strokes
  const strokeCount = strokes.length

  // Analyze shape based on simple heuristics
  let probabilities: Record<string, number> = {
    line: 0.1,
    circle: 0.1,
    square: 0.1,
    triangle: 0.1,
    heart: 0.1,
  }

  // Line detection: high aspect ratio or very few strokes with straight path
  if (aspectRatio > 3 || aspectRatio < 0.33) {
    probabilities.line += 0.4
  }

  // Circle detection: roughly square bounding box, one stroke
  if (aspectRatio > 0.8 && aspectRatio < 1.2 && strokeCount === 1) {
    probabilities.circle += 0.4
  }

  // Square detection: roughly square bounding box, 4+ strokes or sharp corners
  if (aspectRatio > 0.8 && aspectRatio < 1.2 && strokeCount >= 1) {
    probabilities.square += 0.2
  }

  // Triangle detection: 3 strokes or triangular distribution
  if (strokeCount === 3 || strokeCount === 1) {
    probabilities.triangle += 0.2
  }

  // Heart detection: 2 strokes typically, wider at top
  if (strokeCount <= 2) {
    probabilities.heart += 0.2
  }

  // Normalize probabilities
  const total = Object.values(probabilities).reduce((a, b) => a + b, 0)
  for (const key of Object.keys(probabilities)) {
    probabilities[key] /= total
  }

  // Find best prediction
  const sorted = Object.entries(probabilities).sort((a, b) => b[1] - a[1])
  const bestShape = sorted[0][0]
  const bestConfidence = sorted[0][1]

  return {
    shape: bestShape,
    confidence: bestConfidence,
    probabilities: SHAPE_NAMES.map((name) => ({
      class: name,
      probability: probabilities[name] || 0,
    })),
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`Inference service running on http://localhost:${PORT}`)
})
