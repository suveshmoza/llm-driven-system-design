/**
 * Webhook delivery worker for Shopify
 * Processes webhooks.deliver queue to send events to merchant endpoints.
 */
import { connect, close, subscribe, getChannel } from '../services/rabbitmq.js';
import logger from '../services/logger.js';
import pool, { query } from '../services/db.js';
import type { ConsumeMessage } from 'amqplib';

interface WebhookPayload {
  event: string;
  messageId: string;
  timestamp: string;
  data: {
    url: string;
    event: string;
    payload: Record<string, unknown>;
    attempts: number;
    webhookId?: number;
    storeId?: number;
  };
}

/**
 * Generate webhook signature for verification.
 * In production, use proper HMAC-SHA256.
 */
function generateSignature(payload: string, secret: string): string {
  // Simplified signature - use crypto.createHmac in production
  return `sha256=${Buffer.from(secret + payload).toString('base64').slice(0, 64)}`;
}

/**
 * Process webhook delivery jobs.
 * - Delivers webhook to merchant endpoint
 * - Handles retries and dead-letter
 */
async function handleWebhookDelivery(message: WebhookPayload): Promise<void> {
  const { url, event, payload, attempts, webhookId, storeId } = message.data;

  logger.info({ url, event, attempts }, 'Processing webhook delivery');

  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    payload,
  });

  try {
    // Simulated HTTP delivery - in production use fetch
    logger.info({ url, event }, 'Delivering webhook (simulated)');

    // In production:
    // const response = await fetch(url, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'X-Shopify-Hmac-SHA256': signature,
    //     'X-Shopify-Topic': event,
    //   },
    //   body,
    //   signal: AbortSignal.timeout(30000), // 30s timeout
    // });

    // Log successful delivery
    await query(`
      INSERT INTO webhook_deliveries
        (webhook_id, store_id, event, url, payload, status, attempts, delivered_at)
      VALUES ($1, $2, $3, $4, $5, 'delivered', $6, NOW())
    `, [webhookId, storeId, event, url, body, attempts + 1]);

    logger.info({ url, event }, 'Webhook delivered successfully');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error({ error, url, event, attempts }, 'Webhook delivery failed');

    // Log failed delivery
    await query(`
      INSERT INTO webhook_deliveries
        (webhook_id, store_id, event, url, payload, status, error, attempts, created_at)
      VALUES ($1, $2, $3, $4, $5, 'failed', $6, $7, NOW())
    `, [webhookId, storeId, event, url, body, errorMessage, attempts + 1]);

    // Throw to trigger retry via queue mechanism
    throw error;
  }
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  logger.info('Starting Shopify webhook delivery worker...');

  try {
    await connect();

    await subscribe('webhooks.deliver', async (message, msg) => {
      const payload = message as unknown as WebhookPayload;
      await handleWebhookDelivery(payload);
    }, { maxRetries: 5 });

    logger.info('Shopify webhook delivery worker started, waiting for messages...');

    const shutdown = async () => {
      logger.info('Shutting down webhook delivery worker...');
      await close();
      await pool.end();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error({ error }, 'Failed to start webhook delivery worker');
    process.exit(1);
  }
}

main();
