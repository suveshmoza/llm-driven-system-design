import { query, getClient } from './db.js';
import { cacheDel } from './redis.js';
import logger from './logger.js';
import { emailsSentTotal } from './metrics.js';

export interface SendMessageInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  threadId?: string;
  inReplyTo?: string;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
}

/**
 * Send a message — creates or adds to a thread
 */
export const sendMessage = async (
  senderId: string,
  input: SendMessageInput
): Promise<{ threadId: string; messageId: string }> => {
  const client = await getClient();

  try {
    await client.query('BEGIN');

    // Look up recipient user IDs by email
    const allRecipientEmails = [
      ...input.to,
      ...(input.cc || []),
      ...(input.bcc || []),
    ];

    const recipientResult = await client.query<UserRow>(
      `SELECT id, email, display_name FROM users WHERE email = ANY($1)`,
      [allRecipientEmails]
    );

    const recipientMap = new Map<string, UserRow>();
    for (const row of recipientResult.rows) {
      recipientMap.set(row.email, row);
    }

    // Create or use existing thread
    let threadId = input.threadId;

    if (!threadId) {
      const threadResult = await client.query<{ id: string }>(
        `INSERT INTO threads (subject, snippet, message_count, last_message_at)
         VALUES ($1, $2, 1, NOW())
         RETURNING id`,
        [input.subject, input.bodyText.substring(0, 100)]
      );
      threadId = threadResult.rows[0].id;
    } else {
      await client.query(
        `UPDATE threads SET
           snippet = $1,
           message_count = message_count + 1,
           last_message_at = NOW()
         WHERE id = $2`,
        [input.bodyText.substring(0, 100), threadId]
      );
    }

    // Create the message
    const messageResult = await client.query<{ id: string }>(
      `INSERT INTO messages (thread_id, sender_id, in_reply_to, body_text, body_html, has_attachments)
       VALUES ($1, $2, $3, $4, $5, false)
       RETURNING id`,
      [
        threadId,
        senderId,
        input.inReplyTo || null,
        input.bodyText,
        input.bodyHtml || null,
      ]
    );
    const messageId = messageResult.rows[0].id;

    // Create message_recipients entries
    for (const email of input.to) {
      const user = recipientMap.get(email);
      if (user) {
        await client.query(
          `INSERT INTO message_recipients (message_id, user_id, recipient_type)
           VALUES ($1, $2, 'to')`,
          [messageId, user.id]
        );
      }
    }

    for (const email of input.cc || []) {
      const user = recipientMap.get(email);
      if (user) {
        await client.query(
          `INSERT INTO message_recipients (message_id, user_id, recipient_type)
           VALUES ($1, $2, 'cc')`,
          [messageId, user.id]
        );
      }
    }

    for (const email of input.bcc || []) {
      const user = recipientMap.get(email);
      if (user) {
        await client.query(
          `INSERT INTO message_recipients (message_id, user_id, recipient_type)
           VALUES ($1, $2, 'bcc')`,
          [messageId, user.id]
        );
      }
    }

    // Get sender info for label lookup
    const senderResult = await client.query<UserRow>(
      `SELECT id, email, display_name FROM users WHERE id = $1`,
      [senderId]
    );
    const sender = senderResult.rows[0];

    // Get sender's SENT label
    const sentLabelResult = await client.query<{ id: string }>(
      `SELECT id FROM labels WHERE user_id = $1 AND name = 'SENT'`,
      [senderId]
    );

    // Add SENT label for sender
    if (sentLabelResult.rows.length > 0) {
      await client.query(
        `INSERT INTO thread_labels (thread_id, label_id, user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (thread_id, label_id, user_id) DO NOTHING`,
        [threadId, sentLabelResult.rows[0].id, senderId]
      );
    }

    // Ensure sender has thread_user_state
    await client.query(
      `INSERT INTO thread_user_state (thread_id, user_id, is_read)
       VALUES ($1, $2, true)
       ON CONFLICT (thread_id, user_id) DO UPDATE SET updated_at = NOW()`,
      [threadId, senderId]
    );

    // Add INBOX label and thread_user_state for each visible recipient (to + cc)
    const visibleRecipientEmails = [
      ...input.to,
      ...(input.cc || []),
      ...(input.bcc || []),
    ];

    for (const email of visibleRecipientEmails) {
      const user = recipientMap.get(email);
      if (user && user.id !== senderId) {
        // Get recipient's INBOX label
        const inboxLabelResult = await client.query<{ id: string }>(
          `SELECT id FROM labels WHERE user_id = $1 AND name = 'INBOX'`,
          [user.id]
        );

        if (inboxLabelResult.rows.length > 0) {
          await client.query(
            `INSERT INTO thread_labels (thread_id, label_id, user_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (thread_id, label_id, user_id) DO NOTHING`,
            [threadId, inboxLabelResult.rows[0].id, user.id]
          );
        }

        // Create or update thread_user_state (mark as unread for recipients)
        await client.query(
          `INSERT INTO thread_user_state (thread_id, user_id, is_read)
           VALUES ($1, $2, false)
           ON CONFLICT (thread_id, user_id) DO UPDATE SET is_read = false, updated_at = NOW()`,
          [threadId, user.id]
        );

        // Invalidate recipient's cache
        await cacheDel(`threads:${user.id}:*`);
        await cacheDel(`unread:${user.id}`);
      }
    }

    // Update contacts for sender
    for (const email of allRecipientEmails) {
      const user = recipientMap.get(email);
      if (user) {
        await client.query(
          `INSERT INTO contacts (user_id, contact_email, contact_name, frequency, last_contacted_at)
           VALUES ($1, $2, $3, 1, NOW())
           ON CONFLICT (user_id, contact_email)
           DO UPDATE SET frequency = contacts.frequency + 1, last_contacted_at = NOW(),
                         contact_name = COALESCE($3, contacts.contact_name)`,
          [senderId, email, user.display_name || sender.display_name]
        );
      }
    }

    await client.query('COMMIT');

    // Invalidate sender's cache
    await cacheDel(`threads:${senderId}:*`);
    await cacheDel(`unread:${senderId}`);

    emailsSentTotal.inc();

    logger.info(
      {
        senderId,
        threadId,
        messageId,
        recipientCount: allRecipientEmails.length,
      },
      'Message sent successfully'
    );

    return { threadId, messageId };
  } catch (error) {
    await client.query('ROLLBACK');
    const err = error as Error;
    logger.error({ error: err.message, senderId }, 'Failed to send message');
    throw error;
  } finally {
    client.release();
  }
};
