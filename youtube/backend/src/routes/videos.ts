import express, { Router, Request, Response } from 'express';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import {
  getVideo,
  getVideos,
  updateVideo,
  deleteVideo,
  reactToVideo,
  getUserReaction,
  addComment,
  getComments,
  deleteComment,
  likeComment,
} from '../services/metadata/index.js';
import {
  getStreamingInfo,
  recordView,
  updateWatchProgress,
  getWatchProgress,
} from '../services/streaming.js';

// Extend Express Request to include user
interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    username: string;
    email: string;
    channelName: string;
    role: string;
    avatarUrl?: string;
  };
}

interface OptionalAuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    email: string;
    channelName: string;
    role: string;
    avatarUrl?: string;
  };
}

const router: Router = express.Router();

// Get videos (with optional filters)
router.get('/', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { page, limit, channelId, search, category, orderBy, order } = req.query as {
      page?: string;
      limit?: string;
      channelId?: string;
      search?: string;
      category?: string;
      orderBy?: string;
      order?: string;
    };

    const result = await getVideos({
      page: parseInt(page || '1', 10),
      limit: Math.min(parseInt(limit || '20', 10), 50),
      channelId,
      search,
      category,
      orderBy,
      order,
    });

    res.json(result);
  } catch (error) {
    console.error('Get videos error:', error);
    res.status(500).json({ error: 'Failed to get videos' });
  }
});

// Get video by ID
router.get('/:videoId', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const optReq = req as OptionalAuthRequest;
    const videoId = req.params.videoId;
    if (!videoId) {
      res.status(400).json({ error: 'Video ID is required' });
      return;
    }
    const video = await getVideo(videoId);

    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    // Get user's reaction if logged in
    let userReaction: string | null = null;
    let watchProgress: { position: number; percentage: number } | null = null;

    if (optReq.user) {
      userReaction = await getUserReaction(optReq.user.id, videoId);
      watchProgress = await getWatchProgress(optReq.user.id, videoId);
    }

    res.json({
      ...video,
      userReaction,
      watchProgress,
    });
  } catch (error) {
    console.error('Get video error:', error);
    res.status(500).json({ error: 'Failed to get video' });
  }
});

// Get streaming info for video
router.get('/:videoId/stream', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const videoId = req.params.videoId;
    if (!videoId) {
      res.status(400).json({ error: 'Video ID is required' });
      return;
    }
    const streamingInfo = await getStreamingInfo(videoId);

    if (!streamingInfo) {
      res.status(404).json({ error: 'Video not found or not ready' });
      return;
    }

    res.json(streamingInfo);
  } catch (error) {
    console.error('Get streaming info error:', error);
    res.status(500).json({ error: 'Failed to get streaming info' });
  }
});

// Record video view
router.post('/:videoId/view', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const optReq = req as OptionalAuthRequest;
    const videoId = req.params.videoId;
    if (!videoId) {
      res.status(400).json({ error: 'Video ID is required' });
      return;
    }
    const { watchDuration, watchPercentage } = req.body as {
      watchDuration?: string | number;
      watchPercentage?: string | number;
    };

    await recordView(
      videoId,
      optReq.user?.id || null,
      parseInt(String(watchDuration || 0), 10),
      parseFloat(String(watchPercentage || 0))
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Record view error:', error);
    res.status(500).json({ error: 'Failed to record view' });
  }
});

// Update watch progress
router.post('/:videoId/progress', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const videoId = req.params.videoId;
    if (!videoId) {
      res.status(400).json({ error: 'Video ID is required' });
      return;
    }
    const { position, duration } = req.body as {
      position?: string | number;
      duration?: string | number;
    };

    await updateWatchProgress(
      authReq.user.id,
      videoId,
      parseInt(String(position || 0), 10),
      parseInt(String(duration || 0), 10)
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Update progress error:', error);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

// Update video
router.patch('/:videoId', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const videoId = req.params.videoId;
    if (!videoId) {
      res.status(400).json({ error: 'Video ID is required' });
      return;
    }
    const { title, description, categories, tags, visibility } = req.body as {
      title?: string;
      description?: string;
      categories?: string[];
      tags?: string[];
      visibility?: string;
    };

    const video = await updateVideo(videoId, authReq.user.id, {
      title,
      description,
      categories,
      tags,
      visibility,
    });

    if (!video) {
      res.status(404).json({ error: 'Video not found or unauthorized' });
      return;
    }

    res.json(video);
  } catch (error) {
    console.error('Update video error:', error);
    res.status(500).json({ error: 'Failed to update video' });
  }
});

// Delete video
router.delete('/:videoId', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const videoId = req.params.videoId;
    if (!videoId) {
      res.status(400).json({ error: 'Video ID is required' });
      return;
    }
    const success = await deleteVideo(videoId, authReq.user.id);

    if (!success) {
      res.status(404).json({ error: 'Video not found or unauthorized' });
      return;
    }

    res.json({ message: 'Video deleted' });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// Like/dislike video
router.post('/:videoId/react', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const videoId = req.params.videoId;
    if (!videoId) {
      res.status(400).json({ error: 'Video ID is required' });
      return;
    }
    const { reaction } = req.body as { reaction?: string };

    if (!reaction || !['like', 'dislike'].includes(reaction)) {
      res.status(400).json({ error: 'Invalid reaction type' });
      return;
    }

    const result = await reactToVideo(authReq.user.id, videoId, reaction as 'like' | 'dislike');
    res.json(result);
  } catch (error) {
    console.error('React to video error:', error);
    res.status(500).json({ error: 'Failed to react to video' });
  }
});

// Get comments
router.get('/:videoId/comments', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const videoId = req.params.videoId;
    if (!videoId) {
      res.status(400).json({ error: 'Video ID is required' });
      return;
    }
    const { page, limit, parentId } = req.query as {
      page?: string;
      limit?: string;
      parentId?: string;
    };

    const result = await getComments(
      videoId,
      parseInt(page || '1', 10),
      Math.min(parseInt(limit || '20', 10), 50),
      parentId || null
    );

    res.json(result);
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Failed to get comments' });
  }
});

// Add comment
router.post('/:videoId/comments', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const videoId = req.params.videoId;
    if (!videoId) {
      res.status(400).json({ error: 'Video ID is required' });
      return;
    }
    const { text, parentId } = req.body as { text?: string; parentId?: string };

    if (!text || text.trim().length === 0) {
      res.status(400).json({ error: 'Comment text is required' });
      return;
    }

    const comment = await addComment(authReq.user.id, videoId, text.trim(), parentId || null);
    res.status(201).json(comment);
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// Delete comment
router.delete(
  '/:videoId/comments/:commentId',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const commentId = req.params.commentId;
      if (!commentId) {
        res.status(400).json({ error: 'Comment ID is required' });
        return;
      }
      const success = await deleteComment(commentId, authReq.user.id);

      if (!success) {
        res.status(404).json({ error: 'Comment not found or unauthorized' });
        return;
      }

      res.json({ message: 'Comment deleted' });
    } catch (error) {
      console.error('Delete comment error:', error);
      res.status(500).json({ error: 'Failed to delete comment' });
    }
  }
);

// Like comment
router.post(
  '/:videoId/comments/:commentId/like',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const commentId = req.params.commentId;
      if (!commentId) {
        res.status(400).json({ error: 'Comment ID is required' });
        return;
      }
      const result = await likeComment(authReq.user.id, commentId);
      res.json(result);
    } catch (error) {
      console.error('Like comment error:', error);
      res.status(500).json({ error: 'Failed to like comment' });
    }
  }
);

export default router;
