import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  requestApproval,
  reviewApproval,
  getPageApprovals,
  getPendingApprovals,
} from '../services/approvalService.js';
import { logger } from '../services/logger.js';

const router = Router();

// Get pending approvals
router.get('/pending', requireAuth, async (req: Request, res: Response) => {
  try {
    const approvals = await getPendingApprovals();
    res.json({ approvals });
  } catch (err) {
    logger.error({ err }, 'Failed to get pending approvals');
    res.status(500).json({ error: 'Failed to get pending approvals' });
  }
});

// Get approvals for a page
router.get('/page/:pageId', async (req: Request, res: Response) => {
  try {
    const approvals = await getPageApprovals(req.params.pageId);
    res.json({ approvals });
  } catch (err) {
    logger.error({ err }, 'Failed to get page approvals');
    res.status(500).json({ error: 'Failed to get page approvals' });
  }
});

// Request approval
router.post('/request', requireAuth, async (req: Request, res: Response) => {
  try {
    const { pageId } = req.body;

    if (!pageId) {
      res.status(400).json({ error: 'Page ID is required' });
      return;
    }

    const approval = await requestApproval(pageId, req.session.userId!);
    res.status(201).json({ approval });
  } catch (err) {
    logger.error({ err }, 'Failed to request approval');
    const message = err instanceof Error ? err.message : 'Failed to request approval';
    res.status(400).json({ error: message });
  }
});

// Review approval (approve/reject)
router.post('/:id/review', requireAuth, async (req: Request, res: Response) => {
  try {
    const { status, comment } = req.body;

    if (!status || !['approved', 'rejected'].includes(status)) {
      res.status(400).json({ error: 'Status must be "approved" or "rejected"' });
      return;
    }

    const approval = await reviewApproval(
      req.params.id,
      req.session.userId!,
      status,
      comment,
    );

    res.json({ approval });
  } catch (err) {
    logger.error({ err }, 'Failed to review approval');
    const message = err instanceof Error ? err.message : 'Failed to review approval';
    res.status(400).json({ error: message });
  }
});

export default router;
