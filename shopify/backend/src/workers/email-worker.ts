/**
 * Email notification worker for Shopify
 * Processes notifications.email queue for transactional emails.
 */
import { connect, close, subscribe, getChannel } from '../services/rabbitmq.js';
import logger from '../services/logger.js';
import pool, { query } from '../services/db.js';
import type { ConsumeMessage } from 'amqplib';

interface EmailPayload {
  event: string;
  messageId: string;
  timestamp: string;
  data: {
    to: string;
    template: string;
    payload: Record<string, unknown>;
    storeId?: number;
  };
}

/**
 * Email templates with content generators.
 */
const templates: Record<string, (data: Record<string, unknown>) => { subject: string; html: string }> = {
  order_confirmation: (data) => ({
    subject: `Order Confirmation - #${data.orderNumber}`,
    html: `
      <h1>Thank you for your order!</h1>
      <p>Your order <strong>#${data.orderNumber}</strong> has been received and is being processed.</p>
      <p>We'll send you another email when your order ships.</p>
    `,
  }),

  shipping_confirmation: (data) => ({
    subject: `Your order has shipped - #${data.orderNumber}`,
    html: `
      <h1>Your order is on its way!</h1>
      <p>Order <strong>#${data.orderNumber}</strong> has been shipped.</p>
      <p><strong>Tracking Number:</strong> ${data.trackingNumber || 'Not available'}</p>
      <p><strong>Carrier:</strong> ${data.carrier || 'Standard shipping'}</p>
    `,
  }),

  inventory_alert: (data) => ({
    subject: `${data.alertType === 'out_of_stock' ? 'Out of Stock' : 'Low Stock'} Alert: ${data.productTitle}`,
    html: `
      <h1>Inventory Alert</h1>
      <p><strong>Product:</strong> ${data.productTitle}</p>
      <p><strong>Variant:</strong> ${data.variantTitle || data.sku}</p>
      <p><strong>Status:</strong> ${data.alertType === 'out_of_stock' ? 'Out of Stock' : `Low Stock (${data.quantity} remaining)`}</p>
      <p>Please restock this item to continue selling.</p>
    `,
  }),

  password_reset: (data) => ({
    subject: 'Reset your password',
    html: `
      <h1>Password Reset Request</h1>
      <p>Click the link below to reset your password:</p>
      <p><a href="${data.resetUrl}">Reset Password</a></p>
      <p>If you didn't request this, please ignore this email.</p>
    `,
  }),

  welcome: (data) => ({
    subject: 'Welcome to your new store!',
    html: `
      <h1>Welcome to Shopify Clone!</h1>
      <p>Your store <strong>${data.storeName}</strong> is ready to go.</p>
      <p>Start by adding your first products and customizing your store theme.</p>
    `,
  }),
};

/**
 * Default template for unknown types.
 */
function defaultTemplate(data: Record<string, unknown>): { subject: string; html: string } {
  return {
    subject: 'Notification from your store',
    html: `<p>You have a new notification.</p>`,
  };
}

/**
 * Process email notification jobs.
 * - Generates email content from template
 * - Simulates sending (would use SendGrid/SES in production)
 * - Logs delivery status
 */
async function handleEmailNotification(message: EmailPayload): Promise<void> {
  const { to, template, payload, storeId } = message.data;

  logger.info({ to, template }, 'Processing email notification');

  // Get template content
  const templateFn = templates[template] || defaultTemplate;
  const { subject, html } = templateFn(payload);

  try {
    // Simulated email sending - in production use SendGrid, SES, etc.
    logger.info({ to, subject, template }, 'Sending email (simulated)');

    // In production:
    // await sendgrid.send({
    //   to,
    //   from: 'noreply@store.example.com',
    //   subject,
    //   html,
    // });

    // Log successful delivery
    await query(`
      INSERT INTO email_log
        (store_id, recipient_email, template, subject, body, status, sent_at)
      VALUES ($1, $2, $3, $4, $5, 'sent', NOW())
    `, [storeId, to, template, subject, html]);

    // Update email queue status
    await query(`
      UPDATE email_queue
      SET status = 'sent', sent_at = NOW()
      WHERE recipient_email = $1 AND template = $2 AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `, [to, template]);

    logger.info({ to, subject }, 'Email sent successfully');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error({ error, to, template }, 'Email sending failed');

    // Log failed delivery
    await query(`
      INSERT INTO email_log
        (store_id, recipient_email, template, subject, status, error, created_at)
      VALUES ($1, $2, $3, $4, 'failed', $5, NOW())
    `, [storeId, to, template, subject, errorMessage]);

    throw error; // Trigger retry
  }
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  logger.info('Starting Shopify email notification worker...');

  try {
    await connect();

    await subscribe('notifications.email', async (message, msg) => {
      const payload = message as unknown as EmailPayload;
      await handleEmailNotification(payload);
    }, { maxRetries: 3 });

    logger.info('Shopify email notification worker started, waiting for messages...');

    const shutdown = async () => {
      logger.info('Shutting down email notification worker...');
      await close();
      await pool.end();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error({ error }, 'Failed to start email notification worker');
    process.exit(1);
  }
}

main();
