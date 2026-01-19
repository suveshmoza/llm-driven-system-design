import express, { Request, Response, Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { healthQueryService } from '../services/healthQueryService.js';
import { insightsService } from '../services/insightsService.js';

const router: Router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// Get health data types
router.get('/types', async (req: Request, res: Response): Promise<void> => {
  try {
    const types = await healthQueryService.getHealthDataTypes();
    res.json({ types });
  } catch (error) {
    console.error('Get types error:', error);
    res.status(500).json({ error: 'Failed to get health data types' });
  }
});

// Get raw samples
router.get('/samples', async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, startDate, endDate, limit, offset } = req.query as {
      type?: string;
      startDate?: string;
      endDate?: string;
      limit?: string;
      offset?: string;
    };

    const samples = await healthQueryService.getSamples(req.user!.id, {
      type,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined
    });

    res.json({ samples });
  } catch (error) {
    console.error('Get samples error:', error);
    res.status(500).json({ error: 'Failed to get samples' });
  }
});

// Get aggregated data
router.get('/aggregates', async (req: Request, res: Response): Promise<void> => {
  try {
    const { types, period, startDate, endDate } = req.query as {
      types?: string | string[];
      period?: string;
      startDate?: string;
      endDate?: string;
    };

    if (!types || !startDate || !endDate) {
      res.status(400).json({
        error: 'types, startDate, and endDate are required'
      });
      return;
    }

    const typeArray = Array.isArray(types) ? types : (types as string).split(',');

    const aggregates = await healthQueryService.getAggregates(req.user!.id, {
      types: typeArray,
      period: period || 'day',
      startDate: new Date(startDate),
      endDate: new Date(endDate)
    });

    res.json({ aggregates });
  } catch (error) {
    console.error('Get aggregates error:', error);
    res.status(500).json({ error: 'Failed to get aggregates' });
  }
});

// Get daily summary
router.get('/summary/daily', async (req: Request, res: Response): Promise<void> => {
  try {
    const { date } = req.query as { date?: string };
    const targetDate = date ? new Date(date) : new Date();

    const summary = await healthQueryService.getDailySummary(req.user!.id, targetDate);
    res.json({ summary, date: targetDate });
  } catch (error) {
    console.error('Get daily summary error:', error);
    res.status(500).json({ error: 'Failed to get daily summary' });
  }
});

// Get weekly summary
router.get('/summary/weekly', async (req: Request, res: Response): Promise<void> => {
  try {
    const summary = await healthQueryService.getWeeklySummary(req.user!.id);
    res.json({ summary });
  } catch (error) {
    console.error('Get weekly summary error:', error);
    res.status(500).json({ error: 'Failed to get weekly summary' });
  }
});

// Get latest metrics
router.get('/latest', async (req: Request, res: Response): Promise<void> => {
  try {
    const latest = await healthQueryService.getLatestMetrics(req.user!.id);
    res.json({ metrics: latest });
  } catch (error) {
    console.error('Get latest metrics error:', error);
    res.status(500).json({ error: 'Failed to get latest metrics' });
  }
});

// Get historical data for a specific metric
router.get('/history/:type', async (req: Request, res: Response): Promise<void> => {
  try {
    const { type } = req.params;
    const { days } = req.query as { days?: string };

    const history = await healthQueryService.getHistoricalData(
      req.user!.id,
      type,
      days ? parseInt(days) : 30
    );

    res.json({ type, history });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

// Get insights
router.get('/insights', async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit, unreadOnly } = req.query as { limit?: string; unreadOnly?: string };

    const insights = await insightsService.getUserInsights(req.user!.id, {
      limit: limit ? parseInt(limit) : 10,
      unreadOnly: unreadOnly === 'true'
    });

    res.json({ insights });
  } catch (error) {
    console.error('Get insights error:', error);
    res.status(500).json({ error: 'Failed to get insights' });
  }
});

// Generate new insights
router.post('/insights/analyze', async (req: Request, res: Response): Promise<void> => {
  try {
    const insights = await insightsService.analyzeUser(req.user!.id);
    res.json({ insights, message: 'Analysis complete' });
  } catch (error) {
    console.error('Analyze error:', error);
    res.status(500).json({ error: 'Failed to analyze health data' });
  }
});

// Acknowledge an insight
router.post('/insights/:insightId/acknowledge', async (req: Request, res: Response): Promise<void> => {
  try {
    const { insightId } = req.params;
    await insightsService.acknowledgeInsight(req.user!.id, insightId);
    res.json({ message: 'Insight acknowledged' });
  } catch (error) {
    console.error('Acknowledge error:', error);
    res.status(500).json({ error: 'Failed to acknowledge insight' });
  }
});

export default router;
