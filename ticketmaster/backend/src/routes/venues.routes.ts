/**
 * Venue routes for browsing venue information.
 * Endpoints:
 * - GET / - List all venues
 * - GET /:id - Get single venue details
 * - GET /:id/sections - Get sections within a venue
 */
import { Router, Request, Response } from 'express';
import { eventService } from '../services/event.service.js';

/** Express router for venue endpoints */
const router = Router();

/**
 * GET /
 * Lists all venues ordered by name.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const venues = await eventService.getVenues();
    res.json({ success: true, data: venues });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get venues';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /:id
 * Retrieves details for a single venue by ID.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const venue = await eventService.getVenueById(req.params.id);

    if (!venue) {
      res.status(404).json({ success: false, error: 'Venue not found' });
      return;
    }

    res.json({ success: true, data: venue });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get venue';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /:id/sections
 * Retrieves all sections for a venue.
 * Useful for displaying seat map structure.
 */
router.get('/:id/sections', async (req: Request, res: Response) => {
  try {
    const sections = await eventService.getVenueSections(req.params.id);
    res.json({ success: true, data: sections });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get venue sections';
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
