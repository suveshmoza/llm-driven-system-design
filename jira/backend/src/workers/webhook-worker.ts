/**
 * Webhook worker for Jira
 * Processes jira.webhooks queue to deliver events to external systems.
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

interface WebhookConfig {
  id: number;
  url: string;
  secret: string;
  events: string[];
  project_id: string | null;
  active: boolean;
}

/**
 * Generate HMAC signature for webhook payload.
 * In production, use crypto.createHmac for proper signing.
 */
function generateSignature(payload: string, secret: string): string {
  // Simplified signature - in production use proper HMAC
  return `sha256=${Buffer.from(secret + payload).toString('base64').slice(0, 64)}`;
}

/**
 * Deliver webhook to an endpoint.
 * Retries are handled by the message queue retry mechanism.
 */
async function deliverWebhook(
  webhook: WebhookConfig,
  event: IssueEventMessage
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const payload = JSON.stringify({
    event_type: event.event_type,
    timestamp: event.timestamp,
    issue: {
      id: event.issue_id,
      key: event.issue_key,
    },
    project: {
      id: event.project_id,
      key: event.project_key,
    },
    actor_id: event.actor_id,
    changes: event.changes,
  });

  const signature = generateSignature(payload, webhook.secret);

  try {
    // Simulated HTTP delivery - in production, use fetch or axios
    logger.info({
      webhook_id: webhook.id,
      url: webhook.url,
      event_type: event.event_type,
      issue_key: event.issue_key,
    }, 'Delivering webhook (simulated)');

    // Log delivery attempt
    await query(`
      INSERT INTO webhook_deliveries
        (webhook_id, event_id, event_type, payload, status, attempts, created_at)
      VALUES ($1, $2, $3, $4, 'delivered', 1, NOW())
    `, [webhook.id, event.event_id, event.event_type, payload]);

    // In production, make actual HTTP request:
    // const response = await fetch(webhook.url, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'X-Jira-Signature': signature,
    //     'X-Jira-Event': event.event_type,
    //   },
    //   body: payload,
    // });

    return { success: true, statusCode: 200 };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({
      error,
      webhook_id: webhook.id,
      url: webhook.url
    }, 'Webhook delivery failed');

    // Log failed delivery
    await query(`
      INSERT INTO webhook_deliveries
        (webhook_id, event_id, event_type, payload, status, error, attempts, created_at)
      VALUES ($1, $2, $3, $4, 'failed', $5, 1, NOW())
    `, [webhook.id, event.event_id, event.event_type, payload, errorMessage]);

    return { success: false, error: errorMessage };
  }
}

/**
 * Process webhook delivery events.
 * Finds matching webhooks and delivers to each endpoint.
 */
async function processWebhookEvent(event: IssueEventMessage): Promise<void> {
  const { event_id, event_type, project_id, project_key, issue_key } = event;

  logger.info({ event_id, event_type, issue_key }, 'Processing webhook event');

  try {
    // Find webhooks that match this event
    const webhooksResult = await query<WebhookConfig>(`
      SELECT id, url, secret, events, project_id, active
      FROM webhooks
      WHERE active = true
        AND (project_id IS NULL OR project_id = $1)
        AND (events @> $2::jsonb OR events @> '"*"'::jsonb)
    `, [project_id, JSON.stringify([event_type])]);

    if (webhooksResult.rows.length === 0) {
      logger.debug({ event_type, project_key }, 'No webhooks configured for this event');
      return;
    }

    logger.info({
      event_id,
      webhook_count: webhooksResult.rows.length
    }, 'Found matching webhooks');

    // Deliver to each webhook
    const results = await Promise.allSettled(
      webhooksResult.rows.map(webhook => deliverWebhook(webhook, event))
    );

    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - successful;

    logger.info({
      event_id,
      successful,
      failed
    }, 'Webhook deliveries completed');
  } catch (error) {
    logger.error({ error, event_id, issue_key }, 'Failed to process webhook event');
    throw error;
  }
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  logger.info('Starting Jira webhook worker...');

  try {
    await initializeMessageQueue();

    await consumeQueue(QUEUES.WEBHOOKS, async (message) => {
      await processWebhookEvent(message as unknown as IssueEventMessage);
    });

    logger.info('Jira webhook worker started, waiting for messages...');

    const shutdown = async () => {
      logger.info('Shutting down webhook worker...');
      await closeMessageQueue();
      await pool.end();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error({ error }, 'Failed to start webhook worker');
    process.exit(1);
  }
}

main();
