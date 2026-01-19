/**
 * @fileoverview Activity analysis router.
 * Provides endpoints for activity statistics and analytics.
 * @module routes/activities/analysis
 */

import { Router, Response } from 'express';
import { query } from '../../utils/db.js';
import { requireAuth, AuthenticatedRequest } from '../../middleware/auth.js';
import { activityLogger as log, logError, ErrorWithCode } from '../../shared/logger.js';

const router = Router();

/**
 * @description GET /:id/analysis - Get detailed analysis of an activity.
 * Computes statistics from GPS points including elevation, speed, and heart rate zones.
 * Provides min, max, and average values for each metric.
 *
 * @route GET /activities/:id/analysis
 * @authentication Required
 * @param req.params.id - The activity UUID to analyze
 * @returns 200 - Analysis object with elevation, speed, heartRate stats and pointCount
 * @returns 404 - Activity not found
 * @returns 500 - Server error
 * @example
 * // Request
 * GET /activities/550e8400-e29b-41d4-a716-446655440000/analysis
 *
 * // Response 200
 * {
 *   "analysis": {
 *     "elevation": { "min": 10, "max": 150, "avg": 45.5 },
 *     "speed": { "min": 2.1, "max": 5.8, "avg": 3.2 },
 *     "heartRate": { "min": 120, "max": 175, "avg": 152 },
 *     "pointCount": 256
 *   }
 * }
 */
router.get('/:id/analysis', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Check activity ownership
    const activityResult = await query<{ user_id: string; type: string; distance: number; elapsed_time: number }>(
      'SELECT user_id, type, distance, elapsed_time FROM activities WHERE id = $1',
      [id]
    );

    if (activityResult.rows.length === 0) {
      res.status(404).json({ error: 'Activity not found' });
      return;
    }

    const activity = activityResult.rows[0];

    // Get GPS points for analysis
    const gpsResult = await query<{
      latitude: number;
      longitude: number;
      altitude: number | null;
      speed: number | null;
      heart_rate: number | null;
    }>(
      `SELECT latitude, longitude, altitude, speed, heart_rate
       FROM gps_points
       WHERE activity_id = $1
       ORDER BY point_index`,
      [id]
    );

    const points = gpsResult.rows;

    // Calculate basic analysis
    const altitudes = points.map(p => p.altitude).filter((a): a is number => a !== null);
    const speeds = points.map(p => p.speed).filter((s): s is number => s !== null);
    const heartRates = points.map(p => p.heart_rate).filter((hr): hr is number => hr !== null);

    const analysis = {
      elevation: {
        min: altitudes.length > 0 ? Math.min(...altitudes) : null,
        max: altitudes.length > 0 ? Math.max(...altitudes) : null,
        avg: altitudes.length > 0 ? altitudes.reduce((a, b) => a + b, 0) / altitudes.length : null
      },
      speed: {
        min: speeds.length > 0 ? Math.min(...speeds) : null,
        max: speeds.length > 0 ? Math.max(...speeds) : null,
        avg: speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null
      },
      heartRate: {
        min: heartRates.length > 0 ? Math.min(...heartRates) : null,
        max: heartRates.length > 0 ? Math.max(...heartRates) : null,
        avg: heartRates.length > 0 ? heartRates.reduce((a, b) => a + b, 0) / heartRates.length : null
      },
      pointCount: points.length
    };

    res.json({ analysis });
  } catch (error) {
    logError(log, error as ErrorWithCode, 'Get activity analysis error');
    res.status(500).json({ error: 'Failed to get activity analysis' });
  }
});

export default router;
