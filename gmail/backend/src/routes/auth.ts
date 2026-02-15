import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../services/db.js';
import { createSystemLabels } from '../services/labelService.js';
import logger from '../services/logger.js';
import { authAttempts } from '../services/metrics.js';
import { loginRateLimiter } from '../services/rateLimiter.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

interface UserRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
}

/**
 * POST /api/v1/auth/register
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, email, password, displayName } = req.body;

    if (!username || !email || !password) {
      return res
        .status(400)
        .json({ error: 'Username, email, and password are required' });
    }

    if (username.length < 3 || username.length > 30) {
      return res
        .status(400)
        .json({ error: 'Username must be 3-30 characters' });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: 'Password must be at least 6 characters' });
    }

    // Check for existing user
    const existing = await query<{ id: string }>(
      `SELECT id FROM users WHERE username = $1 OR email = $2`,
      [username, email]
    );

    if (existing.rows.length > 0) {
      return res
        .status(409)
        .json({ error: 'Username or email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await query<UserRow>(
      `INSERT INTO users (username, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, display_name, avatar_url, created_at`,
      [username, email, passwordHash, displayName || username]
    );

    const user = result.rows[0];

    // Create system labels for the new user
    await createSystemLabels(user.id);

    // Set session
    const authReq = req as AuthenticatedRequest;
    authReq.session.userId = user.id;
    authReq.session.username = user.username;

    authAttempts.labels('register', 'success').inc();

    res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
      },
    });
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Registration failed');
    authAttempts.labels('register', 'failure').inc();
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/auth/login
 */
router.post('/login', loginRateLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: 'Username and password are required' });
    }

    const result = await query<UserRow>(
      `SELECT * FROM users WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      authAttempts.labels('login', 'failure').inc();
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      authAttempts.labels('login', 'failure').inc();
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const authReq = req as AuthenticatedRequest;
    authReq.session.userId = user.id;
    authReq.session.username = user.username;

    authAttempts.labels('login', 'success').inc();

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
      },
    });
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Login failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/auth/logout
 */
router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      logger.error({ error: (err as Error).message }, 'Logout failed');
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out' });
  });
});

/**
 * GET /api/v1/auth/me
 */
router.get('/me', requireAuth as unknown as import('express').RequestHandler, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await query<UserRow>(
      `SELECT id, username, email, display_name, avatar_url FROM users WHERE id = $1`,
      [authReq.session.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
      },
    });
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Failed to get user');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
