import { Response } from 'express';
import { query } from '../../db/index.js';

/**
 * Repository entity representing a Git repository
 */
export interface Repository {
  id: number;
  owner_id: number;
  name: string;
  description: string | null;
  is_private: boolean;
  default_branch: string;
  storage_path: string;
  stars_count: number;
  forks_count: number;
  created_at: Date;
  updated_at: Date;
  owner_name?: string;
  owner_avatar?: string;
  owner_display_name?: string;
}

/**
 * Query parameters for listing repositories
 */
export interface ListQueryParams {
  owner?: string;
  page?: string;
  limit?: string;
  sort?: string;
}

/**
 * Query parameters for tree navigation
 */
export interface TreeQueryParams {
  path?: string;
}

/**
 * Query parameters for commits listing
 */
export interface CommitsQueryParams {
  branch?: string;
  page?: string;
  limit?: string;
}

/**
 * Request body for push webhook
 */
export interface PushBody {
  branch?: string;
  commits?: unknown[];
}

/**
 * Request body for creating a repository
 */
export interface CreateRepoBody {
  name?: string;
  description?: string;
  isPrivate?: boolean;
  initWithReadme?: boolean;
}

/**
 * Request body for updating a repository
 */
export interface UpdateRepoBody {
  description?: string;
  isPrivate?: boolean;
  defaultBranch?: string;
}

/**
 * Helper function to get repository ID from owner and repo name
 * Returns null if repository is not found
 */
export async function getRepoId(owner: string, repo: string): Promise<number | null> {
  const result = await query(
    `SELECT r.id FROM repositories r
     JOIN users u ON r.owner_id = u.id
     WHERE u.username = $1 AND r.name = $2`,
    [owner, repo]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0].id as number;
}

/**
 * Helper function to get full repository data by owner and repo name
 * Returns null if repository is not found
 */
export async function getRepoByOwnerAndName(owner: string, repo: string): Promise<Repository | null> {
  const result = await query(
    `SELECT r.* FROM repositories r
     JOIN users u ON r.owner_id = u.id
     WHERE u.username = $1 AND r.name = $2`,
    [owner, repo]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0] as Repository;
}

/**
 * Helper to send 404 response for repository not found
 */
export function sendRepoNotFound(res: Response): void {
  res.status(404).json({ error: 'Repository not found' });
}

/**
 * Helper to check if user is authorized to modify repository
 */
export function isRepoOwner(repo: Repository, userId: number): boolean {
  return repo.owner_id === userId;
}
