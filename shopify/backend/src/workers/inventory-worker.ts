/**
 * Inventory sync worker for Shopify
 * Processes inventory.sync and inventory.alerts queues.
 */
import { connect, close, subscribe, getChannel } from '../services/rabbitmq.js';
import logger from '../services/logger.js';
import pool, { query } from '../services/db.js';
import type { ConsumeMessage } from 'amqplib';

interface InventoryEventPayload {
  event: string;
  messageId: string;
  timestamp: string;
  data: {
    storeId: number;
    variantId: number;
    oldQuantity: number;
    newQuantity: number;
    change: number;
    reason?: string;
    locationId?: number;
  };
}

/**
 * Process inventory sync events.
 * - Validates inventory levels
 * - Updates aggregated counts
 * - Triggers alerts if needed
 */
async function handleInventorySync(message: InventoryEventPayload): Promise<void> {
  const { storeId, variantId, newQuantity, change } = message.data;

  logger.info({ storeId, variantId, newQuantity, change }, 'Processing inventory sync event');

  // Update inventory sync log
  await query(`
    INSERT INTO inventory_sync_log (store_id, variant_id, quantity_change, new_quantity, synced_at)
    VALUES ($1, $2, $3, $4, NOW())
  `, [storeId, variantId, change, newQuantity]);

  // Update product availability status
  const productResult = await query(`
    SELECT p.id, p.title,
           (SELECT SUM(i.quantity) FROM inventory i
            JOIN product_variants pv ON i.variant_id = pv.id
            WHERE pv.product_id = p.id) as total_stock
    FROM products p
    JOIN product_variants pv ON p.id = pv.product_id
    WHERE pv.id = $1 AND p.store_id = $2
  `, [variantId, storeId]);

  if (productResult.rows[0]) {
    const totalStock = productResult.rows[0].total_stock || 0;
    const status = totalStock > 0 ? 'active' : 'out_of_stock';

    await query(`
      UPDATE products
      SET inventory_status = $1, updated_at = NOW()
      WHERE id = $2
    `, [status, productResult.rows[0].id]);
  }

  logger.info({ storeId, variantId }, 'Inventory sync event processed');
}

/**
 * Process inventory alert events (low stock, out of stock).
 * - Creates notification for store owner
 * - Updates inventory alert status
 */
async function handleInventoryAlert(message: InventoryEventPayload): Promise<void> {
  const { storeId, variantId, newQuantity } = message.data;

  const alertType = newQuantity === 0 ? 'out_of_stock' : 'low_stock';

  logger.info({ storeId, variantId, alertType, quantity: newQuantity }, 'Processing inventory alert');

  // Get variant and product details
  const result = await query(`
    SELECT pv.sku, pv.title as variant_title, p.title as product_title,
           s.owner_id, u.email as owner_email
    FROM product_variants pv
    JOIN products p ON pv.product_id = p.id
    JOIN stores s ON p.store_id = s.id
    JOIN users u ON s.owner_id = u.id
    WHERE pv.id = $1 AND p.store_id = $2
  `, [variantId, storeId]);

  if (result.rows[0]) {
    const { sku, variant_title, product_title, owner_id, owner_email } = result.rows[0];

    // Create inventory alert record
    await query(`
      INSERT INTO inventory_alerts (store_id, variant_id, alert_type, quantity, acknowledged, created_at)
      VALUES ($1, $2, $3, $4, false, NOW())
      ON CONFLICT (store_id, variant_id, alert_type)
      DO UPDATE SET quantity = EXCLUDED.quantity, acknowledged = false, updated_at = NOW()
    `, [storeId, variantId, alertType, newQuantity]);

    // Create notification for store owner
    await query(`
      INSERT INTO notifications (user_id, type, title, message, data, read, created_at)
      VALUES ($1, $2, $3, $4, $5, false, NOW())
    `, [
      owner_id,
      alertType,
      alertType === 'out_of_stock' ? 'Product Out of Stock' : 'Low Stock Alert',
      `${product_title} - ${variant_title || sku} ${alertType === 'out_of_stock' ? 'is now out of stock' : 'has low inventory (' + newQuantity + ' remaining)'}`,
      JSON.stringify({ variantId, storeId, quantity: newQuantity })
    ]);

    // Queue alert email
    await query(`
      INSERT INTO email_queue (store_id, recipient_email, template, data, status, created_at)
      VALUES ($1, $2, $3, $4, 'pending', NOW())
    `, [
      storeId,
      owner_email,
      'inventory_alert',
      JSON.stringify({
        alertType,
        productTitle: product_title,
        variantTitle: variant_title,
        sku,
        quantity: newQuantity
      })
    ]);

    logger.info({ storeId, variantId, alertType }, 'Inventory alert processed and notifications sent');
  }
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  logger.info('Starting Shopify inventory worker...');

  try {
    await connect();

    // Subscribe to inventory sync queue
    await subscribe('inventory.sync', async (message, msg) => {
      const payload = message as unknown as InventoryEventPayload;
      await handleInventorySync(payload);
    });

    // Subscribe to inventory alerts queue
    await subscribe('inventory.alerts', async (message, msg) => {
      const payload = message as unknown as InventoryEventPayload;
      await handleInventoryAlert(payload);
    });

    logger.info('Shopify inventory worker started, waiting for messages...');

    const shutdown = async () => {
      logger.info('Shutting down inventory worker...');
      await close();
      await pool.end();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error({ error }, 'Failed to start inventory worker');
    process.exit(1);
  }
}

main();
