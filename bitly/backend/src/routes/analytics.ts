import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { getUrlAnalytics, getRecentClicks } from '../services/analyticsService.js';

/**
 * Analytics router.
 * Provides endpoints for viewing URL click analytics.
 * All routes require authentication.
 */
const router = Router();

/**
 * GET /:shortCode - Get aggregated analytics for a URL
 * Returns total clicks, daily trends, top referrers, and device breakdown.
 */
router.get(
  '/:shortCode',
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { shortCode } = req.params;

    const analytics = await getUrlAnalytics(shortCode);

    if (!analytics) {
      res.status(404).json({ error: 'URL not found' });
      return;
    }

    res.json(analytics);
  })
);

/**
 * GET /:shortCode/clicks - Get recent individual click events
 * Returns detailed click-level data for analysis.
 * Supports limit parameter for pagination.
 */
router.get(
  '/:shortCode/clicks',
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { shortCode } = req.params;
    const limit = parseInt(req.query.limit as string, 10) || 100;

    const clicks = await getRecentClicks(shortCode, limit);

    res.json({ clicks });
  })
);

export default router;
