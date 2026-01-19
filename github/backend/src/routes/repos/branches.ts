import { Router, Request, Response } from 'express';
import * as gitService from '../../services/git.js';
import { getBranchesFromCache, setBranchesInCache } from '../../shared/cache.js';
import { withCircuitBreaker } from '../../shared/circuitBreaker.js';
import { getRepoId, sendRepoNotFound } from './types.js';

const router = Router();

/**
 * Get branches (with caching)
 */
router.get('/:owner/:repo/branches', async (req: Request, res: Response): Promise<void> => {
  const { owner, repo } = req.params;

  const repoId = await getRepoId(owner, repo);
  if (!repoId) {
    sendRepoNotFound(res);
    return;
  }

  let branches = await getBranchesFromCache(repoId);

  if (!branches) {
    branches = await withCircuitBreaker('git_branches', () => gitService.getBranches(owner, repo));
    await setBranchesInCache(repoId, branches);
  }

  res.json(branches);
});

/**
 * Get tags
 */
router.get('/:owner/:repo/tags', async (req: Request, res: Response): Promise<void> => {
  const { owner, repo } = req.params;
  const tags = await withCircuitBreaker('git_tags', () => gitService.getTags(owner, repo));
  res.json(tags);
});

export default router;
