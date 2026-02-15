import bcrypt from 'bcrypt';
import { Request, Response, NextFunction } from 'express';
import { query } from '../db/index.js';
import redisClient from '../db/redis.js';
import { v4 as uuidv4 } from 'uuid';

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

export interface SessionUser {
  id: number;
  username: string;
  email: string;
  display_name: string;
  role: string;
  avatar_url: string | null;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: SessionUser | null;
      sessionId?: string;
      log?: {
        info: (data: object, msg?: string) => void;
        warn: (data: object, msg?: string) => void;
        error: (data: object, msg?: string) => void;
      };
    }
  }
}

// Auth middleware
/** Middleware that resolves session from header or cookie and attaches user context to request. */
export async function authMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const sessionId = req.headers['x-session-id'] as string | undefined || (req as Request & { cookies?: { sessionId?: string } }).cookies?.sessionId;

  if (!sessionId) {
    req.user = null;
    return next();
  }

  try {
    const sessionData = await redisClient.get(`session:${sessionId}`);
    if (sessionData) {
      req.user = JSON.parse(sessionData) as SessionUser;
      req.sessionId = sessionId;
    } else {
      req.user = null;
    }
  } catch (err) {
    console.error('Session lookup error:', err);
    req.user = null;
  }

  next();
}

// Require authentication middleware
/** Middleware that requires an authenticated session, rejecting unauthenticated requests with 401. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

// Require admin middleware
/** Middleware that requires admin role, rejecting non-admin users with 403. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

// Login handler
/** POST /api/auth/login - Authenticates a user with username/password and creates a Redis session. */
export async function login(req: Request, res: Response): Promise<void> {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  try {
    const result = await query(
      'SELECT id, username, email, password_hash, display_name, role, avatar_url FROM users WHERE username = $1 OR email = $1',
      [username]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = result.rows[0] as {
      id: number;
      username: string;
      email: string;
      password_hash: string;
      display_name: string;
      role: string;
      avatar_url: string | null;
    };
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Create session
    const sessionId = uuidv4();
    const sessionData: SessionUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      display_name: user.display_name,
      role: user.role,
      avatar_url: user.avatar_url,
    };

    await redisClient.setEx(`session:${sessionId}`, SESSION_TTL, JSON.stringify(sessionData));

    res.json({
      sessionId,
      user: sessionData,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
}

// Register handler
/** POST /api/auth/register - Creates a new user account with bcrypt-hashed password. */
export async function register(req: Request, res: Response): Promise<void> {
  const { username, email, password, displayName } = req.body as {
    username?: string;
    email?: string;
    password?: string;
    displayName?: string;
  };

  if (!username || !email || !password) {
    res.status(400).json({ error: 'Username, email, and password required' });
    return;
  }

  try {
    // Check if user exists
    const existing = await query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Username or email already exists' });
      return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const result = await query(
      `INSERT INTO users (username, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, display_name, role, avatar_url`,
      [username, email, passwordHash, displayName || username]
    );

    const user = result.rows[0] as {
      id: number;
      username: string;
      email: string;
      display_name: string;
      role: string;
      avatar_url: string | null;
    };

    // Create session
    const sessionId = uuidv4();
    const sessionData: SessionUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      display_name: user.display_name,
      role: user.role,
      avatar_url: user.avatar_url,
    };

    await redisClient.setEx(`session:${sessionId}`, SESSION_TTL, JSON.stringify(sessionData));

    res.status(201).json({
      sessionId,
      user: sessionData,
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
}

// Logout handler
/** POST /api/auth/logout - Destroys the current session from Redis. */
export async function logout(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers['x-session-id'] as string | undefined || req.sessionId;

  if (sessionId) {
    await redisClient.del(`session:${sessionId}`);
  }

  res.json({ success: true });
}

// Get current user
/** GET /api/auth/me - Returns the currently authenticated user from the session. */
export async function getCurrentUser(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  res.json({ user: req.user });
}
