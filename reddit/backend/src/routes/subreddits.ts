import express from 'express';
import type { Response } from 'express';
import {
  createSubreddit,
  findSubredditByName,
  listSubreddits,
  searchSubreddits,
  subscribe,
  unsubscribe,
  isSubscribed,
} from '../models/subreddit.js';
import { listPostsBySubreddit, type SortOption } from '../models/post.js';
import { getUserVotesForPosts } from '../models/vote.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../shared/logger.js';

interface CreateSubredditBody {
  name: string;
  title?: string;
  description?: string;
}

const router = express.Router();

// List all subreddits
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limitParam = req.query.limit;
    const offsetParam = req.query.offset;
    const search = req.query.q;

    const limit = Math.min(parseInt(typeof limitParam === 'string' ? limitParam : '25', 10) || 25, 100);
    const offset = parseInt(typeof offsetParam === 'string' ? offsetParam : '0', 10) || 0;

    let subreddits;
    if (search && typeof search === 'string') {
      subreddits = await searchSubreddits(search, limit);
    } else {
      subreddits = await listSubreddits(limit, offset);
    }

    res.json(subreddits);
  } catch (error) {
    console.error('List subreddits error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create subreddit
router.post('/', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, title, description } = req.body as CreateSubredditBody;

    if (!name) {
      res.status(400).json({ error: 'Subreddit name is required' });
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      res.status(400).json({ error: 'Subreddit name can only contain letters, numbers, and underscores' });
      return;
    }

    if (name.length < 3 || name.length > 21) {
      res.status(400).json({ error: 'Subreddit name must be 3-21 characters' });
      return;
    }

    const existing = await findSubredditByName(name);
    if (existing) {
      res.status(409).json({ error: 'Subreddit already exists' });
      return;
    }

    const subreddit = await createSubreddit(name, title || name, description || '', req.user!.id);

    // Auto-subscribe creator
    await subscribe(req.user!.id, subreddit.id);

    res.status(201).json(subreddit);
  } catch (error) {
    console.error('Create subreddit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get subreddit by name
router.get('/:name', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const subreddit = await findSubredditByName(req.params.name);
    if (!subreddit) {
      res.status(404).json({ error: 'Subreddit not found' });
      return;
    }

    // Add subscription status if user is logged in
    let subscribed = false;
    if (req.user) {
      subscribed = await isSubscribed(req.user.id, subreddit.id);
    }

    res.json({ ...subreddit, subscribed });
  } catch (error) {
    console.error('Get subreddit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get posts for subreddit with sorting
router.get('/:name/:sort?', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const subreddit = await findSubredditByName(req.params.name);
    if (!subreddit) {
      res.status(404).json({ error: 'Subreddit not found' });
      return;
    }

    const sort = (req.params.sort || 'hot') as SortOption;
    const limitParam = req.query.limit;
    const offsetParam = req.query.offset;
    const limit = Math.min(parseInt(typeof limitParam === 'string' ? limitParam : '25', 10) || 25, 100);
    const offset = parseInt(typeof offsetParam === 'string' ? offsetParam : '0', 10) || 0;

    const posts = await listPostsBySubreddit(subreddit.id, sort, limit, offset);

    // Add user votes if logged in
    if (req.user) {
      const postIds = posts.map((p) => p.id);
      const userVotes = await getUserVotesForPosts(req.user.id, postIds);
      for (const post of posts) {
        post.userVote = userVotes[post.id] || 0;
      }
    }

    res.json(posts);
  } catch (error) {
    console.error('Get subreddit posts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Subscribe to subreddit
router.post('/:name/subscribe', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const subreddit = await findSubredditByName(req.params.name);
    if (!subreddit) {
      res.status(404).json({ error: 'Subreddit not found' });
      return;
    }

    const alreadySubscribed = await isSubscribed(req.user!.id, subreddit.id);
    if (alreadySubscribed) {
      res.json({ subscribed: true });
      return;
    }

    await subscribe(req.user!.id, subreddit.id);
    res.json({ subscribed: true });
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Unsubscribe from subreddit
router.post('/:name/unsubscribe', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const subreddit = await findSubredditByName(req.params.name);
    if (!subreddit) {
      res.status(404).json({ error: 'Subreddit not found' });
      return;
    }

    await unsubscribe(req.user!.id, subreddit.id);
    res.json({ subscribed: false });
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
