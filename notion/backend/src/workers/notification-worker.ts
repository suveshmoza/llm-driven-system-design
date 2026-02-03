/**
 * Notification worker for Notion
 * Processes notion.notifications queue for in-app notifications.
 */
import { queueManager, QUEUES, NotificationMessage } from '../shared/queue.js';
import { logger } from '../shared/logger.js';
import pool from '../models/db.js';

/**
 * Get notification text based on type.
 */
function getNotificationContent(message: NotificationMessage): { title: string; body: string } {
  const contents: Record<string, { title: string; body: string }> = {
    page_shared: {
      title: 'Page shared with you',
      body: `${message.data.sharerName || 'Someone'} shared "${message.data.pageTitle || 'a page'}" with you.`,
    },
    page_mentioned: {
      title: 'You were mentioned',
      body: `${message.data.mentionerName || 'Someone'} mentioned you in "${message.data.pageTitle || 'a page'}".`,
    },
    comment_added: {
      title: 'New comment',
      body: `${message.data.commenterName || 'Someone'} commented on "${message.data.pageTitle || 'a page'}".`,
    },
    workspace_invite: {
      title: 'Workspace invitation',
      body: `You've been invited to join "${message.data.workspaceName || 'a workspace'}".`,
    },
  };

  return contents[message.type] || {
    title: 'Notification',
    body: 'You have a new notification.',
  };
}

/**
 * Process notification messages.
 * Creates in-app notifications for users.
 */
async function processNotification(message: NotificationMessage): Promise<void> {
  const { type, userId, data } = message;

  logger.info({ type, userId }, 'Processing notification');

  const { title, body } = getNotificationContent(message);

  // Insert notification record
  await pool.query(`
    INSERT INTO notifications (user_id, type, title, body, data, read, created_at)
    VALUES ($1, $2, $3, $4, $5, false, NOW())
  `, [userId, type, title, body, JSON.stringify(data)]);

  logger.info({ type, userId }, 'Notification created');
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  logger.info('Starting Notion notification worker...');

  try {
    await queueManager.connect();

    await queueManager.consume('notifications', async (message: NotificationMessage) => {
      await processNotification(message);
    });

    logger.info('Notion notification worker started, waiting for messages...');

    const shutdown = async () => {
      logger.info('Shutting down notification worker...');
      await queueManager.close();
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
