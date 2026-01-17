/**
 * Queue routes for virtual waiting room functionality.
 * Manages user access during high-demand event sales.
 * Endpoints:
 * - POST /:eventId/join - Join the waiting room queue
 * - GET /:eventId/status - Check queue position
 * - POST /:eventId/leave - Leave the queue
 * - GET /:eventId/stats - Get queue statistics (public)
 */
import { Router, Response } from 'express';
import { waitingRoomService } from '../services/waiting-room.service.js';
import { eventService } from '../services/event.service.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.middleware.js';

/** Express router for queue endpoints */
const router = Router();

/**
 * POST /:eventId/join
 * Joins the virtual waiting room queue for a high-demand event.
 * If the event doesn't have waiting room enabled, returns active status immediately.
 */
router.post('/:eventId/join', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const eventId = req.params.eventId;

    // Check if event exists and has waiting room enabled
    const event = await eventService.getEventById(eventId);
    if (!event) {
      res.status(404).json({ success: false, error: 'Event not found' });
      return;
    }

    if (!event.waiting_room_enabled) {
      // No waiting room needed, automatically active
      res.json({
        success: true,
        data: {
          position: 0,
          status: 'active',
          estimated_wait_seconds: 0,
        },
      });
      return;
    }

    const status = await waitingRoomService.joinQueue(eventId, req.sessionId!);

    res.json({ success: true, data: status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to join queue';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /:eventId/status
 * Returns the user's current position and status in the queue.
 * Status can be: waiting, active, or not_in_queue.
 */
router.get('/:eventId/status', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const eventId = req.params.eventId;

    // Check if event exists and has waiting room enabled
    const event = await eventService.getEventById(eventId);
    if (!event) {
      res.status(404).json({ success: false, error: 'Event not found' });
      return;
    }

    if (!event.waiting_room_enabled) {
      res.json({
        success: true,
        data: {
          position: 0,
          status: 'active',
          estimated_wait_seconds: 0,
        },
      });
      return;
    }

    const status = await waitingRoomService.getQueueStatus(eventId, req.sessionId!);

    res.json({ success: true, data: status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get queue status';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /:eventId/leave
 * Removes the user from the queue and/or active set.
 * Called when user navigates away or explicitly leaves.
 */
router.post('/:eventId/leave', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await waitingRoomService.leaveQueue(req.params.eventId, req.sessionId!);
    res.json({ success: true, data: { message: 'Left queue' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to leave queue';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /:eventId/stats
 * Returns public queue statistics (queue length, active count, estimated wait).
 * Does not require authentication.
 */
router.get('/:eventId/stats', async (req, res: Response) => {
  try {
    const stats = await waitingRoomService.getQueueStats(req.params.eventId);
    res.json({ success: true, data: stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get queue stats';
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
