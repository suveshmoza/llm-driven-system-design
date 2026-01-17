import { pool } from '../db.js';
import { Message, MessageStatus, MessageStatusUpdate } from '../types/index.js';

/**
 * Creates a new message in a conversation.
 * Uses a transaction to atomically insert the message, create status records
 * for all recipients, and update the conversation's timestamp.
 * @param conversationId - The conversation to send the message to
 * @param senderId - The user sending the message
 * @param content - The message content (text or caption for media)
 * @param contentType - Type of content: text, image, video, or file
 * @param mediaUrl - Optional URL to media attachment
 * @returns The created message
 */
export async function createMessage(
  conversationId: string,
  senderId: string,
  content: string,
  contentType: 'text' | 'image' | 'video' | 'file' = 'text',
  mediaUrl?: string
): Promise<Message> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Insert message
    const msgResult = await client.query(
      `INSERT INTO messages (conversation_id, sender_id, content, content_type, media_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [conversationId, senderId, content, contentType, mediaUrl]
    );
    const message = msgResult.rows[0];

    // Get all participants except sender
    const participantsResult = await client.query(
      `SELECT user_id FROM conversation_participants
       WHERE conversation_id = $1 AND user_id != $2`,
      [conversationId, senderId]
    );

    // Create message status for each recipient
    for (const participant of participantsResult.rows) {
      await client.query(
        `INSERT INTO message_status (message_id, recipient_id, status)
         VALUES ($1, $2, 'sent')`,
        [message.id, participant.user_id]
      );
    }

    // Update conversation timestamp
    await client.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [
      conversationId,
    ]);

    await client.query('COMMIT');

    return message;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Retrieves messages for a conversation with pagination support.
 * Returns messages in chronological order with sender information.
 * @param conversationId - The conversation to fetch messages from
 * @param limit - Maximum number of messages to return (default: 50)
 * @param beforeId - Optional message ID for cursor-based pagination
 * @returns Array of messages with embedded sender data
 */
export async function getMessagesForConversation(
  conversationId: string,
  limit: number = 50,
  beforeId?: string
): Promise<Message[]> {
  let query = `
    SELECT m.*,
           json_build_object(
             'id', u.id,
             'username', u.username,
             'display_name', u.display_name,
             'profile_picture_url', u.profile_picture_url
           ) as sender
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.conversation_id = $1
  `;

  const params: (string | number)[] = [conversationId];

  if (beforeId) {
    query += ` AND m.created_at < (SELECT created_at FROM messages WHERE id = $2)`;
    params.push(beforeId);
  }

  query += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await pool.query(query, params);
  return result.rows.reverse(); // Return in chronological order
}

/**
 * Retrieves a single message by its ID.
 * Includes sender information for display purposes.
 * @param messageId - The message's UUID
 * @returns The message with sender data if found, null otherwise
 */
export async function getMessageById(messageId: string): Promise<Message | null> {
  const result = await pool.query(
    `SELECT m.*,
            json_build_object(
              'id', u.id,
              'username', u.username,
              'display_name', u.display_name,
              'profile_picture_url', u.profile_picture_url
            ) as sender
     FROM messages m
     JOIN users u ON m.sender_id = u.id
     WHERE m.id = $1`,
    [messageId]
  );
  return result.rows[0] || null;
}

/**
 * Updates the delivery status for a specific recipient.
 * Tracks the progression: sent -> delivered -> read with timestamps.
 * @param messageId - The message to update
 * @param recipientId - The recipient whose status is being updated
 * @param status - The new status (delivered or read)
 * @returns The updated status record if successful, null otherwise
 */
export async function updateMessageStatus(
  messageId: string,
  recipientId: string,
  status: MessageStatus
): Promise<MessageStatusUpdate | null> {
  const updates: string[] = ['status = $3'];
  const params: (string | Date)[] = [messageId, recipientId, status];

  if (status === 'delivered') {
    updates.push('delivered_at = $4');
    params.push(new Date());
  } else if (status === 'read') {
    updates.push('read_at = $4');
    params.push(new Date());
    // Also set delivered if not already
    updates.push('delivered_at = COALESCE(delivered_at, $4)');
  }

  const result = await pool.query(
    `UPDATE message_status
     SET ${updates.join(', ')}
     WHERE message_id = $1 AND recipient_id = $2
     RETURNING *`,
    params
  );

  return result.rows[0] || null;
}

/**
 * Marks all unread messages in a conversation as read for a user.
 * Bulk operation used when user opens a conversation.
 * @param conversationId - The conversation being viewed
 * @param userId - The user who is reading the messages
 * @returns Array of message IDs that were marked as read
 */
export async function markConversationAsRead(
  conversationId: string,
  userId: string
): Promise<string[]> {
  // Get all unread message IDs for this user in this conversation
  const unreadResult = await pool.query(
    `SELECT m.id, m.sender_id
     FROM messages m
     JOIN message_status ms ON m.id = ms.message_id
     WHERE m.conversation_id = $1
     AND ms.recipient_id = $2
     AND ms.status != 'read'`,
    [conversationId, userId]
  );

  const messageIds: string[] = [];
  const senderIds = new Set<string>();

  for (const row of unreadResult.rows) {
    messageIds.push(row.id);
    senderIds.add(row.sender_id);
  }

  if (messageIds.length > 0) {
    // Mark all as read
    await pool.query(
      `UPDATE message_status
       SET status = 'read', read_at = NOW(), delivered_at = COALESCE(delivered_at, NOW())
       WHERE message_id = ANY($1) AND recipient_id = $2`,
      [messageIds, userId]
    );
  }

  return messageIds;
}

/**
 * Gets all status records for a message across all recipients.
 * Used to determine overall message delivery state (e.g., double blue check).
 * @param messageId - The message to query
 * @returns Array of status records for each recipient
 */
export async function getMessageStatus(messageId: string): Promise<MessageStatusUpdate[]> {
  const result = await pool.query('SELECT * FROM message_status WHERE message_id = $1', [
    messageId,
  ]);
  return result.rows;
}

/**
 * Retrieves all messages pending delivery for a user.
 * Called when user reconnects to deliver messages that arrived while offline.
 * @param userId - The user to get pending messages for
 * @returns Array of undelivered messages in chronological order
 */
export async function getPendingMessagesForUser(userId: string): Promise<Message[]> {
  const result = await pool.query(
    `SELECT m.*,
            json_build_object(
              'id', u.id,
              'username', u.username,
              'display_name', u.display_name,
              'profile_picture_url', u.profile_picture_url
            ) as sender
     FROM messages m
     JOIN users u ON m.sender_id = u.id
     JOIN message_status ms ON m.id = ms.message_id
     WHERE ms.recipient_id = $1 AND ms.status = 'sent'
     ORDER BY m.created_at ASC`,
    [userId]
  );
  return result.rows;
}
