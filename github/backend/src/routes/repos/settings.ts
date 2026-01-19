import { Router, Request, Response } from 'express';
import { query } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { invalidateRepoCaches, invalidatePRCaches } from '../../shared/cache.js';
import { pushesTotal } from '../../shared/metrics.js';
import { PushBody, sendRepoNotFound } from './types.js';

const router = Router();

/**
 * Handle push event (webhook endpoint for cache invalidation)
 * This would typically be called by git hooks
 */
router.post('/:owner/:repo/push', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { owner, repo } = req.params;
  const { branch, commits } = req.body as PushBody;

  const repoResult = await query(
    `SELECT r.id, r.owner_id FROM repositories r
     JOIN users u ON r.owner_id = u.id
     WHERE u.username = $1 AND r.name = $2`,
    [owner, repo]
  );

  if (repoResult.rows.length === 0) {
    sendRepoNotFound(res);
    return;
  }

  const repoId = repoResult.rows[0].id as number;

  // Invalidate all repository caches
  await invalidateRepoCaches(repoId);

  // Find open PRs that might be affected
  const openPRs = await query(
    `SELECT id FROM pull_requests
     WHERE repo_id = $1 AND state = 'open'
     AND (head_branch = $2 OR base_branch = $2)`,
    [repoId, branch]
  );

  // Invalidate PR caches
  await invalidatePRCaches((openPRs.rows as { id: number }[]).map(pr => pr.id));

  // Update metrics
  pushesTotal.inc({ status: 'success' });

  req.log?.info({ repoId, branch, commitCount: commits?.length }, 'Push received, caches invalidated');

  res.json({ success: true, invalidatedPRs: openPRs.rows.length });
});

export default router;
