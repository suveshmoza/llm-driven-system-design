/**
 * Notification worker for Jira
 * Processes jira.notifications queue for in-app and email notifications.
 */
import {
  initializeMessageQueue,
  consumeQueue,
  closeMessageQueue,
  QUEUES,
  IssueEventMessage
} from '../config/messageQueue.js';
import { pool, query } from '../config/database.js';
import { logger } from '../config/logger.js';

interface NotificationData {
  user_id: string;
  type: string;
  title: string;
  message: string;
  issue_key: string;
  issue_id: number;
  project_key: string;
}

/**
 * Get notification title based on event type.
 */
function getNotificationTitle(eventType: string, issueKey: string): string {
  const titles: Record<string, string> = {
    'created': `New issue: ${issueKey}`,
    'updated': `Issue updated: ${issueKey}`,
    'transitioned': `Status changed: ${issueKey}`,
    'commented': `New comment on ${issueKey}`,
    'deleted': `Issue deleted: ${issueKey}`,
  };
  return titles[eventType] || `Issue event: ${issueKey}`;
}

/**
 * Get notification message based on event type and changes.
 */
function getNotificationMessage(
  eventType: string,
  issueKey: string,
  changes?: Record<string, { old: unknown; new: unknown }>
): string {
  if (eventType === 'transitioned' && changes?.status) {
    return `${issueKey} moved from ${changes.status.old} to ${changes.status.new}`;
  }
  if (eventType === 'updated' && changes) {
    const fields = Object.keys(changes).join(', ');
    return `Fields updated: ${fields}`;
  }
  const messages: Record<string, string> = {
    'created': `A new issue has been created.`,
    'updated': `The issue has been updated.`,
    'transitioned': `The issue status has changed.`,
    'commented': `A new comment has been added to the issue.`,
    'deleted': `The issue has been deleted.`,
  };
  return messages[eventType] || 'An issue event occurred.';
}

/**
 * Process notification events.
 * Creates in-app notifications and logs emails (simulated).
 */
async function processNotificationEvent(event: IssueEventMessage): Promise<void> {
  const { event_id, event_type, issue_id, issue_key, project_id, project_key, actor_id, changes } = event;

  logger.info({ event_id, event_type, issue_key }, 'Processing notification event');

  try {
    // Get users to notify (watchers, assignee, reporter)
    const usersResult = await query(`
      SELECT DISTINCT user_id FROM (
        -- Issue watchers
        SELECT user_id FROM issue_watchers WHERE issue_id = $1
        UNION
        -- Assignee
        SELECT assignee_id as user_id FROM issues WHERE id = $1 AND assignee_id IS NOT NULL
        UNION
        -- Reporter
        SELECT reporter_id as user_id FROM issues WHERE id = $1
        UNION
        -- Project watchers
        SELECT user_id FROM project_watchers WHERE project_id = $2
      ) as users
      WHERE user_id != $3
    `, [issue_id, project_id, actor_id]);

    if (usersResult.rows.length === 0) {
      logger.info({ issue_key }, 'No users to notify');
      return;
    }

    const title = getNotificationTitle(event_type, issue_key);
    const message = getNotificationMessage(event_type, issue_key, changes);

    // Create in-app notifications for each user
    for (const row of usersResult.rows) {
      await query(`
        INSERT INTO notifications (user_id, type, title, message, issue_id, project_id, read, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, false, NOW())
      `, [row.user_id, event_type, title, message, issue_id, project_id]);

      // Log email (simulated - in production, integrate with email service)
      logger.info({
        user_id: row.user_id,
        issue_key,
        notification_type: event_type
      }, 'Notification created');
    }

    // Store email log (simulated sending)
    const emailRecipients = await query(`
      SELECT u.id, u.email, u.display_name
      FROM users u
      WHERE u.id = ANY($1::uuid[])
        AND u.email_notifications = true
    `, [usersResult.rows.map(r => r.user_id)]);

    for (const recipient of emailRecipients.rows) {
      await query(`
        INSERT INTO email_log (recipient_id, recipient_email, subject, body, status, created_at)
        VALUES ($1, $2, $3, $4, 'sent', NOW())
      `, [recipient.id, recipient.email, title, message]);

      logger.info({
        email: recipient.email,
        subject: title
      }, 'Email notification logged (simulated)');
    }

    logger.info({
      event_id,
      issue_key,
      notified_count: usersResult.rows.length
    }, 'Notification event processed');
  } catch (error) {
    logger.error({ error, event_id, issue_key }, 'Failed to process notification event');
    throw error;
  }
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  logger.info('Starting Jira notification worker...');

  try {
    await initializeMessageQueue();

    await consumeQueue(QUEUES.NOTIFICATIONS, async (message) => {
      await processNotificationEvent(message as unknown as IssueEventMessage);
    });

    logger.info('Jira notification worker started, waiting for messages...');

    const shutdown = async () => {
      logger.info('Shutting down notification worker...');
      await closeMessageQueue();
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
