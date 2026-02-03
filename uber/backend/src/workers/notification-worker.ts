/**
 * Notification worker for Uber
 * Processes notifications queue for push/in-app notifications.
 */
import { connectRabbitMQ, closeRabbitMQ, consumeQueue, QUEUES } from '../utils/queue.js';
import { createLogger } from '../utils/logger.js';
import pool, { query } from '../utils/db.js';

const logger = createLogger('notification-worker');

interface NotificationEvent {
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
  rider?: {
    id: string;
    name: string;
  };
  [key: string]: unknown;
}

/**
 * Get notification content based on event type.
 */
function getNotificationContent(event: NotificationEvent): {
  title: string;
  body: string;
  type: string;
} {
  switch (event.eventType) {
    case 'ride.matched':
      return {
        title: 'Driver Found!',
        body: `${event.driver?.name} is on the way. ETA: ${event.driver?.eta} min`,
        type: 'ride_matched',
      };

    case 'ride.driver_arrived':
      return {
        title: 'Driver Arrived',
        body: 'Your driver has arrived at the pickup location.',
        type: 'driver_arrived',
      };

    case 'ride.started':
      return {
        title: 'Ride Started',
        body: 'Your ride is in progress.',
        type: 'ride_started',
      };

    case 'ride.completed':
      return {
        title: 'Ride Completed',
        body: 'Thanks for riding! Rate your experience.',
        type: 'ride_completed',
      };

    case 'ride.cancelled':
      return {
        title: 'Ride Cancelled',
        body: 'Your ride has been cancelled.',
        type: 'ride_cancelled',
      };

    case 'matching.no_drivers':
      return {
        title: 'No Drivers Available',
        body: 'We couldn\'t find a driver nearby. Please try again.',
        type: 'no_drivers',
      };

    case 'ride.request': // Notification for driver
      return {
        title: 'New Ride Request',
        body: `New pickup request ${event.rider?.name ? 'from ' + event.rider.name : ''}`,
        type: 'ride_request',
      };

    default:
      return {
        title: 'Uber Update',
        body: 'You have a new update.',
        type: 'general',
      };
  }
}

/**
 * Process notification events.
 */
async function handleNotification(event: NotificationEvent): Promise<void> {
  const { eventId, eventType, rideId, riderId, driverId } = event;

  logger.info({ eventId, eventType, rideId }, 'Processing notification event');

  const notification = getNotificationContent(event);

  // Determine recipient(s) based on event type
  const recipients: string[] = [];

  if (eventType.startsWith('ride.') && riderId) {
    recipients.push(riderId);
  }

  if (eventType === 'ride.request' && driverId) {
    recipients.push(driverId);
  }

  // Store notifications for each recipient
  for (const userId of recipients) {
    await query(`
      INSERT INTO notifications (user_id, type, title, body, data, read, created_at)
      VALUES ($1, $2, $3, $4, $5, false, NOW())
    `, [
      userId,
      notification.type,
      notification.title,
      notification.body,
      JSON.stringify({ eventType, rideId, eventId })
    ]);

    // In production, would also push via:
    // - WebSocket for connected clients
    // - Push notification service (FCM, APNs)
    logger.info({ userId, type: notification.type }, 'Notification stored');
  }

  logger.info({ eventId, recipientCount: recipients.length }, 'Notification event processed');
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  logger.info('Starting Uber notification worker...');

  try {
    await connectRabbitMQ();

    await consumeQueue<NotificationEvent>(QUEUES.NOTIFICATIONS, async (content, msg) => {
      await handleNotification(content);
    });

    logger.info('Uber notification worker started, waiting for messages...');

    const shutdown = async () => {
      logger.info('Shutting down notification worker...');
      await closeRabbitMQ();
      await pool.end();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error({ error }, 'Failed to start notification worker');
    process.exit(1);
  }
}

main();
