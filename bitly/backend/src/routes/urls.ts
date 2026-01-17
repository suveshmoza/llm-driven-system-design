import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import {
  createUrl,
  getUrlDetails,
  getUserUrls,
  updateUrl,
  deleteUrl,
} from '../services/urlService.js';

/**
 * URL management router.
 * Provides CRUD operations for shortened URLs.
 * Routes: POST /, GET /, GET /:shortCode, PATCH /:shortCode, DELETE /:shortCode
 */
const router = Router();

/**
 * POST / - Create a new shortened URL
 * Accepts long_url, optional custom_code, and optional expires_in.
 * Optionally associates URL with authenticated user.
 */
router.post(
  '/',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { long_url, custom_code, expires_in } = req.body;

    if (!long_url) {
      res.status(400).json({ error: 'long_url is required' });
      return;
    }

    try {
      const url = await createUrl({
        long_url,
        custom_code,
        expires_in,
        user_id: req.user?.id,
      });

      res.status(201).json(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create URL';
      res.status(400).json({ error: message });
    }
  })
);

/**
 * GET / - List authenticated user's URLs
 * Supports pagination via limit and offset query parameters.
 * Requires authentication.
 */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const result = await getUserUrls(req.user!.id, limit, offset);

    res.json(result);
  })
);

/**
 * GET /:shortCode - Get URL details
 * Returns full URL information for display.
 * Filters by user ID if authenticated.
 */
router.get(
  '/:shortCode',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { shortCode } = req.params;

    const url = await getUrlDetails(shortCode, req.user?.id);

    if (!url) {
      res.status(404).json({ error: 'URL not found' });
      return;
    }

    res.json(url);
  })
);

/**
 * PATCH /:shortCode - Update URL properties
 * Allows updating is_active and expires_at.
 * Requires authentication and URL ownership.
 */
router.patch(
  '/:shortCode',
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { shortCode } = req.params;
    const { is_active, expires_at } = req.body;

    const url = await updateUrl(shortCode, req.user!.id, {
      is_active,
      expires_at: expires_at ? new Date(expires_at) : undefined,
    });

    if (!url) {
      res.status(404).json({ error: 'URL not found or not owned by you' });
      return;
    }

    res.json(url);
  })
);

/**
 * DELETE /:shortCode - Soft-delete a URL
 * Marks the URL as inactive (soft delete).
 * Requires authentication and URL ownership.
 */
router.delete(
  '/:shortCode',
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { shortCode } = req.params;

    const deleted = await deleteUrl(shortCode, req.user!.id);

    if (!deleted) {
      res.status(404).json({ error: 'URL not found or not owned by you' });
      return;
    }

    res.status(204).send();
  })
);

export default router;
