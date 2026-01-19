import { Router, Request, Response } from 'express';
import { notificationService } from '../services/notifications.js';
import { deliveryTracker } from '../services/delivery.js';
import { rateLimiter } from '../services/rateLimiter.js';

const router: Router = Router();

interface SendNotificationRequest {
  userId?: string;
  templateId?: string;
  data?: Record<string, unknown>;
  channels?: string[];
  priority?: 'critical' | 'high' | 'normal' | 'low';
  scheduledAt?: string;
  deduplicationWindow?: number;
}

interface TrackEventRequest {
  eventType: string;
  channel?: string;
  metadata?: Record<string, unknown>;
}

// Send a notification
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as SendNotificationRequest;
    const result = await notificationService.sendNotification({
      userId: body.userId || req.user!.id,
      templateId: body.templateId,
      data: body.data,
      channels: body.channels,
      priority: body.priority,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      deduplicationWindow: body.deduplicationWindow,
    });

    res.status(result.notificationId ? 201 : 200).json(result);
  } catch (error) {
    console.error('Send notification error:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

// Get user's notifications
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const notifications = await notificationService.getUserNotifications(
      req.user!.id,
      {
        limit: parseInt(req.query.limit as string) || 50,
        offset: parseInt(req.query.offset as string) || 0,
        status: req.query.status as string | undefined,
      }
    );

    res.json({ notifications });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

// Get notification by ID
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const notification = await notificationService.getNotificationById(req.params.id);

    if (!notification) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }

    // Check ownership unless admin
    if (notification.user_id !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.json(notification);
  } catch (error) {
    console.error('Get notification error:', error);
    res.status(500).json({ error: 'Failed to get notification' });
  }
});

// Cancel a notification
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const cancelled = await notificationService.cancelNotification(
      req.params.id,
      req.user!.id
    );

    if (!cancelled) {
      res.status(404).json({ error: 'Notification not found or cannot be cancelled' });
      return;
    }

    res.json({ message: 'Notification cancelled' });
  } catch (error) {
    console.error('Cancel notification error:', error);
    res.status(500).json({ error: 'Failed to cancel notification' });
  }
});

// Get rate limit usage
router.get('/rate-limit/usage', async (req: Request, res: Response): Promise<void> => {
  try {
    const usage = await rateLimiter.getUsage(req.user!.id);
    res.json({ usage, limits: rateLimiter.getLimits().user });
  } catch (error) {
    console.error('Get rate limit usage error:', error);
    res.status(500).json({ error: 'Failed to get rate limit usage' });
  }
});

// Track notification event (opened, clicked)
router.post('/:id/events', async (req: Request, res: Response): Promise<void> => {
  try {
    const { eventType, channel, metadata } = req.body as TrackEventRequest;

    if (!['opened', 'clicked', 'dismissed'].includes(eventType)) {
      res.status(400).json({ error: 'Invalid event type' });
      return;
    }

    await deliveryTracker.trackEvent(
      req.params.id,
      channel || 'push',
      eventType,
      metadata || {}
    );

    res.json({ message: 'Event tracked' });
  } catch (error) {
    console.error('Track event error:', error);
    res.status(500).json({ error: 'Failed to track event' });
  }
});

export default router;
