import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../services/db.js';
import { loginRateLimiter } from '../services/rateLimiter.js';
import logger from '../services/logger.js';
import { authAttempts, activeSessions } from '../services/metrics.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

interface RegisterBody {
  username: string;
  email: string;
  password: string;
  displayName?: string;
}

interface LoginBody {
  username: string;
  password: string;
}

interface UserRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  display_name: string;
  avatar_url: string | null;
  created_at: Date;
}

// Register
router.post('/register', async (req: Request<unknown, unknown, RegisterBody>, res: Response): Promise<void> => {
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

    const existingUser = await query<{ id: string }>(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username.toLowerCase(), email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      authAttempts.labels('register', 'failure').inc();
      res.status(409).json({ error: 'Username or email already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await query<UserRow>(
      `INSERT INTO users (username, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, display_name, avatar_url, created_at`,
      [username.toLowerCase(), email.toLowerCase(), passwordHash, displayName || username]
    );

    const user = result.rows[0];

    const session = (req as AuthenticatedRequest).session;
    session.userId = user.id;
    session.username = user.username;

    authAttempts.labels('register', 'success').inc();
    activeSessions.inc();

    logger.info({ userId: user.id, username: user.username }, `User registered: ${user.username}`);

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
    authAttempts.labels('register', 'failure').inc();
    logger.error({ error: err.message }, `Registration error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
router.post('/login', loginRateLimiter, async (req: Request<unknown, unknown, LoginBody>, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const result = await query<UserRow>(
      `SELECT id, username, email, password_hash, display_name, avatar_url
       FROM users WHERE username = $1 OR email = $1`,
      [username.toLowerCase()]
    );

    if (result.rows.length === 0) {
      authAttempts.labels('login', 'failure').inc();
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      authAttempts.labels('login', 'failure').inc();
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const session = (req as AuthenticatedRequest).session;
    session.userId = user.id;
    session.username = user.username;

    authAttempts.labels('login', 'success').inc();
    activeSessions.inc();

    logger.info({ userId: user.id, username: user.username }, `User logged in: ${user.username}`);

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
    authAttempts.labels('login', 'failure').inc();
    logger.error({ error: err.message }, `Login error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout
router.post('/logout', (req: Request, res: Response): void => {
  const session = (req as AuthenticatedRequest).session;
  const userId = session?.userId;
  const username = session?.username;

  req.session.destroy((err) => {
    if (err) {
      logger.error({ error: err.message, userId }, `Logout error: ${err.message}`);
      res.status(500).json({ error: 'Could not log out' });
      return;
    }

    activeSessions.dec();
    logger.info({ userId, username }, `User logged out: ${username}`);

    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out successfully' });
  });
});

// Get current user
router.get('/me', (req: Request, res: Response): void => {
  const session = (req as AuthenticatedRequest).session;
  if (!session.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  query<UserRow>(
    `SELECT id, username, email, display_name, avatar_url
     FROM users WHERE id = $1`,
    [session.userId]
  )
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
        },
      });
    })
    .catch((error: Error) => {
      logger.error({ error: error.message, userId: session.userId }, `Get me error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    });
});

export default router;
