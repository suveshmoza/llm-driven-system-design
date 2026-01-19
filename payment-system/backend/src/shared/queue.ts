import amqplib, { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.js';
import { metricsRegistry } from './metrics.js';
import { Counter, Histogram } from 'prom-client';

/**
 * RabbitMQ queue integration for async payment processing.
 *
 * Provides queues for:
 * - Webhook delivery: Notify merchants of payment events
 * - Fraud scoring: Async transaction risk analysis
 * - Settlements: Batch processing of merchant payouts
 *
 * Design decisions:
 * - Durable queues: Messages survive broker restarts
 * - Persistent messages: Written to disk before ack
 * - Manual acknowledgment: Ensures processing completes
 * - Dead letter exchange: Failed messages are preserved for debugging
 */

// ============================================================================
// Queue Metrics
// ============================================================================

/** Counter for published messages by queue */
export const queueMessagesPublished = new Counter({
  name: 'queue_messages_published_total',
  help: 'Total messages published to queues',
  labelNames: ['queue'] as const,
  registers: [metricsRegistry],
});

/** Counter for consumed messages by queue and result */
export const queueMessagesConsumed = new Counter({
  name: 'queue_messages_consumed_total',
  help: 'Total messages consumed from queues',
  labelNames: ['queue', 'result'] as const,
  registers: [metricsRegistry],
});

/** Histogram for message processing duration */
export const queueProcessingDuration = new Histogram({
  name: 'queue_processing_duration_seconds',
  help: 'Message processing duration in seconds',
  labelNames: ['queue'] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [metricsRegistry],
});

// ============================================================================
// Queue Configuration
// ============================================================================

/** Queue names used in the payment system */
export const QUEUES = {
  WEBHOOKS: 'webhooks',
  FRAUD_SCORING: 'fraud-scoring',
  SETTLEMENTS: 'settlements',
} as const;

/** Dead letter exchange for failed messages */
const DLX_EXCHANGE = 'payment-dlx';

/** Connection and channel state */
let connection: ChannelModel | null = null;
let channel: Channel | null = null;

// ============================================================================
// Connection Management
// ============================================================================

/**
 * Establishes connection to RabbitMQ and creates queues.
 * Should be called once during application startup.
 *
 * @returns Promise that resolves when connected and queues are ready
 * @throws Error if connection fails
 */
export async function connectQueue(): Promise<void> {
  const url = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

  try {
    connection = await amqplib.connect(url);
    channel = await connection.createChannel();

    // Set prefetch to 1 for fair dispatch and better load balancing
    await channel.prefetch(1);

    // Create dead letter exchange for failed messages
    await channel.assertExchange(DLX_EXCHANGE, 'direct', { durable: true });

    // Create all queues with dead letter routing
    for (const queueName of Object.values(QUEUES)) {
      // Dead letter queue for each main queue
      const dlqName = `${queueName}-dlq`;
      await channel.assertQueue(dlqName, { durable: true });
      await channel.bindQueue(dlqName, DLX_EXCHANGE, queueName);

      // Main queue with DLX configuration
      await channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': DLX_EXCHANGE,
          'x-dead-letter-routing-key': queueName,
        },
      });
    }

    logger.info('RabbitMQ connected and queues initialized');

    // Handle connection events
    connection.on('error', (err) => {
      logger.error({ error: err }, 'RabbitMQ connection error');
    });

    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed');
      channel = null;
      connection = null;
    });
  } catch (error) {
    logger.error({ error }, 'Failed to connect to RabbitMQ');
    throw error;
  }
}

/**
 * Closes the RabbitMQ connection gracefully.
 * Should be called during application shutdown.
 */
export async function closeQueue(): Promise<void> {
  try {
    if (channel) {
      await channel.close();
      channel = null;
    }
    if (connection) {
      await connection.close();
      connection = null;
    }
    logger.info('RabbitMQ connection closed');
  } catch (error) {
    logger.error({ error }, 'Error closing RabbitMQ connection');
  }
}

/**
 * Gets the current channel, connecting if necessary.
 * @throws Error if not connected
 */
function getChannel(): Channel {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized. Call connectQueue() first.');
  }
  return channel;
}

// ============================================================================
// Message Types
// ============================================================================

