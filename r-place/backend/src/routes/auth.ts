/**
 * Authentication routes for user registration, login, and session management.
 *
 * Provides endpoints for:
 * - User registration with username/password
 * - Login with session cookie creation
 * - Logout with session invalidation
 * - Current user retrieval
 * - Anonymous guest access
 */
import { Router, Request, Response } from 'express';
import { authService } from '../services/auth.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

/**
 * POST /register - Register a new user account.
 * Validates username (3-50 chars) and password (min 6 chars).
 * Automatically logs in the user after successful registration.
 */
router.post('/register', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  if (username.length < 3 || username.length > 50) {
    res.status(400).json({ error: 'Username must be 3-50 characters' });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  const result = await authService.register(username, password);

  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  // Auto-login after registration
  const loginResult = await authService.login(username, password);
  if (loginResult.success && loginResult.session) {
    res.cookie('session', loginResult.session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });
    res.json({ user: result.user });
  } else {
    res.json({ user: result.user });
  }
});

/**
 * POST /login - Authenticate and create a session.
 * Sets an httpOnly session cookie valid for 24 hours.
 */
router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  const result = await authService.login(username, password);

  if (!result.success) {
    res.status(401).json({ error: result.error });
    return;
  }

  res.cookie('session', result.session!.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  });

  res.json({ user: result.user });
});

/**
 * POST /logout - End the current session.
 * Requires authentication. Clears the session cookie.
 */
router.post('/logout', authMiddleware, async (req: Request, res: Response) => {
  if (req.sessionId) {
    await authService.logout(req.sessionId);
  }
  res.clearCookie('session');
  res.json({ success: true });
});

/**
 * GET /me - Get the current authenticated user's information.
 * Requires authentication.
 */
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  res.json({ user: req.user });
});

/**
 * POST /anonymous - Create an anonymous guest session.
 * Allows users to participate without registration.
 * Creates a user with a random username (anon_xxxxxxxx).
 */
router.post('/anonymous', async (req: Request, res: Response) => {
  const result = await authService.createAnonymousUser();

  res.cookie('session', result.session.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  });

  res.json({ user: result.user });
});

export default router;
