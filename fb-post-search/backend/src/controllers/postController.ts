/**
 * @fileoverview Post management API controller.
 * Handles CRUD operations for posts including create, read, update, delete, and like.
 */

import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import {
  createPost,
  getPostById,
  getPostsByAuthor,
  updatePost,
  deletePost,
  likePost,
  getRecentPosts,
} from '../services/postService.js';
import type { Visibility, PostType } from '../types/index.js';

/**
 * Handles POST /api/v1/posts - Create a new post.
 * Creates a post with the specified content, visibility, and type.
 * @param req - Authenticated request with content, visibility, post_type in body
 * @param res - Response with created post or error
 */
export async function create(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { content, visibility, post_type, media_url } = req.body;

    if (!content || content.trim().length === 0) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }

    const post = await createPost(
      req.userId,
      content,
      visibility as Visibility || 'friends',
      post_type as PostType || 'text',
      media_url
    );

    if (!post) {
      res.status(500).json({ error: 'Failed to create post' });
      return;
    }

    res.status(201).json(post);
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
}

/**
 * Handles GET /api/v1/posts/:id - Get a single post.
 * Returns the post with the specified ID if the user has visibility access.
 * @param req - Request with post ID in params
 * @param res - Response with post data or 404/403 error
 */
export async function getById(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const post = await getPostById(id);

    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    // Check visibility
    if (post.visibility !== 'public' && post.author_id !== req.userId) {
      // For simplicity, just check if it's the author's post
      // In production, would check friendship status
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.json(post);
  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({ error: 'Failed to get post' });
  }
}

/**
 * Handles GET /api/v1/posts/user/:userId - Get posts by user.
 * Returns paginated posts from a specific user, filtered by visibility.
 * @param req - Request with userId in params and optional pagination query
 * @param res - Response with array of visible posts or error
 */
export async function getByUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    const { limit, offset } = req.query;

    const posts = await getPostsByAuthor(
      userId,
      Math.min(parseInt(String(limit) || '20', 10), 100),
      parseInt(String(offset) || '0', 10)
    );

    // Filter based on visibility
    const visiblePosts = posts.filter((post) => {
      if (post.visibility === 'public') return true;
      if (post.author_id === req.userId) return true;
      if (post.visibility === 'friends' && req.userId) {
        // In production, would check friendship status
        return true;
      }
      return false;
    });

    res.json({ posts: visiblePosts });
  } catch (error) {
    console.error('Get user posts error:', error);
    res.status(500).json({ error: 'Failed to get posts' });
  }
}

/**
 * Handles PUT /api/v1/posts/:id - Update a post.
 * Updates the content or visibility of an existing post.
 * Only the post author or admin can update posts.
 * @param req - Authenticated request with post ID in params and updates in body
 * @param res - Response with updated post or error
 */
export async function update(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { id } = req.params;
    const { content, visibility } = req.body;

    // Check ownership
    const existing = await getPostById(id);
    if (!existing) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    if (existing.author_id !== req.userId && req.userRole !== 'admin') {
      res.status(403).json({ error: 'Not authorized to update this post' });
      return;
    }

    const post = await updatePost(id, content, visibility as Visibility);
    res.json(post);
  } catch (error) {
    console.error('Update post error:', error);
    res.status(500).json({ error: 'Failed to update post' });
  }
}

/**
 * Handles DELETE /api/v1/posts/:id - Delete a post.
 * Removes a post and its Elasticsearch index entry.
 * Only the post author or admin can delete posts.
 * @param req - Authenticated request with post ID in params
 * @param res - Response with success status or error
 */
export async function remove(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { id } = req.params;

    // Check ownership
    const existing = await getPostById(id);
    if (!existing) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    if (existing.author_id !== req.userId && req.userRole !== 'admin') {
      res.status(403).json({ error: 'Not authorized to delete this post' });
      return;
    }

    await deletePost(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
}

/**
 * Handles POST /api/v1/posts/:id/like - Like a post.
 * Increments the like count for a post.
 * @param req - Authenticated request with post ID in params
 * @param res - Response with updated post or error
 */
export async function like(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { id } = req.params;
    const post = await likePost(id);

    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    res.json(post);
  } catch (error) {
    console.error('Like post error:', error);
    res.status(500).json({ error: 'Failed to like post' });
  }
}

/**
 * Handles GET /api/v1/posts/feed - Get user's feed.
 * Returns recent posts visible to the authenticated user.
 * @param req - Authenticated request with optional pagination query
 * @param res - Response with array of visible posts or error
 */
export async function getFeed(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { limit, offset } = req.query;

    const posts = await getRecentPosts(
      req.userId,
      Math.min(parseInt(String(limit) || '20', 10), 100),
      parseInt(String(offset) || '0', 10)
    );

    res.json({ posts });
  } catch (error) {
    console.error('Get feed error:', error);
    res.status(500).json({ error: 'Failed to get feed' });
  }
}
