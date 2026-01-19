/**
 * @fileoverview Activity retrieval router.
 * Provides endpoints for fetching activities, GPS points, and comments.
 * @module routes/activities/get
 */

import { Router, Response } from 'express';
import { query } from '../../utils/db.js';
import { optionalAuth, AuthenticatedRequest } from '../../middleware/auth.js';
import { activityLogger as log, logError, ErrorWithCode } from '../../shared/logger.js';
import { ActivityRow, SegmentEffortRow, GpsPointRow } from './types.js';

const router = Router();

/**
 * @description GET / - Retrieve paginated list of public activities.
 * Returns activities ordered by start time with optional filtering by type and user.
 * Includes user information and engagement counts (kudos, comments).
 *
 * @route GET /activities
 * @authentication Optional
 * @param req.query.limit - Maximum number of activities to return. Defaults to 20
 * @param req.query.offset - Number of activities to skip. Defaults to 0
 * @param req.query.type - Filter by activity type (e.g., 'run', 'ride')
 * @param req.query.userId - Filter by user ID
 * @returns 200 - Array of activities with user data
 * @returns 500 - Server error
 * @example
 * // Request
 * GET /activities?limit=10&type=run
 *
 * // Response 200
 * { "activities": [{ "id": "...", "name": "Morning Run", ... }] }
 */
router.get('/', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const type = req.query.type as string | undefined;
    const queryUserId = req.query.userId as string | undefined;

    let whereClause = "WHERE a.privacy = 'public'";
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (type) {
      whereClause += ` AND a.type = $${paramIndex++}`;
      params.push(type);
    }

    if (queryUserId) {
      whereClause += ` AND a.user_id = $${paramIndex++}`;
      params.push(queryUserId);
    }

    params.push(limit, offset);

    const result = await query<ActivityRow>(
      `SELECT a.*, u.username, u.profile_photo,
              (SELECT COUNT(*) FROM kudos WHERE activity_id = a.id) as kudos_count,
              (SELECT COUNT(*) FROM comments WHERE activity_id = a.id) as comment_count
       FROM activities a
       JOIN users u ON a.user_id = u.id
       ${whereClause}
       ORDER BY a.start_time DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );

    res.json({ activities: result.rows });
  } catch (error) {
    logError(log, error as ErrorWithCode, 'Get activities error');
    res.status(500).json({ error: 'Failed to get activities' });
  }
});

/**
 * @description GET /:id - Retrieve a single activity by ID.
 * Returns full activity details with user info, kudos status, and segment efforts.
 * Respects privacy settings and follower relationships.
 *
 * @route GET /activities/:id
 * @authentication Optional (required for private/followers-only activities)
 * @param req.params.id - The activity UUID
 * @returns 200 - Activity with kudosCount, hasKudos, and segmentEfforts
 * @returns 403 - Activity is private and user lacks access
 * @returns 404 - Activity not found
 * @returns 500 - Server error
 * @example
 * // Request
 * GET /activities/550e8400-e29b-41d4-a716-446655440000
 *
 * // Response 200
 * { "id": "...", "name": "Morning Run", "kudosCount": 5, "hasKudos": true, "segmentEfforts": [...] }
 */
router.get('/:id', optionalAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const result = await query<ActivityRow>(
      `SELECT a.*, u.username, u.profile_photo
       FROM activities a
       JOIN users u ON a.user_id = u.id
       WHERE a.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Activity not found' });
      return;
    }

    const activity = result.rows[0];

    // Check privacy
    if (activity.privacy !== 'public' && activity.user_id !== req.session?.userId) {
      if (activity.privacy === 'followers' && req.session?.userId) {
        const followResult = await query<{ count: string }>(
          'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2',
          [req.session.userId, activity.user_id]
        );
        if (followResult.rows.length === 0) {
          res.status(403).json({ error: 'Activity is private' });
          return;
        }
      } else {
        res.status(403).json({ error: 'Activity is private' });
        return;
      }
    }

    // Get kudos count
    const kudosResult = await query<{ count: string }>(
      'SELECT COUNT(*) FROM kudos WHERE activity_id = $1',
      [id]
    );

    // Check if current user has given kudos
    let hasKudos = false;
    if (req.session?.userId) {
      const userKudosResult = await query<{ count: string }>(
        'SELECT 1 FROM kudos WHERE activity_id = $1 AND user_id = $2',
        [id, req.session.userId]
      );
      hasKudos = userKudosResult.rows.length > 0;
    }

    // Get segment efforts for this activity
    const effortsResult = await query<SegmentEffortRow>(
      `SELECT se.*, s.name as segment_name, s.distance as segment_distance
       FROM segment_efforts se
       JOIN segments s ON se.segment_id = s.id
       WHERE se.activity_id = $1
       ORDER BY se.start_index`,
      [id]
    );

    res.json({
      ...activity,
      kudosCount: parseInt(kudosResult.rows[0].count),
      hasKudos,
      segmentEfforts: effortsResult.rows
    });
  } catch (error) {
    logError(log, error as ErrorWithCode, 'Get activity error');
    res.status(500).json({ error: 'Failed to get activity' });
  }
});

