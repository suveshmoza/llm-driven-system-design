import { pool, redis, testDatabaseConnection, testRedisConnection, closeConnections } from '../db/index.js';
import {
  queueService,
  BookingNotificationPayload,
  ReminderPayload,
} from '../shared/queue.js';
import { logger } from '../shared/logger.js';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { v4 as uuidv4 } from 'uuid';

/**
 * Notification Worker
 * 
 * Consumes messages from RabbitMQ queues and processes booking notifications
 * and reminders. In production, this would integrate with email providers
 * like SendGrid, Mailgun, or AWS SES. For this demo, it logs emails to
 * the console and stores them in the database.
 * 
 * Features:
 * - Booking confirmation notifications (to both host and invitee)
 * - Cancellation notifications
 * - Reschedule notifications
 * - Reminder notifications (e.g., 24h and 1h before meeting)
 * 
 * Run with: npm run dev:worker
 */

const workerLogger = logger.child({ service: 'notification-worker' });

/**
 * Sends an email notification and logs it to the database.
 * In production, this would call an email service provider API.
 */
async function sendEmail(
  bookingId: string,
  recipientEmail: string,
  notificationType: string,
  subject: string,
  body: string
): Promise<void> {
  const id = uuidv4();

  try {
    // Store in database for tracking
    await pool.query(
      `INSERT INTO email_notifications
       (id, booking_id, recipient_email, notification_type, subject, body, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'sent')`,
      [id, bookingId, recipientEmail, notificationType, subject, body]
    );

    // Log to console (in production, call email provider here)
    const separator = '='.repeat(60);
    const divider = '-'.repeat(60);
    console.log(separator);
    console.log('EMAIL NOTIFICATION (' + notificationType.toUpperCase() + ') - VIA WORKER');
    console.log(separator);
    console.log('To: ' + recipientEmail);
    console.log('Subject: ' + subject);
    console.log(divider);
    console.log(body);
    console.log(separator);

    workerLogger.info(
      {
        emailId: id,
        bookingId,
        recipientEmail,
        notificationType,
      },
      'Email notification sent'
    );
  } catch (error) {
    workerLogger.error(
      {
        error,
        bookingId,
        recipientEmail,
        notificationType,
      },
      'Failed to send email notification'
    );
    throw error;
  }
}

/**
 * Formats a meeting time for display in emails.
 */
function formatMeetingTime(startTime: string, timezone: string): string {
  const zonedTime = toZonedTime(new Date(startTime), timezone);
  return format(zonedTime, "EEEE, MMMM do, yyyy 'at' h:mm a");
}

/**
 * Handles booking notification messages from the queue.
 * Processes confirmations, cancellations, and reschedules.
 */
async function handleNotification(payload: BookingNotificationPayload): Promise<void> {
  const {
    type,
    bookingId,
    inviteeEmail,
    inviteeName,
    meetingTypeName,
    hostName,
    hostEmail,
    startTime,
    inviteeTimezone,
    notes,
    cancellationReason,
  } = payload;

  const formattedTime = formatMeetingTime(startTime, inviteeTimezone);

  workerLogger.info({ type, bookingId }, 'Processing booking notification');

  switch (type) {
    case 'booking_confirmed': {
      // Send confirmation to invitee
      const inviteeSubject = 'Confirmed: ' + meetingTypeName + ' with ' + hostName;
      const inviteeBody = [
        'Hi ' + inviteeName + ',',
        '',
        'Your meeting has been confirmed!',
        '',
        'Meeting: ' + meetingTypeName,
        'Host: ' + hostName,
        'When: ' + formattedTime + ' (' + inviteeTimezone + ')',
        '',
        notes ? 'Notes: ' + notes : '',
        '',
        'To reschedule or cancel, visit your booking page.',
        '',
        'Best regards,',
        'Calendly',
      ].filter(Boolean).join('\n');

      await sendEmail(bookingId, inviteeEmail, 'confirmation', inviteeSubject, inviteeBody);

      // Send notification to host
      const hostSubject = 'New Booking: ' + meetingTypeName + ' with ' + inviteeName;
      const hostBody = [
        'Hi ' + hostName + ',',
        '',
        'You have a new booking!',
        '',
        'Meeting: ' + meetingTypeName,
        'Guest: ' + inviteeName + ' (' + inviteeEmail + ')',
        'When: ' + formattedTime + ' (' + inviteeTimezone + ')',
        '',
        notes ? 'Notes: ' + notes : '',
        '',
        'Best regards,',
        'Calendly',
      ].filter(Boolean).join('\n');

      await sendEmail(bookingId, hostEmail, 'confirmation', hostSubject, hostBody);

      // Update notification status in database
      await updateNotificationStatus(bookingId, 'confirmed_notification_sent');
      break;
    }

    case 'booking_cancelled': {
      const subject = 'Meeting Cancelled';
      const body = [
        'Hi ' + inviteeName + ',',
        '',
        'Your meeting scheduled for ' + formattedTime + ' has been cancelled.',
        '',
        cancellationReason ? 'Reason: ' + cancellationReason : '',
        '',
        'We apologize for any inconvenience.',
        '',
        'Best regards,',
        'Calendly',
      ].filter(Boolean).join('\n');

      await sendEmail(bookingId, inviteeEmail, 'cancellation', subject, body);

      // Also notify host
      const hostBody = [
        'Hi ' + hostName + ',',
        '',
        'A booking has been cancelled.',
        '',
        'Meeting: ' + meetingTypeName,
        'Guest: ' + inviteeName + ' (' + inviteeEmail + ')',
        'Was scheduled for: ' + formattedTime,
        '',
        cancellationReason ? 'Reason: ' + cancellationReason : '',
        '',
        'Best regards,',
        'Calendly',
      ].filter(Boolean).join('\n');

      await sendEmail(bookingId, hostEmail, 'cancellation', subject, hostBody);

      await updateNotificationStatus(bookingId, 'cancelled_notification_sent');
      break;
    }

    case 'booking_rescheduled': {
      const subject = 'Meeting Rescheduled';
      const body = [
        'Hi ' + inviteeName + ',',
        '',
        'Your meeting has been rescheduled.',
        '',
        'New Time: ' + formattedTime + ' (' + inviteeTimezone + ')',
        '',
        'If this does not work for you, please contact the host to reschedule.',
        '',
        'Best regards,',
        'Calendly',
      ].join('\n');

      await sendEmail(bookingId, inviteeEmail, 'reschedule', subject, body);

      // Also notify host
      const hostBody = [
        'Hi ' + hostName + ',',
        '',
        'A booking has been rescheduled.',
        '',
        'Meeting: ' + meetingTypeName,
        'Guest: ' + inviteeName + ' (' + inviteeEmail + ')',
        'New Time: ' + formattedTime,
        '',
        'Best regards,',
        'Calendly',
      ].join('\n');

      await sendEmail(bookingId, hostEmail, 'reschedule', subject, hostBody);

      await updateNotificationStatus(bookingId, 'rescheduled_notification_sent');
      break;
    }

    default:
      workerLogger.warn({ type }, 'Unknown notification type');
  }
}

