import express, { Request, Response, Router } from 'express';
import { TrendingService, TrendingCacheEntry } from '../services/trendingService.js';

const router: Router = express.Router();

interface TrendingAllResult {
  [category: string]: TrendingCacheEntry;
}

/**
 * GET /api/trending
 * Get trending videos for a category
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const category = (req.query.category as string) || 'all';
    const trendingService = TrendingService.getInstance();

    const { videos, updatedAt } = trendingService.getTrending(category);

    res.json({
      category,
      videos,
      updatedAt,
      count: videos.length,
    });
  } catch (error) {
    console.error('Error getting trending:', error);
    res.status(500).json({ error: 'Failed to get trending videos' });
  }
});

/**
 * GET /api/trending/all
 * Get trending videos for all categories
 */
router.get('/all', async (req: Request, res: Response): Promise<void> => {
  try {
    const trendingService = TrendingService.getInstance();
    const categories = ['all', 'music', 'gaming', 'sports', 'news', 'entertainment', 'education'];

    const result: TrendingAllResult = {};
    for (const category of categories) {
      const { videos, updatedAt } = trendingService.getTrending(category);
      result[category] = { videos, updatedAt };
    }

    res.json(result);
  } catch (error) {
    console.error('Error getting all trending:', error);
    res.status(500).json({ error: 'Failed to get all trending videos' });
  }
});

/**
 * GET /api/trending/categories
 * Get available categories
 */
router.get('/categories', async (req: Request, res: Response): Promise<void> => {
  try {
    const trendingService = TrendingService.getInstance();
    const categories = await trendingService.getCategories();

    res.json({
      categories: ['all', ...categories],
    });
  } catch (error) {
    console.error('Error getting categories:', error);
    res.status(500).json({ error: 'Failed to get categories' });
  }
});

/**
 * GET /api/trending/stats
 * Get trending statistics
 */
router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const trendingService = TrendingService.getInstance();
    const stats = await trendingService.getStats();

    res.json(stats);
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * POST /api/trending/refresh
 * Force refresh trending calculations
 */
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const trendingService = TrendingService.getInstance();
    await trendingService.updateTrending();

    res.json({
      success: true,
      message: 'Trending calculations refreshed',
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error refreshing trending:', error);
    res.status(500).json({ error: 'Failed to refresh trending' });
  }
});

export default router;
