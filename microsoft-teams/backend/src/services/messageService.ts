import { pool } from './db.js';
import { logger } from './logger.js';

/** Database row shape for a message including author info and reply count. */
export interface MessageRow {
  id: string;
  channel_id: string;
  user_id: string;
  parent_message_id: string | null;
  content: string;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  reply_count?: number;
  reactions?: Array<{ emoji: string; count: number; users: string[] }>;
}

/** Retrieves paginated top-level messages for a channel with reply counts. */
export async function getChannelMessages(
  channelId: string,
  limit = 50,
  before?: string,
): Promise<MessageRow[]> {
  try {
    let query = `
      SELECT m.*, u.username, u.display_name, u.avatar_url,
        (SELECT COUNT(*) FROM messages r WHERE r.parent_message_id = m.id)::int AS reply_count
      FROM messages m
      JOIN users u ON m.user_id = u.id
      WHERE m.channel_id = $1 AND m.parent_message_id IS NULL
    `;
    const params: (string | number)[] = [channelId];

    if (before) {
      query += ` AND m.created_at < $${params.length + 1}`;
      params.push(before);
    }

    query += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);
    return result.rows;
  } catch (err) {
    logger.error({ err, channelId }, 'Failed to get channel messages');
    throw err;
  }
}

/** Retrieves the parent message and all replies in a thread. */
export async function getThreadMessages(parentMessageId: string): Promise<MessageRow[]> {
  try {
    const result = await pool.query(
      `SELECT m.*, u.username, u.display_name, u.avatar_url
       FROM messages m
       JOIN users u ON m.user_id = u.id
       WHERE m.id = $1 OR m.parent_message_id = $1
       ORDER BY m.created_at ASC`,
      [parentMessageId],
    );
    return result.rows;
  } catch (err) {
    logger.error({ err, parentMessageId }, 'Failed to get thread messages');
    throw err;
  }
}

/** Creates a new message or thread reply and returns it with author info. */
export async function createMessage(
  channelId: string,
  userId: string,
  content: string,
  parentMessageId?: string,
): Promise<MessageRow> {
  try {
    const result = await pool.query(
      `INSERT INTO messages (channel_id, user_id, content, parent_message_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [channelId, userId, content, parentMessageId || null],
    );

    const message = result.rows[0];

    // Fetch user info
    const userResult = await pool.query(
      'SELECT username, display_name, avatar_url FROM users WHERE id = $1',
      [userId],
    );
    const user = userResult.rows[0];

    return {
      ...message,
      username: user.username,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      reply_count: 0,
    };
  } catch (err) {
    logger.error({ err, channelId, userId }, 'Failed to create message');
    throw err;
  }
}

/** Edits a message's content if the user is the author. */
export async function editMessage(
  messageId: string,
  userId: string,
  content: string,
): Promise<MessageRow | null> {
  try {
    const result = await pool.query(
      `UPDATE messages SET content = $1, is_edited = true, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [content, messageId, userId],
    );

    if (result.rows.length === 0) return null;

    const message = result.rows[0];
    const userResult = await pool.query(
      'SELECT username, display_name, avatar_url FROM users WHERE id = $1',
      [userId],
    );
    const user = userResult.rows[0];

    return {
      ...message,
      username: user.username,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
    };
  } catch (err) {
    logger.error({ err, messageId, userId }, 'Failed to edit message');
    throw err;
  }
}

/** Deletes a message if the user is the author. */
export async function deleteMessage(messageId: string, userId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      'DELETE FROM messages WHERE id = $1 AND user_id = $2 RETURNING id',
      [messageId, userId],
    );
    return result.rows.length > 0;
  } catch (err) {
    logger.error({ err, messageId, userId }, 'Failed to delete message');
    throw err;
  }
}

/** Retrieves grouped emoji reactions for a batch of message IDs. */
export async function getMessageReactions(messageIds: string[]) {
  if (messageIds.length === 0) return {};

  const result = await pool.query(
    `SELECT mr.message_id, mr.emoji, mr.user_id, u.username
     FROM message_reactions mr
     JOIN users u ON mr.user_id = u.id
     WHERE mr.message_id = ANY($1)
     ORDER BY mr.created_at ASC`,
    [messageIds],
  );

  const reactions: Record<string, Array<{ emoji: string; count: number; users: string[] }>> = {};

  for (const row of result.rows) {
    if (!reactions[row.message_id]) {
      reactions[row.message_id] = [];
    }

    const existing = reactions[row.message_id].find((r) => r.emoji === row.emoji);
    if (existing) {
      existing.count++;
      existing.users.push(row.username);
    } else {
      reactions[row.message_id].push({
        emoji: row.emoji,
        count: 1,
        users: [row.username],
      });
    }
  }

  return reactions;
}
