import Dexie, { Table } from 'dexie';

/**
 * Offline message stored in IndexedDB for later sync.
 */
export interface PendingMessage {
  clientMessageId: string;
  conversationId: string;
  content: string;
  contentType: 'text' | 'image' | 'video' | 'file';
  mediaUrl?: string;
  createdAt: string;
  status: 'pending' | 'sending' | 'failed';
  retryCount: number;
}

/**
 * Cached conversation for offline access.
 */
export interface CachedConversation {
  id: string;
  name?: string;
  is_group: boolean;
  created_at: string;
  updated_at: string;
  lastMessagePreview?: string;
  unread_count: number;
  cachedAt: number;
}

/**
 * Cached message for offline access.
 */
export interface CachedMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  contentType: 'text' | 'image' | 'video' | 'file';
  mediaUrl?: string;
  createdAt: string;
  status: 'sent' | 'delivered' | 'read';
  senderName?: string;
  cachedAt: number;
}

/**
 * Sync metadata for tracking offline state.
 */
export interface SyncMetadata {
  key: string;
  value: string;
  updatedAt: number;
}

/**
 * Dexie database for offline-first WhatsApp functionality.
 * Stores pending messages, cached conversations, and messages.
 */
class WhatsAppDatabase extends Dexie {
  pendingMessages!: Table<PendingMessage, string>;
  conversations!: Table<CachedConversation, string>;
  messages!: Table<CachedMessage, string>;
  syncMetadata!: Table<SyncMetadata, string>;

  constructor() {
    super('WhatsAppOffline');

    this.version(1).stores({
      // Primary key is clientMessageId, index by conversationId and status
      pendingMessages: 'clientMessageId, conversationId, status, createdAt',
      // Primary key is id, index by updatedAt for sorting
      conversations: 'id, updated_at, cachedAt',
      // Primary key is id, compound index for querying by conversation and time
      messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
      // Key-value store for sync state
      syncMetadata: 'key',
    });
  }
}

export const db = new WhatsAppDatabase();

/**
 * Clear all cached data (useful for logout).
 */
export async function clearAllCaches(): Promise<void> {
  await db.transaction('rw', [db.pendingMessages, db.conversations, db.messages, db.syncMetadata], async () => {
    await db.pendingMessages.clear();
    await db.conversations.clear();
    await db.messages.clear();
    await db.syncMetadata.clear();
  });
}

/**
 * Get the count of pending messages waiting to be synced.
 */
export async function getPendingMessageCount(): Promise<number> {
  return db.pendingMessages.where('status').equals('pending').count();
}
