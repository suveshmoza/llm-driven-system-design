import express, { Response } from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types.js';

const router = express.Router();

// Get user's notifications
router.get(
  '/',
  authenticate as express.RequestHandler,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { unread_only = false, limit = 50 } = req.query;

    try {
      let queryText = `
      SELECT n.*, a.title as auction_title
      FROM notifications n
      LEFT JOIN auctions a ON n.auction_id = a.id
      WHERE n.user_id = $1
    `;
      const params: unknown[] = [req.user?.id];
      const paramIndex = 2;

      if (unread_only === 'true') {
        queryText += ` AND n.is_read = false`;
      }

      queryText += ` ORDER BY n.created_at DESC LIMIT $${paramIndex}`;
      params.push(parseInt(limit as string));

      const result = await query(queryText, params);

      // Get unread count
      const unreadResult = await query(
        'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
        [req.user?.id]
      );

      res.json({
        notifications: result.rows,
        unread_count: parseInt(unreadResult.rows[0].count),
      });
    } catch (error) {
      console.error('Error fetching notifications:', error);
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  }
);

// Mark notification as read
router.put(
  '/:id/read',
  authenticate as express.RequestHandler,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;

    try {
      const result = await query(
        'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING *',
        [id, req.user?.id]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Notification not found' });
        return;
      }

      res.json({ notification: result.rows[0] });
    } catch (error) {
      console.error('Error marking notification as read:', error);
      res.status(500).json({ error: 'Failed to update notification' });
    }
  }
);

// Mark all notifications as read
router.put(
  '/read-all',
  authenticate as express.RequestHandler,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      await query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false', [
        req.user?.id,
      ]);

      res.json({ message: 'All notifications marked as read' });
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      res.status(500).json({ error: 'Failed to update notifications' });
    }
  }
);

// Delete a notification
router.delete(
  '/:id',
  authenticate as express.RequestHandler,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;

    try {
      await query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [id, req.user?.id]);
      res.json({ message: 'Notification deleted' });
    } catch (error) {
      console.error('Error deleting notification:', error);
      res.status(500).json({ error: 'Failed to delete notification' });
    }
  }
);

export default router;