/** Webhook event payload for merchant notification */
export interface WebhookMessage {
  id: string;
  merchantId: string;
  eventType: string;
  data: Record<string, unknown>;
  webhookUrl: string;
  webhookSecret?: string;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
}

/** Fraud check request payload */
export interface FraudCheckMessage {
  id: string;
  paymentId: string;
  merchantId: string;
  amount: number;
  currency: string;
  paymentMethod: {
    type: string;
    last_four?: string;
    card_brand?: string;
  };
  customerEmail?: string;
  ipAddress?: string;
  createdAt: string;
}

/** Settlement batch payload */
export interface SettlementMessage {
  id: string;
  merchantId: string;
  transactionIds: string[];
  totalAmount: number;
  currency: string;
  scheduledAt: string;
  createdAt: string;
}

// ============================================================================
// Publisher Functions
// ============================================================================

/**
 * Publishes a webhook event for delivery to a merchant.
 *
 * @param eventType - Type of event (e.g., 'payment.captured')
 * @param merchantId - UUID of the merchant to notify
 * @param data - Event payload data
 * @param webhookUrl - Merchant's webhook endpoint
 * @param webhookSecret - Secret for signing the payload (optional)
 * @returns Message ID for tracking
 */
export async function publishWebhook(
  eventType: string,
  merchantId: string,
  data: Record<string, unknown>,
  webhookUrl: string,
  webhookSecret?: string
): Promise<string> {
  const ch = getChannel();
  const messageId = uuidv4();

  const message: WebhookMessage = {
    id: messageId,
    merchantId,
    eventType,
    data,
    webhookUrl,
    webhookSecret,
    attempt: 1,
    maxAttempts: parseInt(process.env.WEBHOOK_MAX_RETRIES || '5', 10),
    createdAt: new Date().toISOString(),
  };

  ch.sendToQueue(QUEUES.WEBHOOKS, Buffer.from(JSON.stringify(message)), {
    persistent: true,
    messageId,
    contentType: 'application/json',
    headers: {
      'x-event-type': eventType,
      'x-merchant-id': merchantId,
    },
  });

  queueMessagesPublished.labels(QUEUES.WEBHOOKS).inc();
  logger.debug({ messageId, eventType, merchantId }, 'Published webhook event');

  return messageId;
}

/**
 * Publishes a fraud check request for async scoring.
 *
 * @param paymentId - UUID of the payment to score
 * @param data - Transaction data for fraud analysis
 * @returns Message ID for tracking
 */
export async function publishFraudCheck(
  paymentId: string,
  data: Omit<FraudCheckMessage, 'id' | 'paymentId' | 'createdAt'>
): Promise<string> {
  const ch = getChannel();
  const messageId = uuidv4();

  const message: FraudCheckMessage = {
    id: messageId,
    paymentId,
    ...data,
    createdAt: new Date().toISOString(),
  };

  ch.sendToQueue(QUEUES.FRAUD_SCORING, Buffer.from(JSON.stringify(message)), {
    persistent: true,
    messageId,
    contentType: 'application/json',
    headers: {
      'x-payment-id': paymentId,
    },
  });

  queueMessagesPublished.labels(QUEUES.FRAUD_SCORING).inc();
  logger.debug({ messageId, paymentId }, 'Published fraud check request');

  return messageId;
}

/**
 * Publishes a settlement batch for processing.
 *
 * @param merchantId - UUID of the merchant to settle
 * @param transactionIds - Array of transaction IDs to include
 * @param totalAmount - Total settlement amount in cents
 * @param currency - Settlement currency
 * @param scheduledAt - When the settlement should be processed
 * @returns Message ID for tracking
 */
export async function publishSettlement(
  merchantId: string,
  transactionIds: string[],
  totalAmount: number,
  currency: string,
  scheduledAt: Date
): Promise<string> {
  const ch = getChannel();
  const messageId = uuidv4();

  const message: SettlementMessage = {
    id: messageId,
    merchantId,
    transactionIds,
    totalAmount,
    currency,
    scheduledAt: scheduledAt.toISOString(),
    createdAt: new Date().toISOString(),
  };

  ch.sendToQueue(QUEUES.SETTLEMENTS, Buffer.from(JSON.stringify(message)), {
    persistent: true,
    messageId,
    contentType: 'application/json',
    headers: {
      'x-merchant-id': merchantId,
      'x-scheduled-at': scheduledAt.toISOString(),
    },
  });

  queueMessagesPublished.labels(QUEUES.SETTLEMENTS).inc();
  logger.debug({ messageId, merchantId, transactionCount: transactionIds.length }, 'Published settlement batch');

  return messageId;
}

