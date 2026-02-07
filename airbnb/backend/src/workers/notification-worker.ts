/**
 * Notification worker - processes notification.send queue
 * Handles email, push, and in-app notification delivery.
 */
import { initQueue, startConsumer, QUEUES, closeQueue } from '../shared/queue.js';
import { createModuleLogger } from '../shared/logger.js';
import pool from '../db.js';

const log = createModuleLogger('notification-worker');

interface NotificationEvent {
  eventId: string;
  eventType: string;
  timestamp: string;
  data: {
    userId?: number;
    hostId?: number;
    guestId?: number;
    booking?: {
      id: number;
      listing_id: number;
      check_in: string;
      check_out: string;
    };
    listing?: {
      id: number;
      title: string;
      hostId: number;
    };
    message?: string;
    channel?: 'email' | 'push' | 'in_app';
  };
}

/**
 * Process a notification event and deliver via appropriate channel.
 */
async function processNotification(event: NotificationEvent): Promise<void> {
  const { eventId, eventType, data } = event;

  log.info({ eventId, eventType }, 'Processing notification');

  // Determine notification channel and recipient
  const channel = data.channel || 'in_app';
  const userId = data.userId || data.hostId || data.guestId;

  if (!userId) {
    log.warn({ eventId }, 'No recipient found for notification');
    return;
  }

  // Store notification in database
  await pool.query(
    `INSERT INTO notifications (user_id, type, title, message, data, channel, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      userId,
      eventType,
      getNotificationTitle(eventType),
      data.message || getDefaultMessage(eventType, data),
      JSON.stringify(data),
      channel,
    ]
  );

  // Simulate channel-specific delivery
  switch (channel) {
    case 'email':
      log.info({ userId, eventType }, 'Sending email notification (simulated)');
      // In production: integrate with SendGrid, SES, etc.
      break;
    case 'push':
      log.info({ userId, eventType }, 'Sending push notification (simulated)');
      // In production: integrate with FCM, APNs
      break;
    case 'in_app':
    default:
      log.info({ userId, eventType }, 'Stored in-app notification');
      break;
  }

  log.info({ eventId, userId, channel }, 'Notification delivered');
}

function getNotificationTitle(eventType: string): string {
  const titles: Record<string, string> = {
    'booking.created': 'New Booking Request',
    'booking.confirmed': 'Booking Confirmed',
    'booking.cancelled': 'Booking Cancelled',
    'booking.completed': 'Trip Completed',
    'review.submitted': 'New Review',
    'host.alert': 'Host Alert',
  };
  return titles[eventType] || 'Notification';
}

function getDefaultMessage(eventType: string, data: NotificationEvent['data']): string {
  if (data.booking && data.listing) {
    return `${data.listing.title} - ${data.booking.check_in} to ${data.booking.check_out}`;
  }
  return 'You have a new notification';
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  log.info('Starting notification worker...');

  try {
    await initQueue();

    await startConsumer(QUEUES.NOTIFICATION_SEND, async (event) => {
      await processNotification(event as NotificationEvent);
    });

    log.info('Notification worker started, waiting for messages...');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      log.info('Shutting down notification worker...');
      await closeQueue();
      await pool.end();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      log.info('Shutting down notification worker...');
      await closeQueue();
      await pool.end();
      process.exit(0);
    });
  } catch (error) {
    log.error({ error }, 'Failed to start notification worker');
    process.exit(1);
  }
}

main();
