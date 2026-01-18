import { pool } from '../db.js';
import { Reaction, ReactionSummary } from '../types/index.js';

/**
 * Allowed emojis for reactions.
 * Limited set to ensure consistent display across platforms.
 */
const ALLOWED_EMOJIS = ['❤️', '😂', '😮', '😢', '😠', '👍'];

/**
 * Adds a reaction to a message.
 * Each user can only react once with each emoji to a message.
 * @param messageId - The message to react to
 * @param userId - The user adding the reaction
 * @param emoji - The emoji reaction
 * @returns The created reaction, or null if emoji is invalid or already exists
 */
export async function addReaction(
  messageId: string,
  userId: string,
  emoji: string
): Promise<Reaction | null> {
  if (!ALLOWED_EMOJIS.includes(emoji)) {
    return null;
  }

  const result = await pool.query(
    `INSERT INTO message_reactions (message_id, user_id, emoji)
     VALUES ($1, $2, $3)
     ON CONFLICT (message_id, user_id, emoji) DO NOTHING
     RETURNING *`,
    [messageId, userId, emoji]
  );

  return result.rows[0] || null;
}

/**
 * Removes a reaction from a message.
 * @param messageId - The message to remove reaction from
 * @param userId - The user removing their reaction
 * @param emoji - The emoji to remove
 * @returns True if reaction was removed, false if it didn't exist
 */
export async function removeReaction(
  messageId: string,
  userId: string,
  emoji: string
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM message_reactions
     WHERE message_id = $1 AND user_id = $2 AND emoji = $3
     RETURNING id`,
    [messageId, userId, emoji]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Gets reaction summary for a message.
 * Returns aggregated counts and whether the requesting user has reacted.
 * @param messageId - The message to get reactions for
 * @param userId - The requesting user (to check if they reacted)
 * @returns Array of reaction summaries with emoji, count, and userReacted flag
 */
export async function getReactionsForMessage(
  messageId: string,
  userId: string
): Promise<ReactionSummary[]> {
  const result = await pool.query(
    `SELECT
       emoji,
       COUNT(*) as count,
       bool_or(user_id = $2) as user_reacted
     FROM message_reactions
     WHERE message_id = $1
     GROUP BY emoji
     ORDER BY MIN(created_at) ASC`,
    [messageId, userId]
  );

  return result.rows.map((row) => ({
    emoji: row.emoji,
    count: parseInt(row.count, 10),
    userReacted: row.user_reacted,
  }));
}

/**
 * Gets the conversation ID for a message.
 * Used to determine which users to notify of reaction updates.
 * @param messageId - The message ID
 * @returns The conversation ID or null if message not found
 */
export async function getMessageConversationId(
  messageId: string
): Promise<string | null> {
  const result = await pool.query(
    'SELECT conversation_id FROM messages WHERE id = $1',
    [messageId]
  );
  return result.rows[0]?.conversation_id || null;
}

/**
 * Validates that an emoji is in the allowed set.
 * @param emoji - The emoji to validate
 * @returns True if allowed, false otherwise
 */
export function isValidEmoji(emoji: string): boolean {
  return ALLOWED_EMOJIS.includes(emoji);
}

/**
 * Gets the list of allowed emojis.
 * @returns Array of allowed emoji strings
 */
export function getAllowedEmojis(): string[] {
  return [...ALLOWED_EMOJIS];
}
