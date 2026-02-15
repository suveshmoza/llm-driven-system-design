import { pool } from './db.js';
import { logger } from './logger.js';

/** Persists a chat message to the database, supporting optional direct messages. */
export async function saveMessage(
  meetingId: string,
  senderId: string,
  content: string,
  recipientId?: string | null
) {
  const result = await pool.query(
    `INSERT INTO meeting_chat_messages (meeting_id, sender_id, content, recipient_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [meetingId, senderId, content, recipientId || null]
  );
  logger.debug({ meetingId, senderId, recipientId }, 'Chat message saved');
  return result.rows[0];
}

/** Retrieves chat messages for a meeting in chronological order. */
export async function getMessages(meetingId: string, limit = 100) {
  const result = await pool.query(
    `SELECT m.*, u.username AS sender_name, u.display_name AS sender_display_name
     FROM meeting_chat_messages m
     JOIN users u ON m.sender_id = u.id
     WHERE m.meeting_id = $1
     ORDER BY m.created_at ASC
     LIMIT $2`,
    [meetingId, limit]
  );
  return result.rows;
}
