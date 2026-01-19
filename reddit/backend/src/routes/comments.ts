import express from 'express';
import type { Response } from 'express';
import { createComment, findCommentById, getCommentSubtree } from '../models/comment.js';
import { findPostById } from '../models/post.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../shared/logger.js';

interface CreateCommentBody {
  content: string;
  parentId?: number;
}

const router = express.Router();

// Create comment on post
router.post('/posts/:postId/comments', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const postId = parseInt(req.params.postId, 10);
    if (isNaN(postId)) {
      res.status(400).json({ error: 'Invalid post ID' });
      return;
    }

    const { content, parentId } = req.body as CreateCommentBody;

    if (!content || !content.trim()) {
      res.status(400).json({ error: 'Comment content is required' });
      return;
    }

    const post = await findPostById(postId);
    if (!post) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    // Validate parent comment if provided
    if (parentId) {
      const parentComment = await findCommentById(parentId);
      if (!parentComment || parentComment.post_id !== postId) {
        res.status(400).json({ error: 'Invalid parent comment' });
        return;
      }
    }

    const comment = await createComment(postId, req.user!.id, content.trim(), parentId || null);

    res.status(201).json({
      ...comment,
      author_username: req.user!.username,
      replies: [],
    });
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get comment and its subtree
router.get('/comments/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const commentId = parseInt(req.params.id, 10);
    if (isNaN(commentId)) {
      res.status(400).json({ error: 'Invalid comment ID' });
      return;
    }

    const tree = await getCommentSubtree(commentId);
    if (!tree) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }

    res.json(tree);
  } catch (error) {
    console.error('Get comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
