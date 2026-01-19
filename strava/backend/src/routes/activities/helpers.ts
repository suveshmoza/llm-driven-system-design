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

// Store GPS points for an activity
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

// Record GPS points metric
export function recordGpsMetric(activityType: string, pointCount: number): void {
  activityGpsPointsTotal.inc({ type: activityType }, pointCount);
}

// Trigger async segment matching
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

// Trigger async achievement check
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

// Fan out activity to followers' feeds
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
