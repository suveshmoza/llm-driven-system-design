import express, { Request, Response, Router } from 'express';
import { getSuggestions, recordAppLaunch, recordActivity } from '../services/suggestions.js';
import { suggestionsRateLimiter } from '../shared/rateLimiter.js';
import { suggestionsLogger } from '../shared/logger.js';

const router: Router = express.Router();

// Apply rate limiting to suggestions routes
router.use(suggestionsRateLimiter);

// Extend Express Request to include requestId
interface SuggestionsRequest extends Request {
  requestId?: string;
}

interface AppLaunchRequestBody {
  bundleId: string;
}

interface ActivityRequestBody {
  type: string;
  itemId: string;
  itemName: string;
  metadata?: Record<string, unknown>;
}

// Get suggestions based on context
router.get('/', async (req: SuggestionsRequest, res: Response): Promise<void> => {
  const requestId = req.requestId;

  try {
    const { hour, day } = req.query as { hour?: string; day?: string };

    const suggestions = await getSuggestions({
      hour: hour ? parseInt(hour) : undefined,
      dayOfWeek: day ? parseInt(day) : undefined
    });

    suggestionsLogger.info({
      requestId,
      suggestionCount: suggestions.length,
      hour,
      dayOfWeek: day
    }, 'Suggestions retrieved');

    res.json({ suggestions });
  } catch (error) {
    const err = error as Error;
    suggestionsLogger.error({
      error: err.message,
      requestId
    }, 'Suggestions error');
    res.status(500).json({ error: 'Failed to get suggestions' });
  }
});

// Record app launch for pattern learning
router.post('/app-launch', async (req: SuggestionsRequest, res: Response): Promise<void> => {
  const requestId = req.requestId;

  try {
    const { bundleId } = req.body as AppLaunchRequestBody;

    if (!bundleId) {
      res.status(400).json({ error: 'Bundle ID is required' });
      return;
    }

    await recordAppLaunch(bundleId);

    suggestionsLogger.info({
      requestId,
      bundleId
    }, 'App launch recorded');

    res.json({ success: true });
  } catch (error) {
    const err = error as Error;
    suggestionsLogger.error({
      error: err.message,
      requestId
    }, 'Record app launch error');
    res.status(500).json({ error: 'Failed to record app launch' });
  }
});

// Record activity
router.post('/activity', async (req: SuggestionsRequest, res: Response): Promise<void> => {
  const requestId = req.requestId;

  try {
    const { type, itemId, itemName, metadata } = req.body as ActivityRequestBody;

    if (!type || !itemId || !itemName) {
      res.status(400).json({ error: 'Type, itemId, and itemName are required' });
      return;
    }

    await recordActivity(type, itemId, itemName, metadata);

    suggestionsLogger.info({
      requestId,
      type,
      itemId,
      itemName
    }, 'Activity recorded');

    res.json({ success: true });
  } catch (error) {
    const err = error as Error;
    suggestionsLogger.error({
      error: err.message,
      requestId
    }, 'Record activity error');
    res.status(500).json({ error: 'Failed to record activity' });
  }
});

export default router;
