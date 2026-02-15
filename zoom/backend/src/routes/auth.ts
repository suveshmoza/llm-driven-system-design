import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../services/db.js';
import { logger } from '../services/logger.js';
import { authLimiter } from '../services/rateLimiter.js';

const router = Router();

router.post('/register', authLimiter, async (req: Request, res: Response) => {
  try {
    const { username, email, password, displayName } = req.body;

    if (!username || !email || !password) {
      res.status(400).json({ error: 'Username, email, and password are required' });
      return;
    }

    const existing = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Username or email already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4) RETURNING id, username, email, display_name, created_at`,
      [username, email, passwordHash, displayName || username]
    );

    const user = result.rows[0];
    req.session.userId = user.id;
    req.session.username = user.username;

    logger.info({ userId: user.id, username }, 'User registered');
    res.status(201).json({ user });
  } catch (err) {
    logger.error({ err }, 'Registration error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const result = await pool.query(
      'SELECT id, username, email, display_name, password_hash, created_at FROM users WHERE username = $1',
      [username]
    );
    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    req.session.userId = user.id;
    req.session.username = user.username;

    logger.info({ userId: user.id, username }, 'User logged in');
    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Login error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      logger.error({ err }, 'Logout error');
      res.status(500).json({ error: 'Logout failed' });
      return;
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out' });
  });
});

router.get('/me', (req: Request, res: Response) => {
  if (!req.session?.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  pool
    .query('SELECT id, username, email, display_name, avatar_url, created_at FROM users WHERE id = $1', [
      req.session.userId,
    ])
    .then((result) => {
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
          createdAt: user.created_at,
        },
      });
    })
    .catch((err) => {
      logger.error({ err }, 'Get user error');
      res.status(500).json({ error: 'Internal server error' });
    });
});

export default router;
