import express, { Router, Request, Response } from 'express';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import {
  getRecommendations,
  getTrending,
  searchVideos,
  getSubscriptionFeed,
  getWatchHistory,
} from '../services/recommendations.js';

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

// Get personalized recommendations (home feed)
router.get('/recommendations', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const optReq = req as OptionalAuthRequest;
    const { limit } = req.query as { limit?: string };

    const recommendations = await getRecommendations(
      optReq.user?.id,
      Math.min(parseInt(limit || '20', 10), 50)
    );

    res.json({ videos: recommendations });
  } catch (error) {
    console.error('Get recommendations error:', error);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

// Get trending videos
router.get('/trending', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit, category } = req.query as { limit?: string; category?: string };

    const trending = await getTrending(
      Math.min(parseInt(limit || '50', 10), 100),
      category || null
    );

    res.json({ videos: trending });
  } catch (error) {
    console.error('Get trending error:', error);
    res.status(500).json({ error: 'Failed to get trending videos' });
  }
});

// Search videos
router.get('/search', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { q, page, limit, sortBy } = req.query as {
      q?: string;
      page?: string;
      limit?: string;
      sortBy?: string;
    };

    if (!q || q.trim().length === 0) {
      res.status(400).json({ error: 'Search query is required' });
      return;
    }

    const result = await searchVideos(q.trim(), {
      page: parseInt(page || '1', 10),
      limit: Math.min(parseInt(limit || '20', 10), 50),
      sortBy: sortBy as 'relevance' | 'date' | 'views' | 'rating' | undefined,
    });

    res.json(result);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to search videos' });
  }
});

// Get subscription feed
router.get('/subscriptions', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { page, limit } = req.query as { page?: string; limit?: string };

    const result = await getSubscriptionFeed(
      authReq.user.id,
      parseInt(page || '1', 10),
      Math.min(parseInt(limit || '20', 10), 50)
    );

    res.json(result);
  } catch (error) {
    console.error('Get subscription feed error:', error);
    res.status(500).json({ error: 'Failed to get subscription feed' });
  }
});

// Get watch history
router.get('/history', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { page, limit } = req.query as { page?: string; limit?: string };

    const result = await getWatchHistory(
      authReq.user.id,
      parseInt(page || '1', 10),
      Math.min(parseInt(limit || '20', 10), 50)
    );

    res.json(result);
  } catch (error) {
    console.error('Get watch history error:', error);
    res.status(500).json({ error: 'Failed to get watch history' });
  }
});

export default router;
