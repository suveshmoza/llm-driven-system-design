import redisClient from '../db/redis.js';
import logger, { logCacheOperation } from './logger.js';
import { cacheHits, cacheMisses, cacheOperations } from './metrics.js';

/**
 * Redis caching layer for repository metadata and file trees
 *
 * Implements cache-aside pattern:
 * 1. Try to read from cache
 * 2. On cache miss, read from database/git
 * 3. Store result in cache for future requests
 *
 * Cache keys:
 * - repo:{repoId} - Repository metadata
 * - repo:{repoId}:tree:{ref}:{path} - File tree at specific ref and path
 * - repo:{repoId}:file:{ref}:{path} - File content at specific ref and path
 * - pr:{prId}:diff - Pull request diff
 */

// Cache TTLs in seconds
export const CACHE_TTL = {
  REPO_METADATA: 300,      // 5 minutes
  FILE_TREE: 600,          // 10 minutes
  FILE_CONTENT: 3600,      // 1 hour (blobs are immutable by SHA)
  PR_DIFF: 600,            // 10 minutes
  BRANCHES: 60,            // 1 minute (changes frequently)
  COMMITS: 300,            // 5 minutes
};

/**
 * Get value from cache with metrics tracking
 */
async function getFromCache<T>(key: string, cacheType: string): Promise<T | null> {
  const startTime = Date.now();
  try {
    const value = await redisClient.get(key);
    const duration = (Date.now() - startTime) / 1000;
    cacheOperations.observe({ operation: 'get' }, duration);

    if (value) {
      cacheHits.inc({ cache_type: cacheType });
      logCacheOperation('get', key, true);
      return JSON.parse(value) as T;
    } else {
      cacheMisses.inc({ cache_type: cacheType });
      logCacheOperation('get', key, false);
      return null;
    }
  } catch (err) {
    logger.error({ err, key }, 'Cache get error');
    return null;
  }
}

/**
 * Set value in cache with metrics tracking
 */
async function setInCache<T>(key: string, value: T, ttl: number): Promise<boolean> {
  const startTime = Date.now();
  try {
    await redisClient.setEx(key, ttl, JSON.stringify(value));
    const duration = (Date.now() - startTime) / 1000;
    cacheOperations.observe({ operation: 'set' }, duration);
    logCacheOperation('set', key);
    return true;
  } catch (err) {
    logger.error({ err, key }, 'Cache set error');
    return false;
  }
}

/**
 * Delete value from cache
 */
async function deleteFromCache(key: string): Promise<boolean> {
  const startTime = Date.now();
  try {
    await redisClient.del(key);
    const duration = (Date.now() - startTime) / 1000;
    cacheOperations.observe({ operation: 'delete' }, duration);
    logCacheOperation('delete', key);
    return true;
  } catch (err) {
    logger.error({ err, key }, 'Cache delete error');
    return false;
  }
}

/**
 * Delete keys matching a pattern using SCAN (safe for production)
 */
async function deletePattern(pattern: string): Promise<number> {
  try {
    let cursor = 0;
    let deletedCount = 0;

    do {
      const result = await redisClient.scan(cursor, {
        MATCH: pattern,
        COUNT: 100,
      });
      cursor = result.cursor;
      const keys = result.keys;

      if (keys.length > 0) {
        await redisClient.del(keys);
        deletedCount += keys.length;
      }
    } while (cursor !== 0);

    logger.info({ pattern, deletedCount }, 'Deleted cache keys by pattern');
    return deletedCount;
  } catch (err) {
    logger.error({ err, pattern }, 'Cache pattern delete error');
    return 0;
  }
}

// Repository Metadata Cache
export async function getRepoFromCache(repoId: number): Promise<object | null> {
  return getFromCache<object>(`repo:${repoId}`, 'repo_metadata');
}

export async function setRepoInCache(repoId: number, data: object): Promise<boolean> {
  return setInCache(`repo:${repoId}`, data, CACHE_TTL.REPO_METADATA);
}

export async function invalidateRepoCache(repoId: number): Promise<boolean> {
  return deleteFromCache(`repo:${repoId}`);
}

