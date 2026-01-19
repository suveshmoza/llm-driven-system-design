import { query } from '../../utils/db.js';
import { addToFeed } from '../../utils/redis.js';
import { matchActivityToSegments } from '../../services/segmentMatcher.js';
import { checkAchievements } from '../../services/achievements.js';
import {
  activityGpsPointsTotal,
  feedFanoutDuration
} from '../../shared/metrics.js';
import { activityLogger as log, logError, ErrorWithCode } from '../../shared/logger.js';
import { GpsPoint, BoundingBox } from '../../utils/gps.js';
import { ActivityRow } from './types.js';

/**
 * @description Stores GPS points for an activity in the database.
 * Inserts each point sequentially with its index, timestamp, coordinates, and sensor data.
 * @param activityId - The UUID of the activity to associate points with
 * @param points - Array of GPS points to store
 * @returns Promise that resolves when all points are stored
 * @throws Database errors if insertion fails
 * @example
 * const points = [{ latitude: 37.77, longitude: -122.41, timestamp: new Date(), ... }];
 * await storeGpsPoints('activity-uuid', points);
 */
export async function storeGpsPoints(
  activityId: string,
  points: GpsPoint[]
): Promise<void> {
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    await query(
      `INSERT INTO gps_points (activity_id, point_index, timestamp, latitude, longitude, altitude, heart_rate, cadence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [activityId, i, pt.timestamp, pt.latitude, pt.longitude, pt.altitude, pt.heartRate, pt.cadence]
    );
  }
}

/**
 * @description Records a metric for GPS points processed.
 * Increments the Prometheus counter for activity GPS points by type and count.
 * @param activityType - The type of activity (e.g., 'run', 'ride')
 * @param pointCount - Number of GPS points to record
 * @example
 * recordGpsMetric('run', 150);
 */
export function recordGpsMetric(activityType: string, pointCount: number): void {
  activityGpsPointsTotal.inc({ type: activityType }, pointCount);
}

/**
 * @description Initiates asynchronous segment matching for an activity.
 * Matches the activity's GPS points against known segments using a two-phase algorithm
 * (bounding box filtering followed by precise GPS matching). Errors are logged but not thrown.
 * @param activityId - The UUID of the activity to match
 * @param points - Array of GPS points from the activity
 * @param activityType - The type of activity (e.g., 'run', 'ride')
 * @param bbox - Bounding box of the activity route, or null if not calculated
 * @example
 * triggerSegmentMatching('activity-uuid', points, 'run', { minLat: 37, maxLat: 38, minLng: -123, maxLng: -122 });
 */
export function triggerSegmentMatching(
  activityId: string,
  points: GpsPoint[],
  activityType: string,
  bbox: BoundingBox | null
): void {
  matchActivityToSegments(activityId, points, activityType, bbox).catch(err => {
    logError(log, err as ErrorWithCode, 'Segment matching error', { activityId });
  });
}

/**
 * @description Initiates asynchronous achievement checking for a user after an activity.
 * Evaluates the activity against defined achievement criteria (distance milestones, elevation PRs, etc.).
 * Errors are logged but not thrown.
 * @param userId - The UUID of the user to check achievements for
 * @param activity - The activity row data to evaluate
 * @example
 * triggerAchievementCheck('user-uuid', { id: 'activity-uuid', type: 'run', distance: 10000, ... });
 */
export function triggerAchievementCheck(
  userId: string,
  activity: ActivityRow
): void {
  checkAchievements(userId, {
    id: activity.id,
    user_id: activity.user_id,
    type: activity.type,
    name: activity.name,
    distance: activity.distance,
    elevation_gain: activity.elevation_gain
  }).catch(err => {
    logError(log, err as ErrorWithCode, 'Achievement check error', { userId, activityId: activity.id });
  });
}

/**
 * @description Distributes an activity to followers' feeds using fan-out on write strategy.
 * Adds the activity to the Redis feed of each follower and the activity owner.
 * Also records the fanout duration metric bucketed by follower count.
 * @param userId - The UUID of the user who created the activity
 * @param activityId - The UUID of the activity to distribute
 * @param startTime - The start time of the activity, used as the feed score
 * @returns Promise that resolves when all feeds are updated
 * @throws Database or Redis errors if queries fail
 * @example
 * await fanoutToFollowers('user-uuid', 'activity-uuid', new Date('2024-01-15T10:30:00Z'));
 */
export async function fanoutToFollowers(
  userId: string,
  activityId: string,
  startTime: Date
): Promise<void> {
  const fanoutStart = Date.now();

  const followersResult = await query<{ follower_id: string }>(
    'SELECT follower_id FROM follows WHERE following_id = $1',
    [userId]
  );

  const timestamp = new Date(startTime).getTime();
  for (const row of followersResult.rows) {
    await addToFeed(row.follower_id, activityId, timestamp);
  }
  await addToFeed(userId, activityId, timestamp);

  const followerCount = followersResult.rows.length;
  const followerBucket = followerCount < 10 ? '0-10' : followerCount < 100 ? '10-100' : followerCount < 1000 ? '100-1000' : '1000+';
  feedFanoutDuration.observe({ follower_count_bucket: followerBucket }, (Date.now() - fanoutStart) / 1000);
}
