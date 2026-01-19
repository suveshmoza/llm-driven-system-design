import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../utils/database.js';
import { redis } from '../utils/redis.js';

const router: Router = Router();

interface LoginRequest {
  email: string;
  password?: string;
}

interface RegisterRequest {
  email: string;
  name: string;
  phone?: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  user_id?: string;
}

// Login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body as LoginRequest;

    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    // For demo purposes, we accept any password for existing users
    // In production, you'd verify the password hash
    const result = await query<UserRow>(
      `SELECT id, email, name, role FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = result.rows[0];

    // Create session
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await query(
      `INSERT INTO sessions (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, token, expiresAt]
    );

    // Cache session in Redis
    await redis.setex(
      `session:${token}`,
      86400, // 24 hours
      JSON.stringify({ ...user, user_id: user.id })
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      expiresAt,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Register
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, name, phone } = req.body as RegisterRequest;

    if (!email || !name) {
      res.status(400).json({ error: 'Email and name are required' });
      return;
    }

    // Check if user exists
    const existing = await query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    // Create user
    const result = await query<UserRow>(
      `INSERT INTO users (email, name, phone, email_verified, role)
       VALUES ($1, $2, $3, true, 'user')
       RETURNING id, email, name, role`,
      [email.toLowerCase(), name, phone || null]
    );

    const user = result.rows[0];

    // Create default preferences
    await query(
      `INSERT INTO notification_preferences (user_id)
       VALUES ($1)`,
      [user.id]
    );

    // Create session
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await query(
      `INSERT INTO sessions (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, token, expiresAt]
    );

    await redis.setex(
      `session:${token}`,
      86400,
      JSON.stringify({ ...user, user_id: user.id })
    );

    res.status(201).json({
      token,
      user,
      expiresAt,
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Logout
router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);

      await query(`DELETE FROM sessions WHERE token = $1`, [token]);
      await redis.del(`session:${token}`);
    }

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Get current user
router.get('/me', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const token = authHeader.substring(7);
    const cached = await redis.get(`session:${token}`);

    if (cached) {
      const session = JSON.parse(cached) as UserRow;
      res.json({
        id: session.user_id || session.id,
        email: session.email,
        name: session.name,
        role: session.role,
      });
      return;
    }

    const result = await query<UserRow>(
      `SELECT u.id, u.email, u.name, u.role
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token = $1 AND s.expires_at > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

export default router;
