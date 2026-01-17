import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AUTH_CONFIG } from '../config.js';
import {
  createUser,
  loginUser,
  logoutUser,
  getUserByToken,
} from '../services/authService.js';

/**
 * Authentication router.
 * Provides user registration, login, logout, and session management.
 * Routes: POST /register, POST /login, POST /logout, GET /me
 */
const router = Router();

/**
 * POST /register - Create a new user account
 * Requires email and password in request body.
 * Returns the created user (without password).
 */
router.post(
  '/register',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    try {
      const user = await createUser({ email, password });
      res.status(201).json(user);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';
      res.status(400).json({ error: message });
    }
  })
);

/**
 * POST /login - Authenticate user and create session
 * Sets httpOnly cookie with session token.
 * Returns user data and token in response body.
 */
router.post(
  '/login',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const result = await loginUser(email, password);

    if (!result) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Set session cookie
    res.cookie(AUTH_CONFIG.cookieName, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: AUTH_CONFIG.sessionDuration,
    });

    res.json({ user: result.user, token: result.token });
  })
);

/**
 * POST /logout - Invalidate current session
 * Clears session cookie and removes session from database/cache.
 */
router.post(
  '/logout',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const token = req.cookies?.[AUTH_CONFIG.cookieName] || req.headers.authorization?.replace('Bearer ', '');

    if (token) {
      await logoutUser(token);
    }

    res.clearCookie(AUTH_CONFIG.cookieName);
    res.json({ message: 'Logged out successfully' });
  })
);

/**
 * GET /me - Get current authenticated user
 * Returns user data if session is valid, 401 otherwise.
 */
router.get(
  '/me',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const token = req.cookies?.[AUTH_CONFIG.cookieName] || req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const user = await getUserByToken(token);

    if (!user) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    res.json(user);
  })
);

export default router;
