/**
 * RabbitMQ integration for distributed job processing.
 * Provides queues for scrape jobs, price updates, and alerts.
 * Uses amqplib for connection management with automatic reconnection.
 * @module shared/queue
 */
import amqp, { Connection, Channel, ConsumeMessage } from 'amqplib';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

/** RabbitMQ connection URL */
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

/** Queue names */
export const QUEUE_SCRAPE_JOBS = 'scrape-jobs';
export const QUEUE_PRICE_UPDATES = 'price-updates';
export const QUEUE_ALERTS = 'alerts';

/** Singleton connection and channel */
let connection: Connection | null = null;
let channel: Channel | null = null;

/** Reconnection state */
let isReconnecting = false;
const RECONNECT_DELAY_MS = 5000;

/**
 * Message payload for scrape job queue.
 */
export interface ScrapeJobMessage {
  productId: string;
  url: string;
  priority: number;
}

/**
 * Message payload for price update queue.
 */
export interface PriceUpdateMessage {
  productId: string;
  oldPrice: number | null;
  newPrice: number;
  timestamp: string;
}

/**
 * Message payload for alert queue.
 */
export interface AlertMessage {
  userId: string;
  productId: string;
  message: string;
  alertType: 'target_reached' | 'price_drop' | 'back_in_stock';
  oldPrice: number | null;
  newPrice: number;
  timestamp: string;
}

/**
 * Establishes connection to RabbitMQ and creates channel.
 * Sets up automatic reconnection on connection loss.
 * Asserts all required queues with durable configuration.
 */
export async function connectQueue(): Promise<void> {
  if (connection && channel) {
    return;
  }

  try {
    logger.info({ action: 'rabbitmq_connecting', url: RABBITMQ_URL.replace(/:[^:@]*@/, ':***@') }, 'Connecting to RabbitMQ...');

    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();

    // Set prefetch to process one message at a time per consumer
    await channel.prefetch(1);

    // Assert all queues as durable
    await channel.assertQueue(QUEUE_SCRAPE_JOBS, { durable: true });
    await channel.assertQueue(QUEUE_PRICE_UPDATES, { durable: true });
    await channel.assertQueue(QUEUE_ALERTS, { durable: true });

    logger.info({ action: 'rabbitmq_connected' }, 'Connected to RabbitMQ');

    // Handle connection errors
    connection.on('error', (err) => {
      logger.error({ error: err, action: 'rabbitmq_error' }, 'RabbitMQ connection error');
      handleDisconnect();
    });

    connection.on('close', () => {
      logger.warn({ action: 'rabbitmq_closed' }, 'RabbitMQ connection closed');
      handleDisconnect();
    });

  } catch (error) {
    logger.error({ error, action: 'rabbitmq_connect_failed' }, 'Failed to connect to RabbitMQ');
    handleDisconnect();
    throw error;
  }
}

/**
 * Handles disconnection and schedules reconnection attempt.
 */
function handleDisconnect(): void {
  connection = null;
  channel = null;

  if (!isReconnecting) {
    isReconnecting = true;
    logger.info({ action: 'rabbitmq_reconnecting', delayMs: RECONNECT_DELAY_MS }, `Reconnecting in ${RECONNECT_DELAY_MS}ms...`);

    setTimeout(async () => {
      isReconnecting = false;
      try {
        await connectQueue();
      } catch (error) {
        logger.error({ error, action: 'rabbitmq_reconnect_failed' }, 'Reconnection failed');
      }
    }, RECONNECT_DELAY_MS);
  }
}

/**
 * Gets the current channel, connecting if necessary.
 * @returns The RabbitMQ channel
 */
async function getChannel(): Promise<Channel> {
  if (!channel) {
    await connectQueue();
  }
  if (!channel) {
    throw new Error('RabbitMQ channel not available');
  }
  return channel;
}

/**
 * Publishes a scrape job to the queue.
 * @param productId - The product ID to scrape
 * @param url - The product URL
 * @param priority - Scrape priority (1-10, lower = higher priority)
 */
export async function publishScrapeJob(productId: string, url: string, priority: number = 5): Promise<void> {
  const ch = await getChannel();
  const message: ScrapeJobMessage = { productId, url, priority };

  ch.sendToQueue(
    QUEUE_SCRAPE_JOBS,
    Buffer.from(JSON.stringify(message)),
    { persistent: true, priority }
  );

  logger.debug({ action: 'scrape_job_published', productId, priority }, `Published scrape job for product ${productId}`);
}

/**
 * Publishes a price update event to the queue.
 * @param productId - The product ID
 * @param oldPrice - Previous price (null if first scrape)
 * @param newPrice - New price
 */
export async function publishPriceUpdate(productId: string, oldPrice: number | null, newPrice: number): Promise<void> {
  const ch = await getChannel();
  const message: PriceUpdateMessage = {
    productId,
    oldPrice,
    newPrice,
    timestamp: new Date().toISOString(),
  };

  ch.sendToQueue(
    QUEUE_PRICE_UPDATES,
    Buffer.from(JSON.stringify(message)),
    { persistent: true }
  );

  logger.debug(
    { action: 'price_update_published', productId, oldPrice, newPrice },
    `Published price update for product ${productId}`
  );
}

