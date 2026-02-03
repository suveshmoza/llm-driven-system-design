/**
 * Email worker for Notion
 * Processes notion.email queue for email notifications.
 */
import { queueManager, QUEUES, EmailMessage } from '../shared/queue.js';
import { logger } from '../shared/logger.js';
import pool from '../models/db.js';

/**
 * Email templates with HTML content.
 */
const templates: Record<string, (data: Record<string, unknown>) => { subject: string; html: string }> = {
  page_shared: (data) => ({
    subject: `${data.sharerName || 'Someone'} shared "${data.pageTitle || 'a page'}" with you`,
    html: `
      <h2>You've been given access to a page</h2>
      <p>${data.sharerName || 'Someone'} shared "<strong>${data.pageTitle || 'a page'}</strong>" with you.</p>
      <p><a href="${data.pageUrl || '#'}">Open page</a></p>
    `,
  }),

  workspace_invite: (data) => ({
    subject: `You're invited to join "${data.workspaceName || 'a workspace'}"`,
    html: `
      <h2>Workspace Invitation</h2>
      <p>You've been invited to join <strong>${data.workspaceName || 'a workspace'}</strong>.</p>
      <p><a href="${data.inviteUrl || '#'}">Accept invitation</a></p>
    `,
  }),

  comment_notification: (data) => ({
    subject: `New comment on "${data.pageTitle || 'a page'}"`,
    html: `
      <h2>New Comment</h2>
      <p>${data.commenterName || 'Someone'} commented on "<strong>${data.pageTitle || 'a page'}</strong>":</p>
      <blockquote>${data.commentText || ''}</blockquote>
      <p><a href="${data.pageUrl || '#'}">View comment</a></p>
    `,
  }),

  mention_notification: (data) => ({
    subject: `${data.mentionerName || 'Someone'} mentioned you`,
    html: `
      <h2>You were mentioned</h2>
      <p>${data.mentionerName || 'Someone'} mentioned you in "<strong>${data.pageTitle || 'a page'}</strong>".</p>
      <p><a href="${data.pageUrl || '#'}">View page</a></p>
    `,
  }),

  export_ready: (data) => ({
    subject: `Your export is ready`,
    html: `
      <h2>Export Complete</h2>
      <p>Your ${data.exportType || 'export'} for "<strong>${data.pageTitle || 'a page'}</strong>" is ready.</p>
      <p><a href="${data.downloadUrl || '#'}">Download export</a></p>
    `,
  }),
};

/**
 * Default template for unknown types.
 */
function defaultTemplate(data: Record<string, unknown>): { subject: string; html: string } {
  return {
    subject: 'Notification from Notion',
    html: `<p>You have a new notification.</p>`,
  };
}

/**
 * Process email messages.
 * Simulates email sending (would use SendGrid/SES in production).
 */
async function processEmail(message: EmailMessage): Promise<void> {
  const { to, subject, template, data } = message;

  logger.info({ to, template }, 'Processing email');

  // Get template content
  const templateFn = templates[template] || defaultTemplate;
  const { subject: generatedSubject, html } = templateFn(data);

  // Use provided subject or generated one
  const finalSubject = subject || generatedSubject;

  // Store email log (simulated sending)
  await pool.query(`
    INSERT INTO email_log (recipient_email, subject, template, body, data, status, created_at)
    VALUES ($1, $2, $3, $4, $5, 'sent', NOW())
  `, [to, finalSubject, template, html, JSON.stringify(data)]);

  // In production, integrate with email service:
  // await sendgrid.send({
  //   to,
  //   from: 'noreply@notion-clone.local',
  //   subject: finalSubject,
  //   html,
  // });

  logger.info({ to, subject: finalSubject }, 'Email sent (simulated)');
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  logger.info('Starting Notion email worker...');

  try {
    await queueManager.connect();

    await queueManager.consume('email', async (message: EmailMessage) => {
      await processEmail(message);
    });

    logger.info('Notion email worker started, waiting for messages...');

    const shutdown = async () => {
      logger.info('Shutting down email worker...');
      await queueManager.close();
      await pool.end();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error({ error }, 'Failed to start email worker');
    process.exit(1);
  }
}

main();
