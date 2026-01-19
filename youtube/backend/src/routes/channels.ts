import express, { Router, Request, Response } from 'express';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import {
  getChannel,
  updateChannel,
  subscribe,
  unsubscribe,
  isSubscribed,
  getSubscriptions,
} from '../services/metadata.js';
import { getVideos } from '../services/metadata.js';

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

// Get channel by ID or username
router.get('/:identifier', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const optReq = req as OptionalAuthRequest;
    const identifier = req.params.identifier;
    if (!identifier) {
      res.status(400).json({ error: 'Channel identifier is required' });
      return;
    }
    const channel = await getChannel(identifier);

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Check if current user is subscribed
    let subscribed = false;
    if (optReq.user) {
      subscribed = await isSubscribed(optReq.user.id, channel.id);
    }

    res.json({
      ...channel,
      isSubscribed: subscribed,
    });
  } catch (error) {
    console.error('Get channel error:', error);
    res.status(500).json({ error: 'Failed to get channel' });
  }
});

// Get channel videos
router.get('/:identifier/videos', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const identifier = req.params.identifier;
    if (!identifier) {
      res.status(400).json({ error: 'Channel identifier is required' });
      return;
    }
    const { page, limit, orderBy, order } = req.query as {
      page?: string;
      limit?: string;
      orderBy?: string;
      order?: string;
    };

    const channel = await getChannel(identifier);

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const result = await getVideos({
      channelId: channel.id,
      page: parseInt(page || '1', 10),
      limit: Math.min(parseInt(limit || '20', 10), 50),
      orderBy,
      order,
    });

    res.json(result);
  } catch (error) {
    console.error('Get channel videos error:', error);
    res.status(500).json({ error: 'Failed to get channel videos' });
  }
});

// Update own channel
router.patch('/me', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { channelName, channelDescription, avatarUrl } = req.body as {
      channelName?: string;
      channelDescription?: string;
      avatarUrl?: string;
    };

    const channel = await updateChannel(authReq.user.id, {
      channelName,
      channelDescription,
      avatarUrl,
    });

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    res.json(channel);
  } catch (error) {
    console.error('Update channel error:', error);
    res.status(500).json({ error: 'Failed to update channel' });
  }
});

// Subscribe to channel
router.post('/:channelId/subscribe', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const channelId = req.params.channelId;
    if (!channelId) {
      res.status(400).json({ error: 'Channel ID is required' });
      return;
    }
    const result = await subscribe(authReq.user.id, channelId);
    res.json(result);
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

// Unsubscribe from channel
router.delete('/:channelId/subscribe', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const channelId = req.params.channelId;
    if (!channelId) {
      res.status(400).json({ error: 'Channel ID is required' });
      return;
    }
    const result = await unsubscribe(authReq.user.id, channelId);
    res.json(result);
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// Get user's subscriptions
router.get('/me/subscriptions', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { page, limit } = req.query as {
      page?: string;
      limit?: string;
    };

    const result = await getSubscriptions(
      authReq.user.id,
      parseInt(page || '1', 10),
      Math.min(parseInt(limit || '20', 10), 50)
    );

    res.json(result);
  } catch (error) {
    console.error('Get subscriptions error:', error);
    res.status(500).json({ error: 'Failed to get subscriptions' });
  }
});

export default router;
