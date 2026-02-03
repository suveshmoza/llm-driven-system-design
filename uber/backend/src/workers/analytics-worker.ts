/**
 * Analytics worker for Uber
 * Processes analytics queue for metrics and reporting.
 */
import { connectRabbitMQ, closeRabbitMQ, consumeQueue, QUEUES } from '../utils/queue.js';
import { createLogger } from '../utils/logger.js';
import pool, { query } from '../utils/db.js';

const logger = createLogger('analytics-worker');

interface AnalyticsEvent {
  eventId: string;
  eventType: string;
  timestamp: string;
  rideId?: string;
  riderId?: string;
  driverId?: string;
  driver?: {
    id: string;
    name: string;
    rating: number;
    eta: number;
  };
  location?: {
    lat: number;
    lng: number;
  };
  fare?: {
    base: number;
    distance: number;
    time: number;
    surge: number;
    total: number;
  };
  duration?: number;
  distance?: number;
  [key: string]: unknown;
}

/**
 * Extract date for daily aggregation.
 */
function getDateKey(timestamp: string): string {
  return new Date(timestamp).toISOString().split('T')[0];
}

/**
 * Extract hour for hourly aggregation.
 */
function getHourKey(timestamp: string): number {
  return new Date(timestamp).getHours();
}

/**
 * Process analytics events.
 */
async function handleAnalytics(event: AnalyticsEvent): Promise<void> {
  const { eventId, eventType, timestamp, rideId, driverId, fare, duration, distance } = event;

  logger.info({ eventId, eventType }, 'Processing analytics event');

  const dateKey = getDateKey(timestamp);
  const hourKey = getHourKey(timestamp);

  switch (eventType) {
    case 'ride.matched':
      // Track matching metrics
      await query(`
        INSERT INTO analytics_daily (date, metric_type, count, updated_at)
        VALUES ($1, 'rides_matched', 1, NOW())
        ON CONFLICT (date, metric_type)
        DO UPDATE SET count = analytics_daily.count + 1, updated_at = NOW()
      `, [dateKey]);
      break;

    case 'ride.completed':
      // Track completed ride metrics
      await query(`
        INSERT INTO analytics_daily (date, metric_type, count, total_value, updated_at)
        VALUES ($1, 'rides_completed', 1, $2, NOW())
        ON CONFLICT (date, metric_type)
        DO UPDATE SET
          count = analytics_daily.count + 1,
          total_value = analytics_daily.total_value + EXCLUDED.total_value,
          updated_at = NOW()
      `, [dateKey, fare?.total || 0]);

      // Track driver earnings
      if (driverId && fare) {
        await query(`
          INSERT INTO driver_earnings (driver_id, date, rides_completed, total_earnings, updated_at)
          VALUES ($1, $2, 1, $3, NOW())
          ON CONFLICT (driver_id, date)
          DO UPDATE SET
            rides_completed = driver_earnings.rides_completed + 1,
            total_earnings = driver_earnings.total_earnings + EXCLUDED.total_earnings,
            updated_at = NOW()
        `, [driverId, dateKey, fare.total * 0.75]); // 75% driver share
      }

      // Track hourly distribution
      await query(`
        INSERT INTO analytics_hourly (date, hour, rides_completed, revenue, updated_at)
        VALUES ($1, $2, 1, $3, NOW())
        ON CONFLICT (date, hour)
        DO UPDATE SET
          rides_completed = analytics_hourly.rides_completed + 1,
          revenue = analytics_hourly.revenue + EXCLUDED.revenue,
          updated_at = NOW()
      `, [dateKey, hourKey, fare?.total || 0]);
      break;

    case 'ride.cancelled':
      await query(`
        INSERT INTO analytics_daily (date, metric_type, count, updated_at)
        VALUES ($1, 'rides_cancelled', 1, NOW())
        ON CONFLICT (date, metric_type)
        DO UPDATE SET count = analytics_daily.count + 1, updated_at = NOW()
      `, [dateKey]);
      break;

    case 'matching.no_drivers':
      await query(`
        INSERT INTO analytics_daily (date, metric_type, count, updated_at)
        VALUES ($1, 'matching_failures', 1, NOW())
        ON CONFLICT (date, metric_type)
        DO UPDATE SET count = analytics_daily.count + 1, updated_at = NOW()
      `, [dateKey]);
      break;

    case 'surge.applied':
      // Track surge pricing events
      await query(`
        INSERT INTO analytics_daily (date, metric_type, count, total_value, updated_at)
        VALUES ($1, 'surge_rides', 1, $2, NOW())
        ON CONFLICT (date, metric_type)
        DO UPDATE SET
          count = analytics_daily.count + 1,
          total_value = analytics_daily.total_value + EXCLUDED.total_value,
          updated_at = NOW()
      `, [dateKey, fare?.surge || 0]);
      break;

    default:
      logger.debug({ eventType }, 'Unhandled analytics event type');
  }

  logger.info({ eventId, eventType }, 'Analytics event processed');
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  logger.info('Starting Uber analytics worker...');

  try {
    await connectRabbitMQ();

    await consumeQueue<AnalyticsEvent>(QUEUES.ANALYTICS, async (content, msg) => {
      await handleAnalytics(content);
    });

    logger.info('Uber analytics worker started, waiting for messages...');

    const shutdown = async () => {
      logger.info('Shutting down analytics worker...');
      await closeRabbitMQ();
      await pool.end();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error({ error }, 'Failed to start analytics worker');
    process.exit(1);
  }
}

main();
