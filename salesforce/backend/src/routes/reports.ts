import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { reportLimiter } from '../services/rateLimiter.js';
import { getPipelineReport, getRevenueReport, getLeadsBySourceReport } from '../services/reportService.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/reports/pipeline
router.get('/pipeline', requireAuth, reportLimiter, async (req: Request, res: Response) => {
  try {
    const { all } = req.query;
    const userId = all === 'true' ? undefined : req.session.userId;
    const pipeline = await getPipelineReport(userId);
    res.json({ pipeline });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch pipeline report');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/revenue
router.get('/revenue', requireAuth, reportLimiter, async (req: Request, res: Response) => {
  try {
    const { months = '12', all } = req.query;
    const userId = all === 'true' ? undefined : req.session.userId;
    const revenue = await getRevenueReport(userId, parseInt(months as string));
    res.json({ revenue });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch revenue report');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/leads
router.get('/leads', requireAuth, reportLimiter, async (req: Request, res: Response) => {
  try {
    const { all } = req.query;
    const userId = all === 'true' ? undefined : req.session.userId;
    const leads = await getLeadsBySourceReport(userId);
    res.json({ leads });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch leads report');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