// File Tree Cache
export async function getTreeFromCache(repoId: number, ref: string, path = ''): Promise<object[] | null> {
  const key = `repo:${repoId}:tree:${ref}:${path}`;
  return getFromCache<object[]>(key, 'file_tree');
}

export async function setTreeInCache(repoId: number, ref: string, path: string, data: object[]): Promise<boolean> {
  const key = `repo:${repoId}:tree:${ref}:${path}`;
  return setInCache(key, data, CACHE_TTL.FILE_TREE);
}

// File Content Cache
export async function getFileFromCache(repoId: number, ref: string, path: string): Promise<string | null> {
  const key = `repo:${repoId}:file:${ref}:${path}`;
  return getFromCache<string>(key, 'file_content');
}

export async function setFileInCache(repoId: number, ref: string, path: string, content: string): Promise<boolean> {
  const key = `repo:${repoId}:file:${ref}:${path}`;
  return setInCache(key, content, CACHE_TTL.FILE_CONTENT);
}

// PR Diff Cache
export async function getPRDiffFromCache(prId: number): Promise<object | null> {
  return getFromCache<object>(`pr:${prId}:diff`, 'pr_diff');
}

export async function setPRDiffInCache(prId: number, diff: object): Promise<boolean> {
  return setInCache(`pr:${prId}:diff`, diff, CACHE_TTL.PR_DIFF);
}

export async function invalidatePRDiffCache(prId: number): Promise<boolean> {
  return deleteFromCache(`pr:${prId}:diff`);
}

// Branch Cache
export async function getBranchesFromCache(repoId: number): Promise<Array<{ name: string; current: boolean }> | null> {
  return getFromCache<Array<{ name: string; current: boolean }>>(`repo:${repoId}:branches`, 'branches');
}

export async function setBranchesInCache(repoId: number, branches: Array<{ name: string; current: boolean }>): Promise<boolean> {
  return setInCache(`repo:${repoId}:branches`, branches, CACHE_TTL.BRANCHES);
}

// Commit Cache
export async function getCommitsFromCache(repoId: number, branch: string, page: number | string): Promise<object[] | null> {
  const key = `repo:${repoId}:commits:${branch}:${page}`;
  return getFromCache<object[]>(key, 'commits');
}

export async function setCommitsInCache(repoId: number, branch: string, page: number | string, commits: object[]): Promise<boolean> {
  const key = `repo:${repoId}:commits:${branch}:${page}`;
  return setInCache(key, commits, CACHE_TTL.COMMITS);
}

/**
 * Invalidate all caches for a repository
 * Called on push, merge, or settings change
 */
export async function invalidateRepoCaches(repoId: number): Promise<boolean> {
  logger.info({ repoId }, 'Invalidating all repository caches');

  await Promise.all([
    // Invalidate repo metadata
    deleteFromCache(`repo:${repoId}`),
    // Invalidate branches
    deleteFromCache(`repo:${repoId}:branches`),
    // Invalidate all tree caches for this repo
    deletePattern(`repo:${repoId}:tree:*`),
    // Invalidate all commit caches for this repo
    deletePattern(`repo:${repoId}:commits:*`),
  ]);

  return true;
}

/**
 * Invalidate PR-related caches after push to a branch
 */
export async function invalidatePRCaches(prIds: number[]): Promise<void> {
  if (!prIds || prIds.length === 0) return;

  logger.info({ prIds }, 'Invalidating PR caches');

  await Promise.all(
    prIds.map(prId => deleteFromCache(`pr:${prId}:diff`))
  );
}

export default {
  getRepoFromCache,
  setRepoInCache,
  invalidateRepoCache,
  getTreeFromCache,
  setTreeInCache,
  getFileFromCache,
  setFileInCache,
  getPRDiffFromCache,
  setPRDiffInCache,
  invalidatePRDiffCache,
  getBranchesFromCache,
  setBranchesInCache,
  getCommitsFromCache,
  setCommitsInCache,
  invalidateRepoCaches,
  invalidatePRCaches,
  CACHE_TTL,
};