/**
 * Handles reminder messages from the queue.
 */
async function handleReminder(payload: ReminderPayload): Promise<void> {
  const {
    bookingId,
    hoursUntil,
    inviteeEmail,
    inviteeName,
    startTime,
    inviteeTimezone,
  } = payload;

  workerLogger.info({ bookingId, hoursUntil }, 'Processing reminder');

  // Check if booking is still confirmed
  const result = await pool.query(
    'SELECT status FROM bookings WHERE id = $1',
    [bookingId]
  );

  if (result.rows.length === 0 || result.rows[0].status !== 'confirmed') {
    workerLogger.info({ bookingId }, 'Booking no longer confirmed, skipping reminder');
    return;
  }

  const formattedTime = formatMeetingTime(startTime, inviteeTimezone);

  const hourLabel = hoursUntil > 1 ? 'hours' : 'hour';
  const subject = 'Reminder: Meeting in ' + hoursUntil + ' ' + hourLabel;
  const body = [
    'Hi ' + inviteeName + ',',
    '',
    'This is a reminder that you have a meeting coming up.',
    '',
    'When: ' + formattedTime + ' (' + inviteeTimezone + ')',
    '',
    'See you soon!',
    '',
    'Best regards,',
    'Calendly',
  ].join('\n');

  await sendEmail(bookingId, inviteeEmail, 'reminder', subject, body);
}

/**
 * Updates notification status in Redis for tracking.
 */
async function updateNotificationStatus(bookingId: string, status: string): Promise<void> {
  const key = 'notification:' + bookingId + ':status';
  await redis.set(key, status, 'EX', 86400 * 7); // Expire after 7 days
}

/**
 * Graceful shutdown handler.
 */
async function shutdown(): Promise<void> {
  workerLogger.info('Shutting down notification worker...');

  try {
    await queueService.close();
    await closeConnections();
    workerLogger.info('Notification worker shut down gracefully');
    process.exit(0);
  } catch (error) {
    workerLogger.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  workerLogger.info('Starting notification worker...');

  // Test database connection
  const dbConnected = await testDatabaseConnection();
  if (!dbConnected) {
    workerLogger.error('Failed to connect to PostgreSQL');
    process.exit(1);
  }

  // Test Redis connection
  const redisConnected = await testRedisConnection();
  if (!redisConnected) {
    workerLogger.error('Failed to connect to Redis');
    process.exit(1);
  }

  try {
    // Connect to RabbitMQ
    await queueService.connect();

    // Start consuming messages
    await queueService.consumeNotifications(handleNotification);
    await queueService.consumeReminders(handleReminder);

    workerLogger.info('Notification worker is running');

    // Log queue depths periodically
    setInterval(async () => {
      const notificationsDepth = await queueService.getQueueDepth('booking-notifications');
      const remindersDepth = await queueService.getQueueDepth('reminders');
      const dlqDepth = await queueService.getQueueDepth('notifications-dlq');

      workerLogger.info(
        {
          queues: {
            'booking-notifications': notificationsDepth,
            reminders: remindersDepth,
            'notifications-dlq': dlqDepth,
          },
        },
        'Queue depths'
      );
    }, 60000); // Every minute
  } catch (error) {
    workerLogger.error({ error }, 'Failed to start notification worker');
    process.exit(1);
  }

  // Handle graceful shutdown
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Start the worker
main();
