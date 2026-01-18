import { db, PendingMessage, CachedConversation, CachedMessage } from '../db/database';
import { Conversation, Message } from '../types';

/**
 * Queue a message for offline sending.
 * The message will be synced when the connection is restored.
 */
export async function queueOfflineMessage(
  clientMessageId: string,
  conversationId: string,
  content: string,
  contentType: 'text' | 'image' | 'video' | 'file' = 'text',
  mediaUrl?: string
): Promise<void> {
  const pendingMessage: PendingMessage = {
    clientMessageId,
    conversationId,
    content,
    contentType,
    mediaUrl,
    createdAt: new Date().toISOString(),
    status: 'pending',
    retryCount: 0,
  };

  await db.pendingMessages.put(pendingMessage);
}

/**
 * Get all pending messages that need to be synced.
 */
export async function getPendingMessages(): Promise<PendingMessage[]> {
  return db.pendingMessages
    .where('status')
    .equals('pending')
    .sortBy('createdAt');
}

/**
 * Mark a pending message as sending.
 */
export async function markMessageSending(clientMessageId: string): Promise<void> {
  await db.pendingMessages.update(clientMessageId, { status: 'sending' });
}

/**
 * Remove a pending message after successful sync.
 */
export async function removePendingMessage(clientMessageId: string): Promise<void> {
  await db.pendingMessages.delete(clientMessageId);
}

/**
 * Mark a pending message as failed and increment retry count.
 */
export async function markMessageFailed(clientMessageId: string): Promise<void> {
  const message = await db.pendingMessages.get(clientMessageId);
  if (message) {
    await db.pendingMessages.update(clientMessageId, {
      status: 'failed',
      retryCount: message.retryCount + 1,
    });
  }
}

/**
 * Reset failed messages back to pending for retry.
 */
export async function resetFailedMessages(): Promise<number> {
  const failed = await db.pendingMessages
    .where('status')
    .equals('failed')
    .toArray();

  const retryable = failed.filter((m) => m.retryCount < 3);

  await db.pendingMessages.bulkPut(
    retryable.map((m) => ({ ...m, status: 'pending' as const }))
  );

  return retryable.length;
}

/**
 * Cache conversations for offline access.
 */
export async function cacheConversations(conversations: Conversation[]): Promise<void> {
  const cachedAt = Date.now();
  const cached: CachedConversation[] = conversations.map((c) => ({
    id: c.id,
    name: c.name,
    is_group: c.is_group,
    created_at: c.created_at,
    updated_at: c.updated_at,
    lastMessagePreview: c.last_message?.content?.substring(0, 100),
    unread_count: c.unread_count || 0,
    cachedAt,
  }));

  await db.conversations.bulkPut(cached);
}

/**
 * Get cached conversations for offline display.
 */
export async function getCachedConversations(): Promise<CachedConversation[]> {
  return db.conversations.orderBy('updated_at').reverse().toArray();
}

/**
 * Cache messages for a conversation.
 */
export async function cacheMessages(conversationId: string, messages: Message[]): Promise<void> {
  const cachedAt = Date.now();
  const cached: CachedMessage[] = messages.map((m) => ({
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    content: m.content,
    contentType: m.content_type,
    mediaUrl: m.media_url,
    createdAt: m.created_at,
    status: (m.status as 'sent' | 'delivered' | 'read') || 'sent',
    senderName: m.sender?.display_name,
    cachedAt,
  }));

  await db.messages.bulkPut(cached);

  // Update sync metadata
  await db.syncMetadata.put({
    key: `lastSync:messages:${conversationId}`,
    value: new Date().toISOString(),
    updatedAt: Date.now(),
  });
}

/**
 * Get cached messages for a conversation.
 */
export async function getCachedMessages(
  conversationId: string,
  limit: number = 50,
  beforeId?: string
): Promise<CachedMessage[]> {
  let query = db.messages
    .where('[conversationId+createdAt]')
    .between([conversationId, ''], [conversationId, '\uffff']);

  if (beforeId) {
    const beforeMessage = await db.messages.get(beforeId);
    if (beforeMessage) {
      query = db.messages
        .where('[conversationId+createdAt]')
        .between([conversationId, ''], [conversationId, beforeMessage.createdAt]);
    }
  }

  return query.reverse().limit(limit).toArray();
}

/**
 * Add a single message to the cache.
 */
export async function addMessageToCache(message: Message): Promise<void> {
  const cached: CachedMessage = {
    id: message.id,
    conversationId: message.conversation_id,
    senderId: message.sender_id,
    content: message.content,
    contentType: message.content_type,
    mediaUrl: message.media_url,
    createdAt: message.created_at,
    status: (message.status as 'sent' | 'delivered' | 'read') || 'sent',
    senderName: message.sender?.display_name,
    cachedAt: Date.now(),
  };

  await db.messages.put(cached);
}

/**
 * Clear old cached data to manage storage.
 * Keeps last 7 days of messages and all conversations.
 */
export async function pruneOldCaches(): Promise<void> {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  await db.messages.where('cachedAt').below(sevenDaysAgo).delete();
}

/**
 * Check if we have cached data for a conversation.
 */
export async function hasCachedMessages(conversationId: string): Promise<boolean> {
  const count = await db.messages
    .where('conversationId')
    .equals(conversationId)
    .count();
  return count > 0;
}

/**
 * Get the last sync time for messages in a conversation.
 */
export async function getLastSyncTime(conversationId: string): Promise<Date | null> {
  const meta = await db.syncMetadata.get(`lastSync:messages:${conversationId}`);
  return meta ? new Date(meta.value) : null;
}
