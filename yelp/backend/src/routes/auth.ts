import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../utils/db.js';
import { sessions } from '../utils/redis.js';
import { authenticate, AuthenticatedRequest, AuthUser } from '../middleware/auth.js';

const router = Router();

// User DB row interface
interface UserRow extends AuthUser {
  password_hash: string;
  created_at: string;
}

// Register a new user
router.post('/register', async (req: Request, res: Response): Promise<void | Response> => {
  try {
    const { email, password, name } = req.body as {
      email?: string;
      password?: string;
      name?: string;
    };

    if (!email || !password || !name) {
      return res
        .status(400)
        .json({ error: { message: 'Email, password, and name are required' } });
    }

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return res
        .status(409)
        .json({ error: { message: 'Email already registered' } });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const result = await pool.query<{
      id: string;
      email: string;
      name: string;
      role: string;
      created_at: string;
    }>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, role, created_at`,
      [email.toLowerCase(), passwordHash, name]
    );

    const user = result.rows[0];

    // Create session
    const token = uuidv4();
    await sessions.create(user.id, token);

    // Set cookie
    res.cookie('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      token,
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: { message: 'Registration failed' } });
  }
});

// Login
router.post('/login', async (req: Request, res: Response): Promise<void | Response> => {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: { message: 'Email and password are required' } });
    }

    // Get user
    const result = await pool.query<UserRow>(
      'SELECT id, email, name, password_hash, role, avatar_url, review_count FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }

    const user = result.rows[0];

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }

    // Create session
    const token = uuidv4();
    await sessions.create(user.id, token);

    // Set cookie
    res.cookie('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar_url: user.avatar_url,
        review_count: user.review_count,
      },
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: { message: 'Login failed' } });
  }
});

// Logout
router.post(
  '/logout',
  authenticate as any,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (req.sessionToken) {
        await sessions.destroy(req.sessionToken);
      }
      res.clearCookie('session_token');
      res.json({ message: 'Logged out successfully' });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ error: { message: 'Logout failed' } });
    }
  }
);

// Get current user
router.get(
  '/me',
  authenticate as any,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    res.json({ user: req.user });
  }
);

// Update current user
router.patch(
  '/me',
  authenticate as any,
  async (req: AuthenticatedRequest, res: Response): Promise<void | Response> => {
    try {
      const { name, avatar_url } = req.body as {
        name?: string;
        avatar_url?: string;
      };
      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (name) {
        updates.push(`name = $${paramIndex++}`);
        values.push(name);
      }

      if (avatar_url !== undefined) {
        updates.push(`avatar_url = $${paramIndex++}`);
        values.push(avatar_url);
      }

      if (updates.length === 0) {
        return res
          .status(400)
          .json({ error: { message: 'No updates provided' } });
      }

      values.push(req.user!.id);

      const result = await pool.query<AuthUser>(
        `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${paramIndex}
         RETURNING id, email, name, avatar_url, role, review_count`,
        values
      );

      res.json({ user: result.rows[0] });
    } catch (error) {
      console.error('Update user error:', error);
      res.status(500).json({ error: { message: 'Update failed' } });
    }
  }
);

// Change password
router.post(
  '/change-password',
  authenticate as any,
  async (req: AuthenticatedRequest, res: Response): Promise<void | Response> => {
    try {
      const { currentPassword, newPassword } = req.body as {
        currentPassword?: string;
        newPassword?: string;
      };

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          error: { message: 'Current and new password are required' },
        });
      }

      // Get current password hash
      const result = await pool.query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [req.user!.id]
      );

      const validPassword = await bcrypt.compare(
        currentPassword,
        result.rows[0].password_hash
      );
      if (!validPassword) {
        return res
          .status(401)
          .json({ error: { message: 'Current password is incorrect' } });
      }

      // Update password
      const newHash = await bcrypt.hash(newPassword, 10);
      await pool.query(
        'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
        [newHash, req.user!.id]
      );

      // Invalidate all sessions
      await sessions.destroyAllForUser(req.user!.id);

      res.json({ message: 'Password changed successfully. Please login again.' });
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({ error: { message: 'Password change failed' } });
    }
  }
);

export default router;
