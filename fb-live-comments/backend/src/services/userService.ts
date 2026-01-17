/**
 * User Service Module
 *
 * Manages user accounts, reputation, and moderation actions (bans).
 * Users are participants in live streams who can post comments and reactions.
 * Reputation scores influence trust levels and rate limits.
 *
 * @module services/userService
 */

import { query } from '../db/index.js';
import { User } from '../types/index.js';

/**
 * Service class for user management operations.
 * Handles user CRUD, reputation tracking, and ban management.
 */
export class UserService {
  /**
   * Retrieves a user by their unique ID.
   *
   * @param userId - User's unique identifier
   * @returns User object or null if not found
   */
  async getUser(userId: string): Promise<User | null> {
    const rows = await query<User>('SELECT * FROM users WHERE id = $1', [userId]);
    return rows[0] || null;
  }

  /**
   * Retrieves a user by their username.
   *
   * @param username - User's unique username
   * @returns User object or null if not found
   */
  async getUserByUsername(username: string): Promise<User | null> {
    const rows = await query<User>('SELECT * FROM users WHERE username = $1', [username]);
    return rows[0] || null;
  }

  /**
   * Creates a new user account.
   * New users start with default reputation and user role.
   *
   * @param username - Unique username for the account
   * @param displayName - Public display name shown in comments
   * @param avatarUrl - Optional URL to user's avatar image
   * @returns Newly created user object
   */
  async createUser(
    username: string,
    displayName: string,
    avatarUrl?: string
  ): Promise<User> {
    const rows = await query<User>(
      `INSERT INTO users (username, display_name, avatar_url)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [username, displayName, avatarUrl || null]
    );
    return rows[0];
  }

  /**
   * Updates a user's reputation score.
   * Score is clamped between 0 and 1 to prevent abuse.
   * Higher scores may unlock higher rate limits.
   *
   * @param userId - User to update
   * @param delta - Amount to add (positive) or subtract (negative)
   */
  async updateReputation(userId: string, delta: number): Promise<void> {
    await query(
      `UPDATE users SET
         reputation_score = GREATEST(0, LEAST(1, reputation_score + $1)),
         updated_at = NOW()
       WHERE id = $2`,
      [delta, userId]
    );
  }

  /**
   * Checks if a user is banned globally or from a specific stream.
   * Considers ban expiration times.
   *
   * @param userId - User to check
   * @param streamId - Optional stream to check for stream-specific bans
   * @returns true if user is currently banned
   */
  async isBanned(userId: string, streamId?: string): Promise<boolean> {
    const rows = await query<{ id: string }>(
      `SELECT id FROM user_bans
       WHERE user_id = $1
         AND (stream_id IS NULL OR stream_id = $2)
         AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [userId, streamId || null]
    );
    return rows.length > 0;
  }

  /**
   * Bans a user globally or from a specific stream.
   * Bans can be permanent or temporary (with expiration).
   *
   * @param userId - User to ban
   * @param bannedBy - ID of the moderator/admin issuing the ban
   * @param reason - Optional reason for the ban
   * @param streamId - Optional stream ID for stream-specific bans
   * @param expiresAt - Optional expiration date for temporary bans
   */
  async banUser(
    userId: string,
    bannedBy: string,
    reason?: string,
    streamId?: string,
    expiresAt?: Date
  ): Promise<void> {
    await query(
      `INSERT INTO user_bans (user_id, stream_id, banned_by, reason, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, streamId || null, bannedBy, reason || null, expiresAt || null]
    );
  }

  /**
   * Removes a ban from a user.
   * Can unban globally or from a specific stream.
   *
   * @param userId - User to unban
   * @param streamId - Optional stream ID to unban from specific stream only
   */
  async unbanUser(userId: string, streamId?: string): Promise<void> {
    if (streamId) {
      await query(
        'DELETE FROM user_bans WHERE user_id = $1 AND stream_id = $2',
        [userId, streamId]
      );
    } else {
      await query('DELETE FROM user_bans WHERE user_id = $1', [userId]);
    }
  }

  /**
   * Retrieves all users in the system.
   * Used for user selection UI in the demo.
   *
   * @returns Array of all users, ordered by creation date (newest first)
   */
  async getAllUsers(): Promise<User[]> {
    return query<User>('SELECT * FROM users ORDER BY created_at DESC');
  }
}

/** Singleton user service instance */
export const userService = new UserService();
