import { pool } from './db.js';
import { logger } from './logger.js';

/** Aggregated video analytics including views, unique viewers, watch duration, and completion rate. */
export interface AnalyticsSummary {
  totalViews: number;
  uniqueViewers: number;
  avgWatchDurationSeconds: number;
  completionRate: number;
  viewsByDay: { date: string; views: number }[];
}

/** Retrieves aggregated analytics for a video over a given number of days. */
export async function getVideoAnalytics(
  videoId: string,
  days: number = 30,
): Promise<AnalyticsSummary> {
  try {
    // Total views and unique viewers
    const statsResult = await pool.query(
      `SELECT
        COUNT(*) as total_views,
        COUNT(DISTINCT COALESCE(viewer_id::text, session_id)) as unique_viewers,
        COALESCE(AVG(watch_duration_seconds), 0) as avg_watch_duration,
        CASE
          WHEN COUNT(*) > 0
          THEN (COUNT(*) FILTER (WHERE completed = true)::float / COUNT(*)::float) * 100
          ELSE 0
        END as completion_rate
      FROM view_events
      WHERE video_id = $1
        AND created_at >= NOW() - INTERVAL '1 day' * $2`,
      [videoId, days],
    );

    const stats = statsResult.rows[0];

    // Views by day
    const dailyResult = await pool.query(
      `SELECT
        DATE(created_at) as date,
        COUNT(*) as views
      FROM view_events
      WHERE video_id = $1
        AND created_at >= NOW() - INTERVAL '1 day' * $2
      GROUP BY DATE(created_at)
      ORDER BY date ASC`,
      [videoId, days],
    );

    return {
      totalViews: parseInt(stats.total_views, 10),
      uniqueViewers: parseInt(stats.unique_viewers, 10),
      avgWatchDurationSeconds: parseFloat(stats.avg_watch_duration),
      completionRate: parseFloat(stats.completion_rate),
      viewsByDay: dailyResult.rows.map((row) => ({
        date: row.date.toISOString().split('T')[0],
        views: parseInt(row.views, 10),
      })),
    };
  } catch (err) {
    logger.error({ err, videoId }, 'Failed to get video analytics');
    throw err;
  }
}

/** Records a video view event and increments the video's view count. */
export async function recordViewEvent(
  videoId: string,
  viewerId: string | null,
  sessionId: string,
  watchDurationSeconds: number,
  completed: boolean,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO view_events (video_id, viewer_id, session_id, watch_duration_seconds, completed, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [videoId, viewerId, sessionId, watchDurationSeconds, completed, ipAddress, userAgent],
    );

    // Increment view count on video
    await pool.query(
      'UPDATE videos SET view_count = view_count + 1, updated_at = NOW() WHERE id = $1',
      [videoId],
    );
  } catch (err) {
    logger.error({ err, videoId }, 'Failed to record view event');
    throw err;
  }
}
