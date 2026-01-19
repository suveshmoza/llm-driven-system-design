import express, { Request, Response, NextFunction, Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { requireAuth, ROLES } from '../middleware/auth.js';
import { createLogger, auditLog } from '../shared/logger.js';
import { getRateLimiters } from '../index.js';

const router: Router = express.Router();
const logger = createLogger('auth');

// User row type
interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  follower_count: number;
  following_count: number;
  video_count: number;
  like_count: number;
  role: string;
  created_at: string;
}

// Helper to get rate limiters (lazy load since they're initialized after session setup)
const getLimiters = () => getRateLimiters();

// Register
router.post('/register', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // Apply rate limiting
  const limiters = getLimiters();
  if (limiters?.register) {
    limiters.register(req, res, async () => {
      await handleRegister(req, res, next);
    });
    return;
  }
  await handleRegister(req, res, next);
});

async function handleRegister(req: Request, res: Response, _next: NextFunction): Promise<void> {
  try {
    const { username, email, password, displayName } = req.body as {
      username?: string;
      email?: string;
      password?: string;
      displayName?: string;
    };

    if (!username || !email || !password) {
      res.status(400).json({ error: 'Username, email, and password are required' });
      return;
    }

    // Validate password strength
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    // Check if user exists
    const existingUser = await query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existingUser.rows.length > 0) {
      logger.warn({ username, email }, 'Registration attempt with existing username/email');
      res.status(409).json({ error: 'Username or email already exists' });
      return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user with 'user' role by default
    const result = await query(
      `INSERT INTO users (username, email, password_hash, display_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, display_name, avatar_url, bio, follower_count, following_count, video_count, role, created_at`,
      [username, email, passwordHash, displayName || username, ROLES.USER]
    );

    const user = result.rows[0] as UserRow;

    // Create user embedding record
    await query('INSERT INTO user_embeddings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [
      user.id,
    ]);

    // Set session
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;

    // Audit log
    auditLog('user_registered', user.id, {
      username: user.username,
      email: user.email,
    });

    logger.info({ userId: user.id, username: user.username }, 'User registered successfully');

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        followerCount: user.follower_count,
        followingCount: user.following_count,
        videoCount: user.video_count,
        role: user.role,
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Registration error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Login
router.post('/login', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // Apply rate limiting
  const limiters = getLimiters();
  if (limiters?.login) {
    limiters.login(req, res, async () => {
      await handleLogin(req, res, next);
    });
    return;
  }
  await handleLogin(req, res, next);
});

async function handleLogin(req: Request, res: Response, _next: NextFunction): Promise<void> {
  try {
    const { username, password } = req.body as { username?: string; password?: string };

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    // Find user
    const result = await query(
      `SELECT id, username, email, password_hash, display_name, avatar_url, bio,
              follower_count, following_count, video_count, role, created_at
       FROM users WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      logger.warn({ username }, 'Login attempt for non-existent user');
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = result.rows[0] as UserRow;

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      logger.warn({ username, userId: user.id }, 'Login attempt with invalid password');
      auditLog('login_failed', user.id, { reason: 'invalid_password' });
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Set session
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role || ROLES.USER;

    // Audit log
    auditLog('user_login', user.id, {
      username: user.username,
      ip: req.ip,
    });

    logger.info({ userId: user.id, username: user.username }, 'User logged in successfully');

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        followerCount: user.follower_count,
        followingCount: user.following_count,
        videoCount: user.video_count,
        role: user.role || ROLES.USER,
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Login error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Logout
router.post('/logout', (req: Request, res: Response): void => {
  const userId = req.session?.userId;

  req.session.destroy((err: Error | null) => {
    if (err) {
      logger.error({ error: err.message }, 'Logout error');
      res.status(500).json({ error: 'Could not log out' });
      return;
    }

    if (userId) {
      auditLog('user_logout', userId, {});
      logger.info({ userId }, 'User logged out');
    }

    res.json({ message: 'Logged out successfully' });
  });
});

// Get current user
router.get('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(
      `SELECT id, username, email, display_name, avatar_url, bio,
              follower_count, following_count, video_count, like_count, role, created_at
       FROM users WHERE id = $1`,
      [req.session.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = result.rows[0] as UserRow;

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      bio: user.bio,
      followerCount: user.follower_count,
      followingCount: user.following_count,
      videoCount: user.video_count,
      likeCount: user.like_count,
      role: user.role || ROLES.USER,
      createdAt: user.created_at,
    });
  } catch (error) {
    logger.error({ error: (error as Error).message, userId: req.session.userId }, 'Get me error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upgrade to creator role (self-service)
router.post('/upgrade-to-creator', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session.userId;

    // Check current role
    const userResult = await query('SELECT role FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const currentRole = (userResult.rows[0] as { role: string }).role;
    if (currentRole !== ROLES.USER) {
      res.status(400).json({ error: 'Already a creator or higher role' });
      return;
    }

    // Upgrade to creator
    await query('UPDATE users SET role = $1 WHERE id = $2', [ROLES.CREATOR, userId]);
    req.session.role = ROLES.CREATOR;

    auditLog('role_upgrade', userId as number, {
      fromRole: currentRole,
      toRole: ROLES.CREATOR,
    });

    logger.info({ userId }, 'User upgraded to creator role');

    res.json({
      message: 'Upgraded to creator successfully',
      role: ROLES.CREATOR,
    });
  } catch (error) {
    logger.error(
      { error: (error as Error).message, userId: req.session.userId },
      'Upgrade to creator error'
    );
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
