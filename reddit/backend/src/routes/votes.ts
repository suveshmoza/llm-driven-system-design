import express from 'express';
import type { Response } from 'express';
import { castVote, getUserVote, type VoteTargetType, type VoteDirection } from '../models/vote.js';
import { findPostById } from '../models/post.js';
import { findCommentById } from '../models/comment.js';
import { requireAuth } from '../middleware/auth.js';
import logger from '../shared/logger.js';
import type { AuthenticatedRequest } from '../shared/logger.js';

interface CastVoteBody {
  type: VoteTargetType;
  id: number | string;
  direction: VoteDirection;
}

const router = express.Router();

// Cast a vote
router.post('/', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { type, id, direction } = req.body as CastVoteBody;

    // Validate type
    if (type !== 'post' && type !== 'comment') {
      res.status(400).json({ error: 'Type must be "post" or "comment"' });
      return;
    }

    // Validate ID
    const targetId = typeof id === 'string' ? parseInt(id, 10) : id;
    if (isNaN(targetId)) {
      res.status(400).json({ error: 'Invalid ID' });
      return;
    }

    // Validate direction
    if (direction !== 1 && direction !== -1 && direction !== 0) {
      res.status(400).json({ error: 'Direction must be 1, -1, or 0' });
      return;
    }

    // Verify target exists
    if (type === 'post') {
      const post = await findPostById(targetId);
      if (!post) {
        res.status(404).json({ error: 'Post not found' });
        return;
      }
    } else {
      const comment = await findCommentById(targetId);
      if (!comment) {
        res.status(404).json({ error: 'Comment not found' });
        return;
      }
    }

    await castVote(req.user!.id, type, targetId, direction);

    // Return updated vote status
    const currentVote = await getUserVote(req.user!.id, type, targetId);

    // Get updated score
    let score: number;
    if (type === 'post') {
      const post = await findPostById(targetId);
      score = post?.score ?? 0;
    } else {
      const comment = await findCommentById(targetId);
      score = comment?.score ?? 0;
    }

    res.json({ success: true, direction: currentVote, score });
  } catch (error) {
    logger.error({ err: error, userId: req.user?.id }, 'Vote error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's vote on a target
router.get('/:type/:id', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { type, id } = req.params;

    if (type !== 'post' && type !== 'comment') {
      res.status(400).json({ error: 'Type must be "post" or "comment"' });
      return;
    }

    const targetId = parseInt(id, 10);
    if (isNaN(targetId)) {
      res.status(400).json({ error: 'Invalid ID' });
      return;
    }

    const direction = await getUserVote(req.user!.id, type as VoteTargetType, targetId);
    res.json({ direction });
  } catch (error) {
    logger.error({ err: error, userId: req.user?.id }, 'Get vote error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
