import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getVersionHistory, computeDiff, restoreVersion } from '../services/versionService.js';
import { logger } from '../services/logger.js';

const router = Router();

// Get version history for a page
router.get('/:pageId', async (req: Request, res: Response) => {
  try {
    const versions = await getVersionHistory(req.params.pageId);
    res.json({ versions });
  } catch (err) {
    logger.error({ err }, 'Failed to get version history');
    res.status(500).json({ error: 'Failed to get version history' });
  }
});

// Get diff between two versions
router.get('/:pageId/diff', async (req: Request, res: Response) => {
  try {
    const fromVersion = parseInt(req.query.from as string);
    const toVersion = parseInt(req.query.to as string);

    if (isNaN(fromVersion) || isNaN(toVersion)) {
      res.status(400).json({ error: 'from and to version numbers are required' });
      return;
    }

    const diff = await computeDiff(req.params.pageId, fromVersion, toVersion);
    res.json({ diff });
  } catch (err) {
    logger.error({ err }, 'Failed to compute diff');
    res.status(500).json({ error: 'Failed to compute diff' });
  }
});

// Restore a version
router.post('/:pageId/restore', requireAuth, async (req: Request, res: Response) => {
  try {
    const { versionNumber } = req.body;

    if (!versionNumber) {
      res.status(400).json({ error: 'Version number is required' });
      return;
    }

    await restoreVersion(req.params.pageId, versionNumber, req.session.userId!);
    res.json({ message: 'Version restored' });
  } catch (err) {
    logger.error({ err }, 'Failed to restore version');
    res.status(500).json({ error: 'Failed to restore version' });
  }
});

/** Router for page version history, diff computation, and version restoration. */
export default router;
