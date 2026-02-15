import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getDashboardKPIs } from '../services/dashboardService.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/dashboard
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const kpis = await getDashboardKPIs(req.session.userId!);
    res.json({ kpis });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch dashboard');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
