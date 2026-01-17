/**
 * Quality scoring for drawing data.
 * Evaluates drawings based on heuristics to identify low-quality submissions.
 */

interface Point {
  x: number
  y: number
  pressure?: number
  timestamp?: number
}

interface Stroke {
  points: Point[]
  color?: string
  width?: number
}

interface StrokeData {
  strokes: Stroke[]
  canvas: { width: number; height: number }
  duration_ms: number
  shape?: string
}

interface QualityCheck {
  name: string
  score: number
  message: string
}

interface QualityResult {
  score: number
  passed: boolean
  checks: QualityCheck[]
  recommendation: string
  metrics: {
    strokeCount: number
    totalPoints: number
    durationMs: number
    bboxWidth: number
    bboxHeight: number
    totalInk: number
  }
}

// Thresholds
const MIN_STROKES = 1
const MAX_STROKES = 20
const MIN_TOTAL_POINTS = 5
const MAX_TOTAL_POINTS = 2000
const MIN_DURATION_MS = 200
const MAX_DURATION_MS = 60000
const MIN_BOUNDING_BOX_RATIO = 0.1

class QualityScorer {
  private strokes: Stroke[]
  private canvasWidth: number
  private canvasHeight: number
  private durationMs: number
  private totalPoints: number = 0
  private minX: number = Infinity
  private maxX: number = -Infinity
  private minY: number = Infinity
  private maxY: number = -Infinity
  private bboxWidth: number = 0
  private bboxHeight: number = 0
  private totalInk: number = 0

  constructor(data: StrokeData) {
    this.strokes = data.strokes || []
    this.canvasWidth = data.canvas?.width || 400
    this.canvasHeight = data.canvas?.height || 400
    this.durationMs = data.duration_ms || 0
    this.computeMetrics()
  }

  private computeMetrics(): void {
    for (const stroke of this.strokes) {
      const points = stroke.points || []
      this.totalPoints += points.length

      for (const pt of points) {
        const x = pt.x || 0
        const y = pt.y || 0
        this.minX = Math.min(this.minX, x)
        this.maxX = Math.max(this.maxX, x)
        this.minY = Math.min(this.minY, y)
        this.maxY = Math.max(this.maxY, y)
      }
    }

    if (this.totalPoints === 0) {
      this.minX = this.maxX = this.minY = this.maxY = 0
    }

    this.bboxWidth = Math.max(0, this.maxX - this.minX)
    this.bboxHeight = Math.max(0, this.maxY - this.minY)
    this.totalInk = this.calculateInkLength()
  }

