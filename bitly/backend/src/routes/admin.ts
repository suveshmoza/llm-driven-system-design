import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAdmin } from '../middleware/auth.js';
import {
  getSystemStats,
  getAllUrls,
  adminDeactivateUrl,
  adminReactivateUrl,
  cleanupExpiredUrls,
} from '../services/adminService.js';
import { getGlobalAnalytics } from '../services/analyticsService.js';
import { getAllUsers, updateUserRole, deactivateUser } from '../services/authService.js';
import { getKeyPoolStats, repopulateKeyPool } from '../services/keyService.js';

/**
 * Admin router.
 * Provides system administration endpoints for managing URLs, users, and key pool.
 * All routes require admin authentication.
 */
const router = Router();

/**
 * Apply admin authentication to all routes in this router.
 */
router.use(requireAdmin);

/**
 * GET /stats - Get system-wide statistics
 * Returns URL counts, click counts, and key pool status.
 */
router.get(
  '/stats',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const stats = await getSystemStats();
    res.json(stats);
  })
);

/**
 * GET /analytics - Get global analytics data
 * Returns click trends, hourly distribution, and top URLs.
 */
router.get(
  '/analytics',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const analytics = await getGlobalAnalytics();
    res.json(analytics);
  })
);

/**
 * GET /urls - List all URLs with optional filtering
 * Supports is_active, is_custom, and search filters.
 */
router.get(
  '/urls',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const is_active = req.query.is_active !== undefined
      ? req.query.is_active === 'true'
      : undefined;
    const is_custom = req.query.is_custom !== undefined
      ? req.query.is_custom === 'true'
      : undefined;
    const search = req.query.search as string | undefined;

    const result = await getAllUrls(limit, offset, { is_active, is_custom, search });
    res.json(result);
  })
);

/**
 * POST /urls/:shortCode/deactivate - Deactivate a URL
 * Prevents the URL from redirecting.
 */
router.post(
  '/urls/:shortCode/deactivate',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { shortCode } = req.params;

    const success = await adminDeactivateUrl(shortCode);

    if (!success) {
      res.status(404).json({ error: 'URL not found' });
      return;
    }

    res.json({ message: 'URL deactivated' });
  })
);

/**
 * POST /urls/:shortCode/reactivate - Reactivate a URL
 * Restores a previously deactivated URL.
 */
router.post(
  '/urls/:shortCode/reactivate',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { shortCode } = req.params;

    const success = await adminReactivateUrl(shortCode);

    if (!success) {
      res.status(404).json({ error: 'URL not found' });
      return;
    }

    res.json({ message: 'URL reactivated' });
  })
);

/**
 * GET /users - List all users with pagination
 */
router.get(
  '/users',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const result = await getAllUsers(limit, offset);
    res.json(result);
  })
);

/**
 * PATCH /users/:userId/role - Update a user's role
 * Role must be 'user' or 'admin'.
 */
router.patch(
  '/users/:userId/role',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { userId } = req.params;
    const { role } = req.body;

    if (!role || !['user', 'admin'].includes(role)) {
      res.status(400).json({ error: 'Invalid role. Must be "user" or "admin"' });
      return;
    }

    const user = await updateUserRole(userId, role);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(user);
  })
);

/**
 * POST /users/:userId/deactivate - Deactivate a user account
 * Prevents the user from logging in.
 */
router.post(
  '/users/:userId/deactivate',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { userId } = req.params;

    const success = await deactivateUser(userId);

    if (!success) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ message: 'User deactivated' });
  })
);

/**
 * GET /key-pool - Get key pool statistics
 * Returns counts of total, available, allocated, and used keys.
 */
router.get(
  '/key-pool',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const stats = await getKeyPoolStats();
    res.json(stats);
  })
);

/**
 * POST /key-pool/repopulate - Add new keys to the pool
 * Accepts optional count parameter (default: 1000).
 */
router.post(
  '/key-pool/repopulate',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const count = parseInt(req.body.count as string, 10) || 1000;
    const added = await repopulateKeyPool(count);
    res.json({ message: `Added ${added} new keys to the pool` });
  })
);

/**
 * POST /cleanup-expired - Deactivate all expired URLs
 * Batch operation for maintenance.
 */
router.post(
  '/cleanup-expired',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const cleaned = await cleanupExpiredUrls();
    res.json({ message: `Deactivated ${cleaned} expired URLs` });
  })
);

export default router;
