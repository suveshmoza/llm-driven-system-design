/**
 * Repository Settings Routes
 *
 * @description Handles webhook endpoints for repository events such as push notifications.
 * These endpoints are typically called by Git hooks or external integrations.
 *
 * @module routes/repos/settings
 */
import { Router, Request, Response } from 'express';
import { query } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { invalidateRepoCaches, invalidatePRCaches } from '../../shared/cache.js';
import { pushesTotal } from '../../shared/metrics.js';
import { PushBody, sendRepoNotFound, RepoParams } from './types.js';

const router = Router();

/**
 * POST /:owner/:repo/push - Handle push event webhook
 *
 * @description Receives push event notifications from Git hooks. Invalidates all relevant
 * caches including repository caches and any open pull requests affected by the push.
 * Updates push metrics for monitoring.
 *
 * @route POST /repos/:owner/:repo/push
 * @authentication Required
 *
 * @param req.params.owner - The username of the repository owner
 * @param req.params.repo - The name of the repository
 * @param req.body.branch - The branch that was pushed to
 * @param req.body.commits - Array of commit objects that were pushed
 *
 * @returns {Object} Push handling result
 * @returns {boolean} success - true if push was processed successfully
 * @returns {number} invalidatedPRs - Number of pull requests that had their caches invalidated
 *
 * @throws {401} Authentication required
 * @throws {404} Repository not found
 *
 * @example
 * // POST /repos/octocat/hello-world/push
 * // Body: { branch: 'main', commits: [{...}] }
 * // Response: { success: true, invalidatedPRs: 2 }
 */
router.post('/:owner/:repo/push', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { owner, repo } = req.params as unknown as RepoParams;
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
