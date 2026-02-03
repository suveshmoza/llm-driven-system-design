/**
 * Notification worker for DocuSign
 * Processes notifications, emails, reminders queues.
 */
import amqp, { Channel, ConsumeMessage } from 'amqplib';
import logger from '../shared/logger.js';
import { pool } from '../shared/db.js';
import {
  QUEUES,
  NotificationMessage,
  EmailMessage,
  ReminderMessage,
  WorkflowEvent,
} from '../shared/queue.js';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

let channel: Channel | null = null;

/**
 * Process notification messages - send in-app notifications.
 */
async function processNotification(msg: ConsumeMessage): Promise<void> {
  const content: NotificationMessage = JSON.parse(msg.content.toString());
  const { recipientId, envelopeId, type, channels } = content;

  logger.info({ recipientId, envelopeId, type }, 'Processing notification');

  // Store in-app notification
  await pool.query(
    `INSERT INTO notifications (user_id, type, title, message, data, read, created_at)
     VALUES ($1, $2, $3, $4, $5, false, NOW())`,
    [
      recipientId,
      type,
      getNotificationTitle(type),
      getNotificationMessage(type, envelopeId),
      JSON.stringify({ envelopeId, channels }),
    ]
  );

  // If email channel requested, queue email
  if (channels?.includes('email')) {
    const user = await pool.query('SELECT email, name FROM users WHERE id = $1', [recipientId]);
    if (user.rows[0]) {
      await queueEmail({
        recipientId,
        recipientEmail: user.rows[0].email,
        subject: getNotificationTitle(type),
        body: getNotificationMessage(type, envelopeId),
      });
    }
  }

  logger.info({ recipientId, type }, 'Notification processed');
}

/**
 * Process email messages - simulate email sending.
 */
async function processEmail(msg: ConsumeMessage): Promise<void> {
  const content: EmailMessage = JSON.parse(msg.content.toString());
  const { recipientId, recipientEmail, subject, body } = content;

  logger.info({ recipientEmail, subject }, 'Processing email');

  // Store email record (simulated sending)
  await pool.query(
    `INSERT INTO email_log (recipient_id, recipient_email, subject, body, status, sent_at)
     VALUES ($1, $2, $3, $4, 'sent', NOW())`,
    [recipientId, recipientEmail, subject, body]
  );

  // In production: integrate with SendGrid, SES, etc.
  logger.info({ recipientEmail, subject }, 'Email sent (simulated)');
}

/**
 * Process workflow events - update envelope state and trigger next actions.
 */
async function processWorkflow(msg: ConsumeMessage): Promise<void> {
  const event: WorkflowEvent = JSON.parse(msg.content.toString());
  const { eventType, envelopeId, recipientId, data } = event;

  logger.info({ eventType, envelopeId }, 'Processing workflow event');

  // Log workflow event
  await pool.query(
    `INSERT INTO workflow_events (envelope_id, event_type, recipient_id, data, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [envelopeId, eventType, recipientId, JSON.stringify(data)]
  );

  // Handle specific workflow events
  switch (eventType) {
    case 'recipient.signed':
      await handleRecipientSigned(envelopeId, recipientId!);
      break;
    case 'envelope.completed':
      await handleEnvelopeCompleted(envelopeId);
      break;
    case 'envelope.voided':
      await handleEnvelopeVoided(envelopeId);
      break;
  }

  logger.info({ eventType, envelopeId }, 'Workflow event processed');
}

/**
 * Process reminder messages - send signing reminders.
 */
async function processReminder(msg: ConsumeMessage): Promise<void> {
  const content: ReminderMessage = JSON.parse(msg.content.toString());
  const { envelopeId, recipientId, scheduledFor } = content;

  logger.info({ envelopeId, recipientId }, 'Processing reminder');

  // Check if reminder is still needed (envelope not completed/voided)
  const envelope = await pool.query(
    'SELECT status FROM envelopes WHERE id = $1',
    [envelopeId]
  );

  if (envelope.rows[0]?.status === 'sent' || envelope.rows[0]?.status === 'delivered') {
    // Send reminder notification
    const user = await pool.query('SELECT email, name FROM users WHERE id = $1', [recipientId]);
    if (user.rows[0]) {
      await queueEmail({
        recipientId,
        recipientEmail: user.rows[0].email,
        subject: 'Reminder: Document awaiting your signature',
        body: `You have a document waiting for your signature. Please sign it at your earliest convenience.`,
      });
    }

    logger.info({ envelopeId, recipientId }, 'Reminder sent');
  } else {
    logger.info({ envelopeId, status: envelope.rows[0]?.status }, 'Reminder skipped - envelope no longer pending');
  }
}

async function handleRecipientSigned(envelopeId: string, recipientId: string): Promise<void> {
  // Check if all recipients have signed
  const pending = await pool.query(
    `SELECT COUNT(*) as count FROM recipients
     WHERE envelope_id = $1 AND status != 'completed'`,
    [envelopeId]
  );

  if (parseInt(pending.rows[0].count) === 0) {
    // All signed - mark envelope complete
    await pool.query(
      `UPDATE envelopes SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [envelopeId]
    );
  }
}

