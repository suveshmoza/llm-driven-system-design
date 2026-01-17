import pool from '../db/pool.js';
import { Notification } from '../types/index.js';
import redis from '../db/redis.js';

/**
 * Service for managing user notifications.
 * Handles creating, fetching, and managing notifications for device events,
 * security alerts, and system messages. Uses Redis pub/sub for real-time delivery.
 */
export class NotificationService {
  /**
   * Create a new notification and broadcast it via Redis pub/sub.
   * Clients subscribed to the user's channel receive real-time updates.
   *
   * @param data - Notification data including user, type, and message
   * @returns The created notification
   */
  async createNotification(data: {
    user_id: string;
    device_id?: string;
    type: Notification['type'];
    title: string;
    message?: string;
    data?: Record<string, unknown>;
  }): Promise<Notification> {
    const result = await pool.query(
      `INSERT INTO notifications (user_id, device_id, type, title, message, data)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [data.user_id, data.device_id, data.type, data.title, data.message, data.data]
    );

    const notification = result.rows[0];

    // Publish to Redis for real-time updates
    await redis.publish(`notifications:${data.user_id}`, JSON.stringify(notification));

    return notification;
  }

  /**
   * Get notifications for a user with optional filtering.
   *
   * @param userId - The ID of the user to fetch notifications for
   * @param options - Filter options for unread-only and limit
   * @returns Array of notifications sorted by creation date descending
   */
  async getNotifications(
    userId: string,
    options: { unreadOnly?: boolean; limit?: number } = {}
  ): Promise<Notification[]> {
    const limit = options.limit || 50;
    let query = `SELECT * FROM notifications WHERE user_id = $1`;

    if (options.unreadOnly) {
      query += ` AND is_read = false`;
    }

    query += ` ORDER BY created_at DESC LIMIT $2`;

    const result = await pool.query(query, [userId, limit]);
    return result.rows;
  }

  /**
   * Mark a single notification as read.
   * Verifies the notification belongs to the user.
   *
   * @param notificationId - The UUID of the notification
   * @param userId - The ID of the user who should own the notification
   * @returns True if the notification was updated, false if not found
   */
  async markAsRead(notificationId: string, userId: string): Promise<boolean> {
    const result = await pool.query(
      `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
      [notificationId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Mark all unread notifications as read for a user.
   *
   * @param userId - The ID of the user
   * @returns Number of notifications that were marked as read
   */
  async markAllAsRead(userId: string): Promise<number> {
    const result = await pool.query(
      `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
      [userId]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Delete a notification.
   * Verifies the notification belongs to the user.
   *
   * @param notificationId - The UUID of the notification
   * @param userId - The ID of the user who should own the notification
   * @returns True if the notification was deleted, false if not found
   */
  async deleteNotification(notificationId: string, userId: string): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM notifications WHERE id = $1 AND user_id = $2`,
      [notificationId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Get the count of unread notifications for a user.
   * Used for displaying badge counts in the UI.
   *
   * @param userId - The ID of the user
   * @returns Count of unread notifications
   */
  async getUnreadCount(userId: string): Promise<number> {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = false`,
      [userId]
    );
    return parseInt(result.rows[0].count);
  }

  /**
   * Get notification statistics for the admin dashboard.
   * Provides total counts, unread counts, and breakdown by type.
   *
   * @returns Statistics object with counts and breakdowns
   */
  async getNotificationStats(): Promise<{
    total: number;
    unread: number;
    byType: Record<string, number>;
  }> {
    const total = await pool.query(`SELECT COUNT(*) as count FROM notifications`);
    const unread = await pool.query(
      `SELECT COUNT(*) as count FROM notifications WHERE is_read = false`
    );
    const byType = await pool.query(
      `SELECT type, COUNT(*) as count FROM notifications GROUP BY type`
    );

    const typeMap: Record<string, number> = {};
    byType.rows.forEach((row: { type: string; count: string }) => {
      typeMap[row.type] = parseInt(row.count);
    });

    return {
      total: parseInt(total.rows[0].count),
      unread: parseInt(unread.rows[0].count),
      byType: typeMap,
    };
  }
}

export const notificationService = new NotificationService();
