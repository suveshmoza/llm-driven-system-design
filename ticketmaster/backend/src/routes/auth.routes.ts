/**
 * Authentication routes for user registration, login, and session management.
 * Endpoints:
 * - POST /register - Create new user account
 * - POST /login - Authenticate and create session
 * - POST /logout - Invalidate current session
 * - GET /me - Get current authenticated user
 */
import { Router, Request, Response } from 'express';
import { authService } from '../services/auth.service.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.middleware.js';

/** Express router for authentication endpoints */
const router = Router();

/**
 * POST /register
 * Creates a new user account.
 * Requires email, password, and name in request body.
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ success: false, error: 'Email, password, and name are required' });
      return;
    }

    const user = await authService.register(email, password, name);
    res.status(201).json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    res.status(400).json({ success: false, error: message });
  }
});

/**
 * POST /login
 * Authenticates a user and creates a session.
 * Sets session cookie and returns user info with session ID.
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ success: false, error: 'Email and password are required' });
      return;
    }

    const { user, session } = await authService.login(email, password);

    // Set session cookie
    res.cookie('session', session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax',
    });

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        sessionId: session.id,
        expiresAt: session.expires_at,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    res.status(401).json({ success: false, error: message });
  }
});

/**
 * POST /logout
 * Invalidates the current session and clears the session cookie.
 * Requires authentication.
 */
router.post('/logout', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.sessionId) {
      await authService.logout(req.sessionId);
    }

    res.clearCookie('session');
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Logout failed';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /me
 * Returns the currently authenticated user's profile.
 * Requires authentication.
 */
router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await authService.getUserById(req.userId!);
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get user';
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
