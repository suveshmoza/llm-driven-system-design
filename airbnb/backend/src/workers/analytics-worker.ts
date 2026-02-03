/**
 * Analytics events worker - processes analytics.events queue
 * Aggregates metrics for dashboards and reporting.
 */
import { initQueue, startConsumer, QUEUES, closeQueue } from '../shared/queue.js';
import { createModuleLogger } from '../shared/logger.js';
import { pool } from '../db.js';

const log = createModuleLogger('analytics-worker');

interface AnalyticsEvent {
  eventId: string;
  eventType: string;
  timestamp: string;
  data: {
    booking?: {
      id: number;
      listing_id: number;
      total_price: number;
      nights: number;
    };
    listing?: {
      id: number;
      hostId: number;
    };
    listingId?: number;
    changes?: Record<string, unknown>;
  };
}

/**
 * Process analytics events and update aggregated metrics.
 */
async function processAnalyticsEvent(event: AnalyticsEvent): Promise<void> {
  const { eventId, eventType, timestamp, data } = event;

  log.info({ eventId, eventType }, 'Processing analytics event');

  // Extract date for daily aggregation
  const eventDate = new Date(timestamp).toISOString().split('T')[0];

  switch (eventType) {
    case 'booking.created':
    case 'booking.confirmed':
    case 'booking.completed':
      if (data.booking) {
        await updateBookingMetrics(eventDate, data.booking, eventType);
      }
      break;

    case 'listing.updated':
    case 'availability.changed':
      if (data.listingId || data.listing?.id) {
        await updateListingMetrics(eventDate, data.listingId || data.listing!.id);
      }
      break;

    default:
      log.debug({ eventType }, 'Unhandled analytics event type');
  }

  log.info({ eventId }, 'Analytics event processed');
}

async function updateBookingMetrics(
  date: string,
  booking: NonNullable<AnalyticsEvent['data']['booking']>,
  eventType: string
): Promise<void> {
  // Upsert daily booking metrics
  await pool.query(
    `INSERT INTO daily_metrics (date, metric_type, listing_id, count, revenue, updated_at)
     VALUES ($1, $2, $3, 1, $4, NOW())
     ON CONFLICT (date, metric_type, listing_id)
     DO UPDATE SET
       count = daily_metrics.count + 1,
       revenue = daily_metrics.revenue + EXCLUDED.revenue,
       updated_at = NOW()`,
    [date, eventType, booking.listing_id, booking.total_price || 0]
  );

  log.debug({ date, eventType, listingId: booking.listing_id }, 'Updated booking metrics');
}

async function updateListingMetrics(date: string, listingId: number): Promise<void> {
  // Track listing update activity
  await pool.query(
    `INSERT INTO daily_metrics (date, metric_type, listing_id, count, revenue, updated_at)
     VALUES ($1, 'listing.activity', $2, 1, 0, NOW())
     ON CONFLICT (date, metric_type, listing_id)
     DO UPDATE SET
       count = daily_metrics.count + 1,
       updated_at = NOW()`,
    [date, listingId]
  );

  log.debug({ date, listingId }, 'Updated listing metrics');
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  log.info('Starting analytics events worker...');

  try {
    await initQueue();

    await startConsumer(QUEUES.ANALYTICS_EVENTS, async (event) => {
      await processAnalyticsEvent(event as AnalyticsEvent);
    });

    log.info('Analytics events worker started, waiting for messages...');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      log.info('Shutting down analytics events worker...');
      await closeQueue();
      await pool.end();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      log.info('Shutting down analytics events worker...');
      await closeQueue();
      await pool.end();
      process.exit(0);
    });
  } catch (error) {
    log.error({ error }, 'Failed to start analytics events worker');
    process.exit(1);
  }
}

main();