async function handleEnvelopeCompleted(envelopeId: string): Promise<void> {
  // Notify all participants
  const recipients = await pool.query(
    'SELECT user_id FROM recipients WHERE envelope_id = $1',
    [envelopeId]
  );

  for (const r of recipients.rows) {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, data, read, created_at)
       VALUES ($1, 'envelope.completed', 'Document Completed', 'All parties have signed the document.', $2, false, NOW())`,
      [r.user_id, JSON.stringify({ envelopeId })]
    );
  }
}

async function handleEnvelopeVoided(envelopeId: string): Promise<void> {
  // Notify all participants
  const recipients = await pool.query(
    'SELECT user_id FROM recipients WHERE envelope_id = $1',
    [envelopeId]
  );

  for (const r of recipients.rows) {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, data, read, created_at)
       VALUES ($1, 'envelope.voided', 'Document Voided', 'The document has been voided by the sender.', $2, false, NOW())`,
      [r.user_id, JSON.stringify({ envelopeId })]
    );
  }
}

function getNotificationTitle(type: string): string {
  const titles: Record<string, string> = {
    'envelope.sent': 'New Document to Sign',
    'recipient.signed': 'Document Signed',
    'envelope.completed': 'All Signatures Complete',
    'envelope.voided': 'Document Voided',
    'reminder': 'Signing Reminder',
  };
  return titles[type] || 'Notification';
}

function getNotificationMessage(type: string, envelopeId: string): string {
  const messages: Record<string, string> = {
    'envelope.sent': 'You have a new document waiting for your signature.',
    'recipient.signed': 'A recipient has signed the document.',
    'envelope.completed': 'All parties have signed the document.',
    'envelope.voided': 'The document has been voided.',
    'reminder': 'Please sign the pending document.',
  };
  return messages[type] || `Notification for envelope ${envelopeId}`;
}

async function queueEmail(email: EmailMessage): Promise<void> {
  if (!channel) return;
  channel.sendToQueue(
    QUEUES.EMAIL,
    Buffer.from(JSON.stringify(email)),
    { persistent: true }
  );
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  logger.info('Starting DocuSign notification worker...');

  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();

    // Set prefetch for fair distribution
    await channel.prefetch(10);

    // Start consumers for all queues
    await channel.consume(QUEUES.NOTIFICATIONS, async (msg) => {
      if (!msg) return;
      try {
        await processNotification(msg);
        channel!.ack(msg);
      } catch (error) {
        logger.error({ error }, 'Error processing notification');
        channel!.nack(msg, false, false);
      }
    });

    await channel.consume(QUEUES.EMAIL, async (msg) => {
      if (!msg) return;
      try {
        await processEmail(msg);
        channel!.ack(msg);
      } catch (error) {
        logger.error({ error }, 'Error processing email');
        channel!.nack(msg, false, false);
      }
    });

    await channel.consume(QUEUES.WORKFLOW, async (msg) => {
      if (!msg) return;
      try {
        await processWorkflow(msg);
        channel!.ack(msg);
      } catch (error) {
        logger.error({ error }, 'Error processing workflow');
        channel!.nack(msg, false, false);
      }
    });

    await channel.consume(QUEUES.REMINDERS, async (msg) => {
      if (!msg) return;
      try {
        await processReminder(msg);
        channel!.ack(msg);
      } catch (error) {
        logger.error({ error }, 'Error processing reminder');
        channel!.nack(msg, false, false);
      }
    });

    logger.info('DocuSign worker started, consuming from all queues...');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down worker...');
      await channel?.close();
      await connection.close();
      await pool.end();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down worker...');
      await channel?.close();
      await connection.close();
      await pool.end();
      process.exit(0);
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start worker');
    process.exit(1);
  }
}

main();
