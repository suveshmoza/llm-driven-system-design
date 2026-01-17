import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { notificationService } from '../services/notificationService.js';

/**
 * Notification routes for managing user notifications.
 * Handles device found alerts, unknown tracker warnings, and system messages.
 * All routes require authentication and are prefixed with /api/notifications.
 */
const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/notifications
 * Get notifications for the authenticated user.
 * Supports optional query params: unreadOnly, limit.
 */
router.get('/', async (req, res) => {
  try {
    const { unreadOnly, limit } = req.query;

    const notifications = await notificationService.getNotifications(
      req.session.userId!,
      {
        unreadOnly: unreadOnly === 'true',
        limit: limit ? parseInt(limit as string) : undefined,
      }
    );

    res.json(notifications);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/notifications/unread-count
 * Get the count of unread notifications for badge display.
 */
router.get('/unread-count', async (req, res) => {
  try {
    const count = await notificationService.getUnreadCount(req.session.userId!);
    res.json({ count });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/notifications/:id/read
 * Mark a single notification as read.
 */
router.post('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;

    const success = await notificationService.markAsRead(id, req.session.userId!);

    if (!success) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/notifications/read-all
 * Mark all notifications as read for the authenticated user.
 */
router.post('/read-all', async (req, res) => {
  try {
    const count = await notificationService.markAllAsRead(req.session.userId!);
    res.json({ message: `${count} notifications marked as read` });
  } catch (error) {
    console.error('Mark all as read error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/notifications/:id
 * Permanently delete a notification.
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const success = await notificationService.deleteNotification(id, req.session.userId!);

    if (!success) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification deleted' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
