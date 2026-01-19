/**
 * Admin routes for the job scheduler API.
 * Handles user management, cleanup, storage stats, and circuit breaker control.
 * @module api/admin-routes
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from './types.js';
import {
  authenticate,
  authorize,
  createSession,
  destroySession,
  validateCredentials,
  createUser,
} from '../shared/auth.js';
import { resetAllCircuitBreakers } from '../shared/circuit-breaker.js';
import { runCleanup, getCleanupPreview, getStorageStats, retentionConfig } from '../shared/archival.js';

const router = Router();

// === Authentication Endpoints ===

/** POST /api/auth/login - Create session */
router.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({
        success: false,
        error: 'Username and password are required',
      });
      return;
    }

    const user = await validateCredentials(username, password);

    if (!user) {
      res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      });
      return;
    }

    const sessionId = await createSession(user);

    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 86400000, // 24 hours
    });

    res.json({
      success: true,
      data: { user: { id: user.id, username: user.username, role: user.role } },
      message: 'Login successful',
    });
  })
);

/** POST /api/auth/logout - Destroy session */
router.post(
  '/auth/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    if (req.sessionId) {
      await destroySession(req.sessionId);
    }

    res.clearCookie('session_id');
    res.json({
      success: true,
      message: 'Logout successful',
    });
  })
);

/** GET /api/auth/me - Get current user */
router.get('/auth/me', authenticate, (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      id: req.user?.userId,
      username: req.user?.username,
      role: req.user?.role,
    },
  });
});

// === Admin User Management ===

/** POST /api/v1/admin/users - Create a new user (Admin only) */
router.post(
  '/v1/admin/users',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { username, password, role } = req.body;

    if (!username || !password) {
      res.status(400).json({
        success: false,
        error: 'Username and password are required',
      });
      return;
    }

    const user = await createUser(username, password, role || 'user');

    res.status(201).json({
      success: true,
      data: user,
      message: 'User created successfully',
    });
  })
);

// === Admin System Management ===

/** POST /api/v1/admin/cleanup - Run data cleanup (Admin only) */
router.post(
  '/v1/admin/cleanup',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { dryRun } = req.body;

    if (dryRun) {
      const preview = await getCleanupPreview();
      res.json({
        success: true,
        data: preview,
        message: 'Cleanup preview (dry run)',
      });
      return;
    }

    const stats = await runCleanup();

    res.json({
      success: true,
      data: stats,
      message: 'Cleanup completed successfully',
    });
  })
);

/** GET /api/v1/admin/storage - Get storage statistics (Admin only) */
router.get(
  '/v1/admin/storage',
  authenticate,
  authorize('admin'),
  asyncHandler(async (_req, res) => {
    const stats = await getStorageStats();

    res.json({
      success: true,
      data: {
        stats,
        retentionConfig,
      },
    });
  })
);

/** POST /api/v1/admin/circuit-breakers/reset - Reset all circuit breakers (Admin only) */
router.post(
  '/v1/admin/circuit-breakers/reset',
  authenticate,
  authorize('admin'),
  asyncHandler(async (_req, res) => {
    resetAllCircuitBreakers();

    res.json({
      success: true,
      message: 'All circuit breakers reset',
    });
  })
);

export { router as adminRoutes };
