import { Router, Request, Response } from 'express';
import catalogService from '../services/catalogService.js';
import { rateLimiters } from '../shared/rateLimit.js';
import { searchOperationsTotal } from '../shared/metrics.js';
import type { AuthenticatedRequest } from '../types.js';

const router = Router();

interface CatalogQuery {
  limit?: string;
  offset?: string;
  search?: string;
  artistId?: string;
  q?: string;
  type?: string;
}

// Get all artists
router.get('/artists', async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit = '20', offset = '0', search = '' } = req.query as CatalogQuery;
    const result = await catalogService.getArtists({
      limit: parseInt(limit),
      offset: parseInt(offset),
      search,
    });
    res.json(result);
  } catch (error) {
    console.error('Get artists error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get artist by ID
router.get('/artists/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const artist = await catalogService.getArtistById(req.params.id);
    if (!artist) {
      res.status(404).json({ error: 'Artist not found' });
      return;
    }
    res.json(artist);
  } catch (error) {
    console.error('Get artist error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all albums
router.get('/albums', async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit = '20', offset = '0', search = '', artistId } = req.query as CatalogQuery;
    const result = await catalogService.getAlbums({
      limit: parseInt(limit),
      offset: parseInt(offset),
      search,
      artistId,
    });
    res.json(result);
  } catch (error) {
    console.error('Get albums error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get album by ID
router.get('/albums/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const album = await catalogService.getAlbumById(req.params.id);
    if (!album) {
      res.status(404).json({ error: 'Album not found' });
      return;
    }
    res.json(album);
  } catch (error) {
    console.error('Get album error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get track by ID
router.get('/tracks/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const track = await catalogService.getTrackById(req.params.id);
    if (!track) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }
    res.json(track);
  } catch (error) {
    console.error('Get track error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get new releases
router.get('/new-releases', async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit = '20' } = req.query as CatalogQuery;
    const releases = await catalogService.getNewReleases({ limit: parseInt(limit) });
    res.json({ albums: releases });
  } catch (error) {
    console.error('Get new releases error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get featured tracks
router.get('/featured', async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit = '20' } = req.query as CatalogQuery;
    const tracks = await catalogService.getFeaturedTracks({ limit: parseInt(limit) });
    res.json({ tracks });
  } catch (error) {
    console.error('Get featured error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search (with rate limiting)
router.get('/search', rateLimiters.search, async (req, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  try {
    const { q, limit = '20', type } = req.query as CatalogQuery;

    if (!q) {
      res.status(400).json({ error: 'Search query is required' });
      return;
    }

    const types = type ? type.split(',') : ['artists', 'albums', 'tracks'];
    const results = await catalogService.search(q, {
      limit: parseInt(limit),
      types,
    });

    // Track search metrics
    types.forEach((searchType) => {
      searchOperationsTotal.inc({ type: searchType });
    });

    res.json(results);
  } catch (error) {
    const log = authReq.log || console;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error({ error: errorMessage }, 'Search error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
