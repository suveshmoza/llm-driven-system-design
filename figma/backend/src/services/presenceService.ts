import redis, { redisPub, redisSub } from '../db/redis.js';
import type { PresenceState } from '../types/index.js';

/**
 * Time-to-live for presence data in seconds.
 * Presence entries expire automatically if not refreshed.
 */
// Presence data TTL (30 seconds)
const PRESENCE_TTL = 30;

/**
 * Color palette for user cursors.
 * Each user gets a consistent color based on their user ID hash.
 */
// Random colors for user cursors
const CURSOR_COLORS = [
  '#EF4444', '#F97316', '#F59E0B', '#84CC16', '#22C55E',
  '#14B8A6', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6',
  '#A855F7', '#D946EF', '#EC4899', '#F43F5E',
];

/**
 * Service for managing real-time user presence in collaborative editing.
 * Tracks cursor positions, selections, and active users per file.
 * Uses Redis for storage and pub/sub for cross-server synchronization.
 */
export class PresenceService {
  private subscribers = new Map<string, Set<(presence: PresenceState[]) => void>>();

  constructor() {
    this.setupSubscriber();
  }

  /**
   * Sets up the Redis subscriber to listen for presence updates.
   * Routes incoming presence changes to registered callbacks.
   */
  private setupSubscriber() {
    redisSub.on('message', async (channel, _message) => {
      if (channel.startsWith('presence:')) {
        const fileId = channel.replace('presence:', '');
        const callbacks = this.subscribers.get(fileId);
        if (callbacks && callbacks.size > 0) {
          const presence = await this.getFilePresence(fileId);
          callbacks.forEach(cb => cb(presence));
        }
      }
    });
  }

  /**
   * Gets a consistent color for a user based on their ID.
   * Uses a hash function to map user IDs to colors.
   * @param userId - The user's unique identifier
   * @returns A hex color string from the CURSOR_COLORS palette
   */
  // Get a color for a user
  getColorForUser(userId: string): string {
    // Use hash of userId to get consistent color
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = ((hash << 5) - hash) + userId.charCodeAt(i);
      hash = hash & hash;
    }
    return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
  }

  /**
   * Updates a user's presence state in a file.
   * Stores in Redis with TTL and publishes to all subscribers.
   * @param fileId - The file the user is viewing
   * @param presence - The user's current presence state
   */
  // Update presence for a user in a file
  async updatePresence(fileId: string, presence: PresenceState): Promise<void> {
    const key = `presence:${fileId}:${presence.userId}`;
    await redis.setex(key, PRESENCE_TTL, JSON.stringify(presence));

    // Publish update
    await redisPub.publish(`presence:${fileId}`, JSON.stringify(presence));
  }

  /**
   * Removes a user's presence from a file.
   * Called when a user disconnects or leaves the file.
   * @param fileId - The file the user is leaving
   * @param userId - The user's unique identifier
   */
  // Remove presence for a user
  async removePresence(fileId: string, userId: string): Promise<void> {
    const key = `presence:${fileId}:${userId}`;
    await redis.del(key);

    // Publish removal
    await redisPub.publish(`presence:${fileId}`, JSON.stringify({ userId, removed: true }));
  }

  /**
   * Gets all active presence states for a file.
   * Retrieves from Redis and parses the JSON data.
   * @param fileId - The file to get presence for
   * @returns Promise resolving to array of presence states
   */
  // Get all presence data for a file
  async getFilePresence(fileId: string): Promise<PresenceState[]> {
    const pattern = `presence:${fileId}:*`;
    const keys = await redis.keys(pattern);

    if (keys.length === 0) return [];

    const values = await redis.mget(...keys);
    return values
      .filter((v): v is string => v !== null)
      .map(v => JSON.parse(v) as PresenceState);
  }

  /**
   * Subscribes to presence updates for a file.
   * Registers a callback to receive real-time presence changes.
   * @param fileId - The file to subscribe to
   * @param callback - Function to call with updated presence array
   * @returns Unsubscribe function to stop receiving updates
   */
  // Subscribe to presence updates for a file
  subscribeToFile(fileId: string, callback: (presence: PresenceState[]) => void): () => void {
    if (!this.subscribers.has(fileId)) {
      this.subscribers.set(fileId, new Set());
      redisSub.subscribe(`presence:${fileId}`);
    }

    this.subscribers.get(fileId)!.add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.subscribers.get(fileId);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.subscribers.delete(fileId);
          redisSub.unsubscribe(`presence:${fileId}`);
        }
      }
    };
  }

  /**
   * Refreshes the TTL on a user's presence entry.
   * Called periodically to keep presence alive without full update.
   * @param fileId - The file the user is in
   * @param userId - The user's unique identifier
   */
  // Touch presence to keep it alive
  async touchPresence(fileId: string, userId: string): Promise<void> {
    const key = `presence:${fileId}:${userId}`;
    const exists = await redis.exists(key);
    if (exists) {
      await redis.expire(key, PRESENCE_TTL);
    }
  }
}

/**
 * Singleton instance of the PresenceService.
 * Used throughout the application for presence management.
 */
export const presenceService = new PresenceService();
