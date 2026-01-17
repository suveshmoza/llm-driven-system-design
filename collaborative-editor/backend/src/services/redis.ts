import { createClient, type RedisClientType } from 'redis';
import type { ClientInfo, CursorPosition, SelectionRange } from '../types/index.js';

/**
 * Singleton Redis client for presence and real-time data.
 * Lazily initialized on first access.
 */
let redisClient: RedisClientType | null = null;

/**
 * Get or create the Redis client connection.
 *
 * Uses lazy initialization to avoid connecting until needed.
 * The client is configured via REDIS_URL environment variable.
 *
 * @returns The connected Redis client
 */
export async function getRedisClient(): Promise<RedisClientType> {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });

    redisClient.on('error', (err) => {
      console.error('Redis error:', err);
    });

    await redisClient.connect();
  }
  return redisClient;
}

/**
 * Presence management for tracking connected clients.
 *
 * Uses Redis hashes to store client information per document.
 * Each document has a hash at key `presence:{documentId}` with
 * client IDs as fields and ClientInfo JSON as values.
 *
 * Data expires after 1 hour to automatically clean up stale entries.
 */
export const presence = {
  /**
   * Add a client to a document's presence list.
   * Stores the client info and sets a 1-hour TTL on the presence key.
   *
   * @param documentId - The document's UUID
   * @param client - The client information to store
   */
  async addClient(documentId: string, client: ClientInfo): Promise<void> {
    const redis = await getRedisClient();
    const key = `presence:${documentId}`;
    await redis.hSet(key, client.clientId, JSON.stringify(client));
    await redis.expire(key, 3600); // 1 hour TTL
  },

  /**
   * Remove a client from a document's presence list.
   * Called when a WebSocket connection closes.
   *
   * @param documentId - The document's UUID
   * @param clientId - The client's session ID to remove
   */
  async removeClient(documentId: string, clientId: string): Promise<void> {
    const redis = await getRedisClient();
    const key = `presence:${documentId}`;
    await redis.hDel(key, clientId);
  },

  /**
   * Get all clients present in a document.
   * Retrieves the full presence list for broadcasting to new clients.
   *
   * @param documentId - The document's UUID
   * @returns Map of client IDs to client information
   */
  async getClients(documentId: string): Promise<Map<string, ClientInfo>> {
    const redis = await getRedisClient();
    const key = `presence:${documentId}`;
    const data = await redis.hGetAll(key);

    const clients = new Map<string, ClientInfo>();
    for (const [clientId, clientJson] of Object.entries(data)) {
      try {
        clients.set(clientId, JSON.parse(clientJson));
      } catch {
        // Skip invalid entries
      }
    }
    return clients;
  },

  /**
   * Update a client's cursor position.
   * Modifies the stored ClientInfo to include the new cursor location.
   *
   * @param documentId - The document's UUID
   * @param clientId - The client's session ID
   * @param cursor - The new cursor position
   */
  async updateCursor(
    documentId: string,
    clientId: string,
    cursor: CursorPosition
  ): Promise<void> {
    const redis = await getRedisClient();
    const key = `presence:${documentId}`;
    const clientJson = await redis.hGet(key, clientId);

    if (clientJson) {
      const client: ClientInfo = JSON.parse(clientJson);
      client.cursor = cursor;
      await redis.hSet(key, clientId, JSON.stringify(client));
    }
  },

  /**
   * Update a client's text selection.
   * Modifies the stored ClientInfo to include the new selection range.
   *
   * @param documentId - The document's UUID
   * @param clientId - The client's session ID
   * @param selection - The new selection range, or null to clear
   */
  async updateSelection(
    documentId: string,
    clientId: string,
    selection: SelectionRange | null
  ): Promise<void> {
    const redis = await getRedisClient();
    const key = `presence:${documentId}`;
    const clientJson = await redis.hGet(key, clientId);

    if (clientJson) {
      const client: ClientInfo = JSON.parse(clientJson);
      client.selection = selection;
      await redis.hSet(key, clientId, JSON.stringify(client));
    }
  },

  /**
   * Clear all presence data for a document.
   * Useful for cleanup when all clients disconnect or for testing.
   *
   * @param documentId - The document's UUID
   */
  async clearDocument(documentId: string): Promise<void> {
    const redis = await getRedisClient();
    await redis.del(`presence:${documentId}`);
  },
};

/**
 * Close the Redis connection.
 * Should be called during graceful shutdown.
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
