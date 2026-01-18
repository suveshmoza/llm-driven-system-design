import crypto from 'crypto';
import dotenv from 'dotenv';
import {
  connectQueue,
  closeQueue,
  consumeWebhooks,
  requeueWebhook,
  type WebhookMessage,
} from '../shared/queue.js';
import { logger } from '../shared/logger.js';
import { query } from '../db/connection.js';
import { webhookCircuitBreaker } from '../shared/circuit-breaker.js';

dotenv.config();

/**
 * Webhook delivery worker.
 *
 * Responsibilities:
 * - Consume webhook events from the queue
 * - Sign payloads with merchant's webhook secret
 * - Deliver to merchant endpoints with retries
 * - Track delivery status in database
 *
 * Retry strategy:
 * - Exponential backoff: 1s, 2s, 4s, 8s, 16s...
 * - Max 5 attempts (configurable via WEBHOOK_MAX_RETRIES)
 * - After max attempts, message goes to dead letter queue
 *
 * Security:
 * - HMAC-SHA256 signature in X-Signature-256 header
 * - Timestamp in X-Webhook-Timestamp header
 * - Idempotency key in X-Webhook-Id header
 */

const WEBHOOK_TIMEOUT_MS = parseInt(process.env.WEBHOOK_TIMEOUT_MS || '30000', 10);

/**
 * Computes HMAC-SHA256 signature for webhook payload.
 *
 * @param payload - JSON string to sign
 * @param secret - Merchant's webhook secret
 * @param timestamp - Unix timestamp of the request
 * @returns Hex-encoded signature
 */
function computeSignature(payload: string, secret: string, timestamp: number): string {
  const signedPayload = `${timestamp}.${payload}`;
  return crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
}

/**
 * Calculates exponential backoff delay for retries.
 *
 * @param attempt - Current attempt number (1-based)
 * @returns Delay in milliseconds
 */
function getBackoffDelay(attempt: number): number {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s...
  const baseDelay = 1000;
  const maxDelay = 60000; // Cap at 60 seconds
  const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
  // Add jitter (0-10% of delay)
  return delay + Math.random() * delay * 0.1;
}

/**
 * Delivers a webhook to the merchant's endpoint.
 *
 * @param message - Webhook message to deliver
 * @returns True if delivery succeeded, false otherwise
 */
async function deliverWebhook(message: WebhookMessage): Promise<boolean> {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    id: message.id,
    type: message.eventType,
    data: message.data,
    created_at: message.createdAt,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Webhook-Id': message.id,
    'X-Webhook-Timestamp': timestamp.toString(),
    'User-Agent': 'PaymentSystem-Webhook/1.0',
  };

  // Sign payload if secret is available
  if (message.webhookSecret) {
    const signature = computeSignature(payload, message.webhookSecret, timestamp);
    headers['X-Signature-256'] = `sha256=${signature}`;
  }

  try {
    // Use circuit breaker to protect against merchant endpoint issues
    const response = await webhookCircuitBreaker.policy.execute(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

      try {
        const res = await fetch(message.webhookUrl, {
          method: 'POST',
          headers,
          body: payload,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return res;
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    });

    // Success: 2xx status codes
    if (response.ok) {
      logger.info(
        {
          messageId: message.id,
          eventType: message.eventType,
          merchantId: message.merchantId,
          status: response.status,
          attempt: message.attempt,
        },
        'Webhook delivered successfully'
      );

      // Record successful delivery in database
      await recordDelivery(message, 'delivered', response.status);
      return true;
    }

    // Non-retryable errors: 4xx (except 429)
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      logger.warn(
        {
          messageId: message.id,
          merchantId: message.merchantId,
          status: response.status,
          attempt: message.attempt,
        },
        'Webhook delivery failed with non-retryable error'
      );
      await recordDelivery(message, 'failed', response.status);
      return true; // Ack the message, don't retry
    }

    // Retryable errors: 5xx and 429
    logger.warn(
      {
        messageId: message.id,
        merchantId: message.merchantId,
        status: response.status,
        attempt: message.attempt,
      },
      'Webhook delivery failed with retryable error'
    );

    return false;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error(
      {
        messageId: message.id,
        merchantId: message.merchantId,
        error: errorMessage,
        attempt: message.attempt,
      },
      'Webhook delivery error'
    );

    return false;
  }
}

/**
 * Records webhook delivery attempt in the database.
 */
async function recordDelivery(
  message: WebhookMessage,
  status: 'pending' | 'delivered' | 'failed',
  httpStatus?: number
): Promise<void> {
  try {
    await query(
      `INSERT INTO webhook_deliveries (
        id, merchant_id, event_type, payload, status, attempts, 
        last_attempt_at, delivered_at, http_status
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        status = $5,
        attempts = $6,
        last_attempt_at = NOW(),
        delivered_at = $7,
        http_status = $8`,
      [
        message.id,
        message.merchantId,
        message.eventType,
        JSON.stringify(message.data),
        status,
        message.attempt,
        status === 'delivered' ? new Date() : null,
        httpStatus || null,
      ]
    );
  } catch (error) {
    logger.error({ error, messageId: message.id }, 'Failed to record webhook delivery');
  }
}

/**
 * Main webhook handler.
 * Processes each webhook message and handles retries.
 */
async function handleWebhook(message: WebhookMessage): Promise<boolean> {
  logger.debug(
    {
      messageId: message.id,
      eventType: message.eventType,
      merchantId: message.merchantId,
      attempt: message.attempt,
    },
    'Processing webhook'
  );

  const success = await deliverWebhook(message);

  if (!success) {
    // Check if we should retry
    if (message.attempt < message.maxAttempts) {
      const delay = getBackoffDelay(message.attempt);
      await requeueWebhook(message, delay);
      logger.info(
        {
          messageId: message.id,
          nextAttempt: message.attempt + 1,
          delayMs: delay,
        },
        'Scheduled webhook retry'
      );
      return true; // Ack original message since we requeued
    } else {
      logger.error(
        {
          messageId: message.id,
          merchantId: message.merchantId,
          totalAttempts: message.attempt,
        },
        'Webhook delivery exhausted all retries'
      );
      await recordDelivery(message, 'failed');
      return true; // Ack to prevent infinite loop, message will be in DLQ
    }
  }

  return success;
}

/**
 * Worker startup and shutdown handling.
 */
async function main(): Promise<void> {
  logger.info('Starting webhook worker...');

  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down webhook worker...');
    await closeQueue();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  try {
    await connectQueue();
    await consumeWebhooks(handleWebhook);
    logger.info('Webhook worker ready and consuming messages');
  } catch (error) {
    logger.error({ error }, 'Failed to start webhook worker');
    process.exit(1);
  }
}

main();
