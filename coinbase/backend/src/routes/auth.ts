import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../services/db.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../services/rateLimiter.js';

const router = Router();

// POST /api/v1/auth/register
router.post('/register', authLimiter, async (req: Request, res: Response) => {
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

    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    // Check existing user
    const existing = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Username or email already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, display_name AS "displayName", created_at AS "createdAt"`,
      [username, email, passwordHash, displayName || username]
    );

    const user = result.rows[0];

    // Create USD wallet by default
    await pool.query(
      `INSERT INTO wallets (user_id, currency_id, balance) VALUES ($1, 'USD', 0)`,
      [user.id]
    );

    req.session.userId = user.id;
    req.session.username = user.username;

    res.status(201).json({ user });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/v1/auth/login
router.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const result = await pool.query(
      `SELECT id, username, email, password_hash, display_name AS "displayName",
              is_verified AS "isVerified", created_at AS "createdAt"
       FROM users WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    req.session.userId = user.id;
    req.session.username = user.username;

    const { password_hash: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/v1/auth/logout
router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: 'Logout failed' });
      return;
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out successfully' });
  });
});

// GET /api/v1/auth/me
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, username, email, display_name AS "displayName",
              is_verified AS "isVerified", created_at AS "createdAt"
       FROM users WHERE id = $1`,
      [req.session.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

export default router;
