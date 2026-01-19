import { Router, Request, Response } from 'express';
import * as gitService from '../../services/git.js';
import {
  getTreeFromCache,
  setTreeInCache,
  getFileFromCache,
  setFileInCache,
  getCommitsFromCache,
  setCommitsInCache,
} from '../../shared/cache.js';
import { withCircuitBreaker } from '../../shared/circuitBreaker.js';
import { TreeQueryParams, CommitsQueryParams, getRepoId, sendRepoNotFound } from './types.js';

const router = Router();

/**
 * Get repository tree (with caching and circuit breaker)
 */
router.get('/:owner/:repo/tree/:ref(*)', async (req: Request, res: Response): Promise<void> => {
  const { owner, repo, ref } = req.params;
  const { path: treePath = '' } = req.query as TreeQueryParams;

  const repoId = await getRepoId(owner, repo);
  if (!repoId) {
    sendRepoNotFound(res);
    return;
  }

  let tree = await getTreeFromCache(repoId, ref, treePath);

  if (!tree) {
    tree = await withCircuitBreaker('git_tree', () => gitService.getTree(owner, repo, ref, treePath));
    await setTreeInCache(repoId, ref, treePath, tree);
  }

  res.json(tree);
});

/**
 * Get file content (with caching and circuit breaker)
 */
router.get('/:owner/:repo/blob/:ref/:path(*)', async (req: Request, res: Response): Promise<void> => {
  const { owner, repo, ref, path: filePath } = req.params;

  const repoId = await getRepoId(owner, repo);
  if (!repoId) {
    sendRepoNotFound(res);
    return;
  }

  let content = await getFileFromCache(repoId, ref, filePath);

  if (content === null) {
    content = await withCircuitBreaker('git_file', () => gitService.getFileContent(owner, repo, ref, filePath));

    if (content === null) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    await setFileInCache(repoId, ref, filePath, content);
  }

  res.json({ path: filePath, content });
});

/**
 * Get commits (with caching and circuit breaker)
 */
router.get('/:owner/:repo/commits', async (req: Request, res: Response): Promise<void> => {
  const { owner, repo } = req.params;
  const { branch = 'HEAD', page = '1', limit = '30' } = req.query as CommitsQueryParams;

  const repoId = await getRepoId(owner, repo);
  if (!repoId) {
    sendRepoNotFound(res);
    return;
  }

  let commits = await getCommitsFromCache(repoId, branch, parseInt(page));

  if (!commits) {
    const skip = (parseInt(page) - 1) * parseInt(limit);
    commits = await withCircuitBreaker('git_commits', () =>
      gitService.getCommits(owner, repo, {
        branch,
        maxCount: parseInt(limit),
        skip,
      })
    );
    await setCommitsInCache(repoId, branch, parseInt(page), commits);
  }

  res.json(commits);
});

/**
 * Get single commit
 */
router.get('/:owner/:repo/commit/:sha', async (req: Request, res: Response): Promise<void> => {
  const { owner, repo, sha } = req.params;

  const commit = await withCircuitBreaker('git_commit', () => gitService.getCommit(owner, repo, sha));

  if (!commit) {
    res.status(404).json({ error: 'Commit not found' });
    return;
  }

  res.json(commit);
});

export default router;
