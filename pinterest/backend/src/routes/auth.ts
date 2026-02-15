import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { loginRateLimiter } from '../services/rateLimiter.js';
import { authAttempts } from '../services/metrics.js';
import { logger } from '../services/logger.js';

const router = Router();

// POST /api/v1/auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, email, password, displayName } = req.body;

    if (!username || !email || !password) {
      res.status(400).json({ error: 'Username, email, and password are required' });
      return;
    }

    if (username.length < 3 || username.length > 30) {
      res.status(400).json({ error: 'Username must be 3-30 characters' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    // Check if user exists
    const existing = await query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email],
    );

    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Username or email already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await query(
      `INSERT INTO users (username, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, display_name, avatar_url, bio, follower_count, following_count, created_at`,
      [username, email, passwordHash, displayName || username],
    );

    const user = result.rows[0];

    // Set session
    req.session.userId = user.id;
    req.session.username = user.username;

    authAttempts.labels('register', 'success').inc();

    res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        followerCount: user.follower_count,
        followingCount: user.following_count,
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Registration error');
    authAttempts.labels('register', 'error').inc();
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/auth/login
router.post('/login', loginRateLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const result = await query(
      'SELECT * FROM users WHERE username = $1',
      [username],
    );

    if (result.rows.length === 0) {
      authAttempts.labels('login', 'invalid_credentials').inc();
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      authAttempts.labels('login', 'invalid_credentials').inc();
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    req.session.userId = user.id;
    req.session.username = user.username;

    authAttempts.labels('login', 'success').inc();

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        followerCount: user.follower_count,
        followingCount: user.following_count,
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Login error');
    authAttempts.labels('login', 'error').inc();
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/auth/logout
router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      logger.error({ err }, 'Logout error');
      res.status(500).json({ error: 'Failed to logout' });
      return;
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out' });
  });
});

// GET /api/v1/auth/me
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, username, email, display_name, avatar_url, bio, follower_count, following_count, created_at
       FROM users WHERE id = $1`,
      [req.session.userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = result.rows[0];
    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        followerCount: user.follower_count,
        followingCount: user.following_count,
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Get me error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
