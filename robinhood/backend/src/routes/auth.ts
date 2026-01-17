import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../database.js';
import type { User } from '../types/index.js';
import { config } from '../config.js';

/**
 * Express router for authentication endpoints.
 * Handles user login, registration, and logout with session-based auth.
 */
const router = Router();

/**
 * POST /api/auth/login
 * Authenticates a user with email and password.
 * Creates a new session token on successful authentication.
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }

    const userResult = await pool.query<User>(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = userResult.rows[0];

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (user.account_status !== 'active') {
      res.status(403).json({ error: 'Account is not active' });
      return;
    }

    // Create session
    const token = uuidv4();
    const expiresAt = new Date(
      Date.now() + config.session.expiresInHours * 60 * 60 * 1000
    );

    await pool.query(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt]
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        buyingPower: parseFloat(user.buying_power.toString()),
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /api/auth/register
 * Creates a new user account with email and password.
 * Also creates a default watchlist and session for the new user.
 * New users start with $10,000 buying power.
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }

    // Check if email already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      res.status(400).json({ error: 'Email already registered' });
      return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const userResult = await pool.query<User>(
      `INSERT INTO users (email, password_hash, first_name, last_name, buying_power)
       VALUES ($1, $2, $3, $4, 10000.00)
       RETURNING *`,
      [email.toLowerCase(), passwordHash, firstName || null, lastName || null]
    );

    const user = userResult.rows[0];

    // Create default watchlist
    await pool.query(
      'INSERT INTO watchlists (user_id, name) VALUES ($1, $2)',
      [user.id, 'My Watchlist']
    );

    // Create session
    const token = uuidv4();
    const expiresAt = new Date(
      Date.now() + config.session.expiresInHours * 60 * 60 * 1000
    );

    await pool.query(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt]
    );

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        buyingPower: parseFloat(user.buying_power.toString()),
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * POST /api/auth/logout
 * Invalidates the current session token.
 * The user must re-authenticate to access protected endpoints.
 */
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    }

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

export default router;