// ============================================================================
// Consumer Functions
// ============================================================================

/** Handler function type for message consumers */
export type MessageHandler<T> = (message: T) => Promise<boolean>;

/**
 * Starts consuming webhook messages for delivery.
 *
 * @param handler - Function to process each message. Return true to ack, false to nack.
 * @returns Consumer tag for cancellation
 */
export async function consumeWebhooks(
  handler: MessageHandler<WebhookMessage>
): Promise<string> {
  return consumeQueue(QUEUES.WEBHOOKS, handler);
}

/**
 * Starts consuming fraud check messages for scoring.
 *
 * @param handler - Function to process each message. Return true to ack, false to nack.
 * @returns Consumer tag for cancellation
 */
export async function consumeFraudChecks(
  handler: MessageHandler<FraudCheckMessage>
): Promise<string> {
  return consumeQueue(QUEUES.FRAUD_SCORING, handler);
}

/**
 * Starts consuming settlement messages for processing.
 *
 * @param handler - Function to process each message. Return true to ack, false to nack.
 * @returns Consumer tag for cancellation
 */
export async function consumeSettlements(
  handler: MessageHandler<SettlementMessage>
): Promise<string> {
  return consumeQueue(QUEUES.SETTLEMENTS, handler);
}

/**
 * Generic queue consumer with error handling and metrics.
 *
 * @param queueName - Name of the queue to consume from
 * @param handler - Message handler function
 * @returns Consumer tag
 */
async function consumeQueue<T>(
  queueName: string,
  handler: MessageHandler<T>
): Promise<string> {
  const ch = getChannel();

  const { consumerTag } = await ch.consume(
    queueName,
    async (msg: ConsumeMessage | null) => {
      if (!msg) return;

      const startTime = Date.now();
      let success = false;

      try {
        const content = JSON.parse(msg.content.toString()) as T;
        success = await handler(content);

        if (success) {
          ch.ack(msg);
          queueMessagesConsumed.labels(queueName, 'success').inc();
        } else {
          // Requeue once, then dead letter
          const requeued = !msg.fields.redelivered;
          ch.nack(msg, false, requeued);
          queueMessagesConsumed.labels(queueName, requeued ? 'requeued' : 'dead-lettered').inc();
        }
      } catch (error) {
        logger.error({ error, queueName, messageId: msg.properties.messageId }, 'Error processing message');
        // Don't requeue on parse errors or unhandled exceptions
        ch.nack(msg, false, false);
        queueMessagesConsumed.labels(queueName, 'error').inc();
      }

      const duration = (Date.now() - startTime) / 1000;
      queueProcessingDuration.labels(queueName).observe(duration);
    },
    { noAck: false }
  );

  logger.info({ queueName, consumerTag }, 'Started consuming queue');
  return consumerTag;
}

/**
 * Requeues a webhook message with incremented attempt count.
 * Used for retry logic in the webhook worker.
 *
 * @param message - Original webhook message
 * @param delayMs - Delay before the message becomes visible (requires delayed message plugin)
 */
export async function requeueWebhook(
  message: WebhookMessage,
  delayMs: number = 0
): Promise<void> {
  const ch = getChannel();

  const updatedMessage: WebhookMessage = {
    ...message,
    attempt: message.attempt + 1,
  };

  // Note: For production, use a delayed message exchange plugin or
  // implement delay via message TTL and dead-letter routing
  ch.sendToQueue(QUEUES.WEBHOOKS, Buffer.from(JSON.stringify(updatedMessage)), {
    persistent: true,
    messageId: message.id,
    contentType: 'application/json',
    headers: {
      'x-event-type': message.eventType,
      'x-merchant-id': message.merchantId,
      'x-attempt': updatedMessage.attempt,
      'x-delay': delayMs, // Requires delayed message plugin
    },
  });

  logger.debug(
    { messageId: message.id, attempt: updatedMessage.attempt },
    'Requeued webhook for retry'
  );
}