/**
 * @description GET /:id/gps - Retrieve GPS points for an activity.
 * Returns all recorded GPS data including coordinates, altitude, speed, and sensor data.
 * Respects activity privacy settings.
 *
 * @route GET /activities/:id/gps
 * @authentication Optional (required for private activities)
 * @param req.params.id - The activity UUID
 * @returns 200 - Array of GPS points ordered by index
 * @returns 403 - Activity is private and user lacks access
 * @returns 404 - Activity not found
 * @returns 500 - Server error
 * @example
 * // Request
 * GET /activities/550e8400-e29b-41d4-a716-446655440000/gps
 *
 * // Response 200
 * { "points": [{ "point_index": 0, "latitude": 37.77, "longitude": -122.41, ... }] }
 */
router.get('/:id/gps', optionalAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const activityResult = await query<{ user_id: string; privacy: string }>(
      'SELECT user_id, privacy FROM activities WHERE id = $1',
      [id]
    );

    if (activityResult.rows.length === 0) {
      res.status(404).json({ error: 'Activity not found' });
      return;
    }

    const activity = activityResult.rows[0];

    if (activity.privacy !== 'public' && activity.user_id !== req.session?.userId) {
      res.status(403).json({ error: 'Activity is private' });
      return;
    }

    const result = await query<GpsPointRow>(
      `SELECT point_index, timestamp, latitude, longitude, altitude, speed, heart_rate, cadence, power
       FROM gps_points
       WHERE activity_id = $1
       ORDER BY point_index`,
      [id]
    );

    res.json({ points: result.rows });
  } catch (error) {
    logError(log, error as ErrorWithCode, 'Get GPS points error');
    res.status(500).json({ error: 'Failed to get GPS points' });
  }
});

/**
 * @description GET /:id/comments - Retrieve comments for an activity.
 * Returns all comments with user information, ordered chronologically.
 *
 * @route GET /activities/:id/comments
 * @authentication None required
 * @param req.params.id - The activity UUID
 * @returns 200 - Array of comments with user data
 * @returns 500 - Server error
 * @example
 * // Request
 * GET /activities/550e8400-e29b-41d4-a716-446655440000/comments
 *
 * // Response 200
 * { "comments": [{ "id": "...", "content": "Great run!", "username": "john", ... }] }
 */
router.get('/:id/comments', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query<{
      id: string;
      content: string;
      created_at: Date;
      user_id: string;
      username: string;
      profile_photo: string | null;
    }>(
      `SELECT c.id, c.content, c.created_at, u.id as user_id, u.username, u.profile_photo
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.activity_id = $1
       ORDER BY c.created_at ASC`,
      [id]
    );

    res.json({ comments: result.rows });
  } catch (error) {
    logError(log, error as ErrorWithCode, 'Get comments error');
    res.status(500).json({ error: 'Failed to get comments' });
  }
});

export default router;