  private calculateInkLength(): number {
    let total = 0
    for (const stroke of this.strokes) {
      const points = stroke.points || []
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x
        const dy = points[i].y - points[i - 1].y
        total += Math.sqrt(dx * dx + dy * dy)
      }
    }
    return total
  }

  checkStrokeCount(): [number, string] {
    const count = this.strokes.length

    if (count === 0) {
      return [0.0, 'No strokes']
    }
    if (count < MIN_STROKES) {
      return [0.3, `Too few strokes (${count})`]
    }
    if (count > MAX_STROKES) {
      return [0.5, `Too many strokes (${count})`]
    }
    if (count <= 10) {
      return [1.0, 'Good stroke count']
    }
    return [Math.max(0.5, 1.0 - (count - 10) * 0.05), `High stroke count (${count})`]
  }

  checkPointCount(): [number, string] {
    if (this.totalPoints < MIN_TOTAL_POINTS) {
      return [0.2, `Too few points (${this.totalPoints})`]
    }
    if (this.totalPoints > MAX_TOTAL_POINTS) {
      return [0.4, `Too many points (${this.totalPoints})`]
    }
    return [1.0, 'Good point count']
  }

  checkDuration(): [number, string] {
    if (this.durationMs < MIN_DURATION_MS) {
      return [0.3, `Too fast (${this.durationMs}ms)`]
    }
    if (this.durationMs > MAX_DURATION_MS) {
      return [0.7, `Very slow (${this.durationMs}ms)`]
    }
    if (this.durationMs >= 500 && this.durationMs <= 10000) {
      return [1.0, 'Good duration']
    }
    if (this.durationMs < 500) {
      return [0.6, `Quick drawing (${this.durationMs}ms)`]
    }
    return [0.8, `Slow drawing (${this.durationMs}ms)`]
  }

  checkBoundingBox(): [number, string] {
    if (this.totalPoints === 0) {
      return [0.0, 'Empty drawing']
    }

    const canvasArea = this.canvasWidth * this.canvasHeight
    const bboxArea = this.bboxWidth * this.bboxHeight

    if (canvasArea === 0) {
      return [0.5, 'Invalid canvas']
    }

    const ratio = bboxArea / canvasArea

    if (ratio < MIN_BOUNDING_BOX_RATIO) {
      return [0.4, `Drawing too small (${(ratio * 100).toFixed(1)}% of canvas)`]
    }
    if (ratio > 0.9) {
      return [0.9, 'Drawing spans most of canvas']
    }

    if (this.bboxWidth > 0 && this.bboxHeight > 0) {
      const aspect = this.bboxWidth / this.bboxHeight
      if (aspect < 0.1 || aspect > 10) {
        return [0.6, `Extreme aspect ratio (${aspect.toFixed(2)})`]
      }
    }

    return [1.0, 'Good bounding box']
  }

  checkInkCoverage(): [number, string] {
    if (this.totalPoints === 0) {
      return [0.0, 'No ink']
    }

    const canvasDiagonal = Math.sqrt(
      this.canvasWidth ** 2 + this.canvasHeight ** 2
    )

    if (canvasDiagonal === 0) {
      return [0.5, 'Invalid canvas']
    }

    const coverageRatio = this.totalInk / canvasDiagonal

    if (coverageRatio < 0.01) {
      return [0.3, `Very little ink (${coverageRatio.toFixed(3)})`]
    }
    if (coverageRatio > 5.0) {
      return [0.4, `Excessive ink (${coverageRatio.toFixed(1)}x diagonal)`]
    }

    return [1.0, 'Good ink coverage']
  }

  checkStrokeQuality(): [number, string] {
    if (this.strokes.length === 0) {
      return [0.0, 'No strokes']
    }

    const issues: string[] = []

    for (let i = 0; i < this.strokes.length; i++) {
      const stroke = this.strokes[i]
      const points = stroke.points || []

      if (points.length < 2) {
        issues.push(`Stroke ${i + 1} has only ${points.length} point(s)`)
      }

      if (points.length >= 2) {
        const uniquePoints = new Set(points.map((p) => `${p.x},${p.y}`))
        if (uniquePoints.size === 1) {
          issues.push(`Stroke ${i + 1} has no movement`)
        }
      }
    }

    if (issues.length > 0) {
      if (issues.length > 3) {
        return [0.3, `${issues.length} stroke issues`]
      }
      return [0.6, issues.slice(0, 2).join('; ')]
    }

    return [1.0, 'Good stroke quality']
  }

  calculateScore(): QualityResult {
    const checks: Array<[string, [number, string]]> = [
      ['stroke_count', this.checkStrokeCount()],
      ['point_count', this.checkPointCount()],
      ['duration', this.checkDuration()],
      ['bounding_box', this.checkBoundingBox()],
      ['ink_coverage', this.checkInkCoverage()],
      ['stroke_quality', this.checkStrokeQuality()],
    ]

    const weights: Record<string, number> = {
      stroke_count: 1.0,
      point_count: 1.0,
      duration: 0.5,
      bounding_box: 1.5,
      ink_coverage: 1.0,
      stroke_quality: 1.0,
    }

    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0)
    const weightedSum = checks.reduce(
      (sum, [name, [score]]) => sum + weights[name] * score,
      0
    )

    const finalScore = (weightedSum / totalWeight) * 100

    const checkResults: QualityCheck[] = checks.map(([name, [score, message]]) => ({
      name,
      score: Math.round(score * 100 * 10) / 10,
      message,
    }))

    let recommendation: string
    if (finalScore >= 70) {
      recommendation = 'Include in training'
    } else if (finalScore >= 50) {
      recommendation = 'Review manually'
    } else {
      recommendation = 'Exclude from training'
    }

    return {
      score: Math.round(finalScore * 10) / 10,
      passed: finalScore >= 50,
      checks: checkResults,
      recommendation,
      metrics: {
        strokeCount: this.strokes.length,
        totalPoints: this.totalPoints,
        durationMs: this.durationMs,
        bboxWidth: Math.round(this.bboxWidth * 10) / 10,
        bboxHeight: Math.round(this.bboxHeight * 10) / 10,
        totalInk: Math.round(this.totalInk * 10) / 10,
      },
    }
  }
}

export function scoreDrawing(strokeData: StrokeData): QualityResult {
  const scorer = new QualityScorer(strokeData)
  return scorer.calculateScore()
}

export type { StrokeData, QualityResult, QualityCheck }
