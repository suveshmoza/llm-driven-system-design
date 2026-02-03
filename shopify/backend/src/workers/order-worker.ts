/**
 * Order events worker for Shopify
 * Processes orders.created and orders.fulfilled queues.
 */
import { connect, close, subscribe, getChannel } from '../services/rabbitmq.js';
import logger from '../services/logger.js';
import pool, { query } from '../services/db.js';
import type { ConsumeMessage } from 'amqplib';

interface OrderEventPayload {
  event: string;
  messageId: string;
  timestamp: string;
  data: {
    orderId: number;
    orderNumber: string;
    storeId: number;
    customerEmail: string;
    total: number;
    items?: Array<{
      variantId: number;
      title?: string;
      quantity: number;
      price: number;
    }>;
    trackingNumber?: string;
    carrier?: string;
  };
}

/**
 * Process order created events.
 * - Updates inventory
 * - Triggers confirmation email
 * - Notifies any webhooks
 */
async function handleOrderCreated(message: OrderEventPayload): Promise<void> {
  const { orderId, orderNumber, storeId, customerEmail, items } = message.data;

  logger.info({ orderId, orderNumber, storeId }, 'Processing order created event');

  // Decrease inventory for each item
  if (items && items.length > 0) {
    for (const item of items) {
      await query(`
        UPDATE inventory
        SET quantity = quantity - $1,
            updated_at = NOW()
        WHERE variant_id = $2 AND store_id = $3
      `, [item.quantity, item.variantId, storeId]);

      // Check if inventory is low
      const result = await query(`
        SELECT quantity FROM inventory
        WHERE variant_id = $1 AND store_id = $2
      `, [item.variantId, storeId]);

      if (result.rows[0]?.quantity < 10) {
        logger.warn({
          variantId: item.variantId,
          storeId,
          quantity: result.rows[0].quantity
        }, 'Low inventory alert');

        // Would trigger inventory.alerts event here
      }
    }
  }

  // Log order activity
  await query(`
    INSERT INTO order_activity (order_id, activity_type, details, created_at)
    VALUES ($1, 'created', $2, NOW())
  `, [orderId, JSON.stringify({ source: 'queue', processedAt: new Date().toISOString() })]);

  // Queue confirmation email
  await query(`
    INSERT INTO email_queue (store_id, recipient_email, template, data, status, created_at)
    VALUES ($1, $2, 'order_confirmation', $3, 'pending', NOW())
  `, [storeId, customerEmail, JSON.stringify({ orderNumber, orderId })]);

  logger.info({ orderId, orderNumber }, 'Order created event processed');
}

/**
 * Process order fulfilled events.
 * - Updates order status
 * - Triggers shipping notification
 */
async function handleOrderFulfilled(message: OrderEventPayload): Promise<void> {
  const { orderId, orderNumber, storeId, customerEmail, trackingNumber, carrier } = message.data;

  logger.info({ orderId, orderNumber, trackingNumber }, 'Processing order fulfilled event');

  // Update order status
  await query(`
    UPDATE orders
    SET status = 'fulfilled',
        fulfillment_status = 'fulfilled',
        tracking_number = $1,
        carrier = $2,
        fulfilled_at = NOW(),
        updated_at = NOW()
    WHERE id = $3
  `, [trackingNumber, carrier, orderId]);

  // Log fulfillment activity
  await query(`
    INSERT INTO order_activity (order_id, activity_type, details, created_at)
    VALUES ($1, 'fulfilled', $2, NOW())
  `, [orderId, JSON.stringify({ trackingNumber, carrier, processedAt: new Date().toISOString() })]);

  // Queue shipping notification email
  await query(`
    INSERT INTO email_queue (store_id, recipient_email, template, data, status, created_at)
    VALUES ($1, $2, 'shipping_confirmation', $3, 'pending', NOW())
  `, [storeId, customerEmail, JSON.stringify({ orderNumber, trackingNumber, carrier })]);

  logger.info({ orderId, orderNumber }, 'Order fulfilled event processed');
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  logger.info('Starting Shopify order events worker...');

  try {
    await connect();

    // Subscribe to orders.created queue
    await subscribe('orders.created', async (message, msg) => {
      const payload = message as unknown as OrderEventPayload;
      await handleOrderCreated(payload);
    });

    // Subscribe to orders.fulfilled queue
    await subscribe('orders.fulfilled', async (message, msg) => {
      const payload = message as unknown as OrderEventPayload;
      await handleOrderFulfilled(payload);
    });

    logger.info('Shopify order events worker started, waiting for messages...');

    const shutdown = async () => {
      logger.info('Shutting down order events worker...');
      await close();
      await pool.end();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error({ error }, 'Failed to start order events worker');
    process.exit(1);
  }
}

main();
