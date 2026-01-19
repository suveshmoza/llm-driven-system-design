/**
 * @fileoverview Activity simulation router.
 * Provides endpoints to create simulated activities for testing without GPX files.
 * @module routes/activities/simulate
 */

import { Router, Response } from 'express';
import { query } from '../../utils/db.js';
import { requireAuth, AuthenticatedRequest } from '../../middleware/auth.js';
import {
  calculateMetrics,
  encodePolyline,
  calculateBoundingBox,
  generateSampleRoute
} from '../../utils/gps.js';
import {
  activityUploadsTotal,
  activityUploadDuration
} from '../../shared/metrics.js';
import { activityLogger as log, logError, ErrorWithCode } from '../../shared/logger.js';
import { SimulateBody, ActivityRow } from './types.js';
import {
  storeGpsPoints,
  recordGpsMetric,
  triggerSegmentMatching,
  triggerAchievementCheck,
  fanoutToFollowers
} from './helpers.js';

const router = Router();

/**
 * @description POST /simulate - Create a simulated activity with generated GPS data.
 * Generates synthetic GPS points for testing purposes without requiring a GPX file.
 * Useful for development and testing segment matching, achievements, and feed functionality.
 *
 * @route POST /activities/simulate
 * @authentication Required
 * @param req.body.type - Activity type (e.g., 'run', 'ride'). Defaults to 'run'
 * @param req.body.name - Activity name. Defaults to 'Simulated [Type]'
 * @param req.body.startLat - Starting latitude. Defaults to 37.7749 (San Francisco)
 * @param req.body.startLng - Starting longitude. Defaults to -122.4194 (San Francisco)
 * @param req.body.numPoints - Number of GPS points to generate. Defaults to 100
 * @returns 201 - Created activity with gpsPointCount
 * @returns 500 - Server error
 * @example
 * // Request
 * POST /activities/simulate
 * { "type": "ride", "startLat": 40.7128, "startLng": -74.0060, "numPoints": 200 }
 *
 * // Response 201
 * { "activity": {...}, "gpsPointCount": 200 }
 */
router.post('/simulate', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const uploadStart = Date.now();

  try {
    const userId = req.session.userId!;
    const body = req.body as SimulateBody;
    const { type = 'run', name, startLat = 37.7749, startLng = -122.4194, numPoints = 100 } = body;

    const points = generateSampleRoute(startLat, startLng, numPoints, type);
    const metrics = calculateMetrics(points);
    const polylineStr = encodePolyline(points);
    const bbox = calculateBoundingBox(points);

    const activityName = name || `Simulated ${type.charAt(0).toUpperCase() + type.slice(1)}`;

    const activityResult = await query<ActivityRow>(
      `INSERT INTO activities (
        user_id, type, name, start_time, elapsed_time, moving_time,
        distance, elevation_gain, avg_speed, max_speed, polyline,
        start_lat, start_lng, end_lat, end_lng, privacy
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        userId, type, activityName, points[0].timestamp,
        metrics.elapsedTime, metrics.movingTime, metrics.distance, metrics.elevationGain,
        metrics.avgSpeed, metrics.maxSpeed, polylineStr, points[0].latitude, points[0].longitude,
        points[points.length - 1].latitude, points[points.length - 1].longitude, 'public'
      ]
    );

    const activity = activityResult.rows[0];
    log.info({ activityId: activity.id, userId, type, simulated: true }, 'Simulated activity created');

    await storeGpsPoints(activity.id, points);
    recordGpsMetric(type, points.length);

    activityUploadDuration.observe({ type }, (Date.now() - uploadStart) / 1000);
    activityUploadsTotal.inc({ type, status: 'success' });

    triggerSegmentMatching(activity.id, points, type, bbox);
    triggerAchievementCheck(userId, activity);
    await fanoutToFollowers(userId, activity.id, activity.start_time);

    res.status(201).json({ activity, gpsPointCount: points.length });
  } catch (error) {
    activityUploadsTotal.inc({ type: 'unknown', status: 'error' });
    logError(log, error as ErrorWithCode, 'Simulate activity error');
    res.status(500).json({ error: 'Failed to create simulated activity' });
  }
});

export default router;