/**
 * Publishes an alert to the queue.
 * @param userId - The user to notify
 * @param productId - The product that triggered the alert
 * @param message - Human-readable alert message
 * @param alertType - Type of alert
 * @param oldPrice - Previous price
 * @param newPrice - New price
 */
export async function publishAlert(
  userId: string,
  productId: string,
  message: string,
  alertType: 'target_reached' | 'price_drop' | 'back_in_stock' = 'price_drop',
  oldPrice: number | null = null,
  newPrice: number = 0
): Promise<void> {
  const ch = await getChannel();
  const alertMessage: AlertMessage = {
    userId,
    productId,
    message,
    alertType,
    oldPrice,
    newPrice,
    timestamp: new Date().toISOString(),
  };

  ch.sendToQueue(
    QUEUE_ALERTS,
    Buffer.from(JSON.stringify(alertMessage)),
    { persistent: true }
  );

  logger.debug(
    { action: 'alert_published', userId, productId, alertType },
    `Published alert for user ${userId}`
  );
}

/**
 * Type for message handler callback functions.
 */
export type MessageHandler<T> = (message: T) => Promise<void>;

/**
 * Consumes messages from the scrape jobs queue.
 * @param handler - Async function to process each scrape job
 */
export async function consumeScrapeJobs(handler: MessageHandler<ScrapeJobMessage>): Promise<void> {
  const ch = await getChannel();

  await ch.consume(QUEUE_SCRAPE_JOBS, async (msg: ConsumeMessage | null) => {
    if (!msg) return;

    try {
      const message: ScrapeJobMessage = JSON.parse(msg.content.toString());
      logger.debug({ action: 'scrape_job_received', productId: message.productId }, 'Received scrape job');

      await handler(message);
      ch.ack(msg);

    } catch (error) {
      logger.error({ error, action: 'scrape_job_error' }, 'Error processing scrape job');
      // Reject and requeue on failure
      ch.nack(msg, false, true);
    }
  });

  logger.info({ queue: QUEUE_SCRAPE_JOBS, action: 'consumer_started' }, `Started consuming from ${QUEUE_SCRAPE_JOBS}`);
}

/**
 * Consumes messages from the price updates queue.
 * @param handler - Async function to process each price update
 */
export async function consumePriceUpdates(handler: MessageHandler<PriceUpdateMessage>): Promise<void> {
  const ch = await getChannel();

  await ch.consume(QUEUE_PRICE_UPDATES, async (msg: ConsumeMessage | null) => {
    if (!msg) return;

    try {
      const message: PriceUpdateMessage = JSON.parse(msg.content.toString());
      logger.debug(
        { action: 'price_update_received', productId: message.productId },
        'Received price update'
      );

      await handler(message);
      ch.ack(msg);

    } catch (error) {
      logger.error({ error, action: 'price_update_error' }, 'Error processing price update');
      ch.nack(msg, false, true);
    }
  });

  logger.info({ queue: QUEUE_PRICE_UPDATES, action: 'consumer_started' }, `Started consuming from ${QUEUE_PRICE_UPDATES}`);
}

/**
 * Consumes messages from the alerts queue.
 * @param handler - Async function to process each alert
 */
export async function consumeAlerts(handler: MessageHandler<AlertMessage>): Promise<void> {
  const ch = await getChannel();

  await ch.consume(QUEUE_ALERTS, async (msg: ConsumeMessage | null) => {
    if (!msg) return;

    try {
      const message: AlertMessage = JSON.parse(msg.content.toString());
      logger.debug(
        { action: 'alert_received', userId: message.userId, productId: message.productId },
        'Received alert'
      );

      await handler(message);
      ch.ack(msg);

    } catch (error) {
      logger.error({ error, action: 'alert_error' }, 'Error processing alert');
      ch.nack(msg, false, true);
    }
  });

  logger.info({ queue: QUEUE_ALERTS, action: 'consumer_started' }, `Started consuming from ${QUEUE_ALERTS}`);
}

/**
 * Gracefully closes the RabbitMQ connection.
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
    logger.info({ action: 'rabbitmq_disconnected' }, 'Disconnected from RabbitMQ');
  } catch (error) {
    logger.error({ error, action: 'rabbitmq_close_error' }, 'Error closing RabbitMQ connection');
  }
}

/**
 * Gets queue statistics for monitoring.
 * @param queueName - Name of the queue to check
 * @returns Object with message count and consumer count
 */
export async function getQueueStats(queueName: string): Promise<{ messageCount: number; consumerCount: number }> {
  const ch = await getChannel();
  const result = await ch.checkQueue(queueName);
  return {
    messageCount: result.messageCount,
    consumerCount: result.consumerCount,
  };
}
