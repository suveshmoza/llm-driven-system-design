import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';
import { recordViewEvent, getVideoAnalytics } from '../services/analyticsService.js';

const router = Router();

// POST /api/analytics/view - Track a view event
router.post('/view', async (req: Request, res: Response) => {
  try {
    const { videoId, sessionId, watchDurationSeconds, completed } = req.body;

    if (!videoId || !sessionId) {
      res.status(400).json({ error: 'videoId and sessionId are required' });
      return;
    }

    const viewerId = req.session?.userId || null;
    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || '';
    const userAgent = req.headers['user-agent'] || '';

    await recordViewEvent(
      videoId,
      viewerId,
      sessionId,
      watchDurationSeconds || 0,
      completed || false,
      ipAddress,
      userAgent,
    );

    res.json({ message: 'View recorded' });
  } catch (err) {
    logger.error({ err }, 'Failed to record view');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/videos/:videoId/analytics - Get video analytics
router.get('/:videoId/analytics', requireAuth, async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params;
    const days = parseInt(req.query.days as string) || 30;

    const analytics = await getVideoAnalytics(videoId, days);

    res.json({ analytics });
  } catch (err) {
    logger.error({ err }, 'Failed to get analytics');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
