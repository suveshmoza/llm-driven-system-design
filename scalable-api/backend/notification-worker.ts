import queue, { QUEUES } from './shared/services/queue.js';
import db from './shared/services/database.js';
import config from './shared/config/index.js';

const workerId = process.env['WORKER_ID'] || 'notif-1';

console.log(`Notification Worker [${workerId}] starting...`);

interface Notification {
  id: string;
  userId: string;
  message: string;
  channel: string;
  priority: string;
  metadata?: Record<string, unknown>;
}

interface NotificationResult {
  stored?: boolean;
  sent?: boolean;
  reason?: string;
  email?: string;
  phone?: string;
  channel?: string;
}

/**
 * Notification handlers by channel
 */
const channelHandlers: Record<string, (notification: Notification) => Promise<NotificationResult>> = {
  /**
   * In-app notification - store in database for user to see
   */
  async 'in-app'(notification: Notification): Promise<NotificationResult> {
    const { userId, message, metadata } = notification;

    await db.query(
      `INSERT INTO notifications (user_id, message, metadata, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [userId, message, JSON.stringify(metadata)]
    );

    console.log(`[${workerId}] In-app notification stored for user ${userId}`);
    return { stored: true };
  },

  /**
   * Email notification - simulate sending
   */
  async email(notification: Notification): Promise<NotificationResult> {
    const { userId, message } = notification;

    // Get user email from database
    const result = await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]);
    const email = result.rows[0]?.['email'];

    if (!email) {
      console.warn(`[${workerId}] User ${userId} not found, skipping email`);
      return { sent: false, reason: 'User not found' };
    }

    // Simulate email sending
    console.log(`[${workerId}] Sending email to ${email}: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 100));

    return { sent: true, email };
  },

  /**
   * Push notification - simulate sending
   */
  async push(notification: Notification): Promise<NotificationResult> {
    const { userId, message } = notification;

    // Simulate push notification
    console.log(`[${workerId}] Sending push notification to user ${userId}: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 50));

    return { sent: true, channel: 'push' };
  },

  /**
   * SMS notification - simulate sending
   */
  async sms(notification: Notification): Promise<NotificationResult> {
    const { userId, message, metadata } = notification;

    // Get user phone from metadata or database
    const phone = metadata?.['phone'] as string | undefined;

    if (!phone) {
      console.warn(`[${workerId}] No phone number for user ${userId}, skipping SMS`);
      return { sent: false, reason: 'No phone number' };
    }

    // Simulate SMS sending
    console.log(`[${workerId}] Sending SMS to ${phone}: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    return { sent: true, phone };
  },
};

/**
 * Handle incoming notification
 */
async function handleNotification(notification: Notification): Promise<void> {
  const { id, channel, priority } = notification;

  console.log(
    `[${workerId}] Processing notification ${id} (channel: ${channel}, priority: ${priority})`
  );

  const handler = channelHandlers[channel];
  if (!handler) {
    console.error(`[${workerId}] Unknown notification channel: ${channel}`);
    return;
  }

  try {
    const startTime = Date.now();
    const result = await handler(notification);
    const duration = Date.now() - startTime;

    console.log(`[${workerId}] Notification ${id} processed in ${duration}ms:`, result);
  } catch (error) {
    console.error(`[${workerId}] Notification ${id} failed:`, (error as Error).message);
    throw error; // Will trigger requeue
  }
}

/**
 * Start the worker
 */
async function start(): Promise<void> {
  try {
    // Connect to RabbitMQ
    await queue.connect();

    // Start consuming notifications
    await queue.consume<Notification>(QUEUES.NOTIFICATIONS, handleNotification, {
      prefetch: 10,
    });

    console.log(`Notification Worker [${workerId}] is now consuming from ${QUEUES.NOTIFICATIONS}`);
    console.log(`Environment: ${config.env}`);
  } catch (error) {
    console.error(`[${workerId}] Failed to start:`, (error as Error).message);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(): Promise<void> {
  console.log(`[${workerId}] Shutting down...`);
  await queue.close();
  await db.closePool();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start the worker
start();
