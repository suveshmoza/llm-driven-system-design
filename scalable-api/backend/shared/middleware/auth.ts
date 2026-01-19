import type { Request, Response, NextFunction } from 'express';
import { query } from '../services/database.js';
import { CacheService } from '../services/cache.js';
import { UnauthorizedError, _ForbiddenError, hashString } from '../utils/index.js';
import config from '../config/index.js';
import type { ApiUser, AuthenticatedRequest } from '../types.js';

const cache = new CacheService();

interface OperationalError extends Error {
  isOperational?: boolean;
  statusCode?: number;
}

/**
 * Authentication middleware - verifies API key or session token
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const authHeader = req.headers['authorization'];
  const apiKey = req.headers['x-api-key'] as string | undefined;

  try {
    if (apiKey) {
      // API key authentication
      const user = await verifyApiKey(apiKey);
      authReq.user = user;
      authReq.authMethod = 'api-key';
    } else if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      // Bearer token authentication
      const token = authHeader.substring(7);
      const user = await verifyBearerToken(token);
      authReq.user = user;
      authReq.authMethod = 'bearer';
    } else {
      // Allow anonymous access with limited permissions
      authReq.user = null;
      authReq.authMethod = 'anonymous';
    }

    next();
  } catch (error) {
    const err = error as OperationalError;
    if (err.isOperational) {
      res.status(err.statusCode || 500).json({ error: err.message });
      return;
    }
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Require authentication middleware
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.user) {
    res.status(401).json({
      error: 'Authentication required',
      message: 'Please provide a valid API key or bearer token',
    });
    return;
  }
  next();
}

/**
 * Require admin role middleware
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (authReq.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

/**
 * Verify API key and return user info
 */
async function verifyApiKey(apiKey: string): Promise<ApiUser> {
  const keyHash = await hashString(apiKey);
  const cacheKey = `auth:apikey:${keyHash}`;

  // Check cache first
  const cached = await cache.get<ApiUser>(cacheKey);
  if (cached) {
    return cached;
  }

  // Query database
  const result = await query<{
    id: string;
    user_id: string;
    tier: ApiUser['tier'];
    scopes: string[];
    email: string;
    role: ApiUser['role'];
  }>(
    `SELECT ak.id, ak.user_id, ak.tier, ak.scopes, u.email, u.role
     FROM api_keys ak
     JOIN users u ON u.id = ak.user_id
     WHERE ak.key_hash = $1
       AND ak.revoked_at IS NULL
       AND (ak.expires_at IS NULL OR ak.expires_at > NOW())`,
    [keyHash]
  );

  if (result.rows.length === 0) {
    throw new UnauthorizedError('Invalid API key');
  }

  const row = result.rows[0]!;
  const user: ApiUser = {
    id: row['user_id'],
    email: row['email'],
    role: row['role'],
    tier: row['tier'],
    scopes: row['scopes'] || [],
    apiKeyId: row['id'],
  };

  // Update last used timestamp (fire and forget)
  query('UPDATE api_keys SET last_used = NOW() WHERE id = $1', [user.apiKeyId]).catch(() => {});

  // Cache for 5 minutes
  await cache.set(cacheKey, user, 300);

  return user;
}

/**
 * Verify bearer token (simple session-based auth)
 */
async function verifyBearerToken(token: string): Promise<ApiUser> {
  const cacheKey = `auth:session:${token}`;

  // Check cache (session store)
  const cached = await cache.get<ApiUser>(cacheKey);
  if (cached) {
    return cached;
  }

  // For development/demo: check admin token
  if (token === 'admin-token-dev') {
    return {
      id: 'admin-1',
      email: config.admin.email,
      role: 'admin',
      tier: 'enterprise',
      scopes: ['*'],
    };
  }

  throw new UnauthorizedError('Invalid or expired token');
}

/**
 * Login endpoint handler
 */
export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required' });
    return;
  }

  // Check admin credentials (for demo)
  if (email === config.admin.email && password === config.admin.password) {
    const token = 'admin-token-dev';
    const user: ApiUser = {
      id: 'admin-1',
      email: config.admin.email,
      role: 'admin',
      tier: 'enterprise',
      scopes: ['*'],
    };

    await cache.set(`auth:session:${token}`, user, 86400); // 24 hours

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
    return;
  }

  // Query database for user
  try {
    const result = await query<{
      id: string;
      email: string;
      password_hash: string;
      role: ApiUser['role'];
      tier: ApiUser['tier'];
    }>(
      `SELECT id, email, password_hash, role, tier
       FROM users
       WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const userRow = result.rows[0]!;

    // In production, use bcrypt.compare
    const passwordHash = await hashString(password);
    if (passwordHash !== userRow['password_hash']) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Create session token
    const token = await hashString(`${userRow['id']}:${Date.now()}:${Math.random()}`);
    const sessionUser: ApiUser = {
      id: userRow['id'],
      email: userRow['email'],
      role: userRow['role'],
      tier: userRow['tier'],
    };

    await cache.set(`auth:session:${token}`, sessionUser, 86400);

    res.json({
      token,
      user: sessionUser,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
}

/**
 * Logout endpoint handler
 */
export async function logout(req: Request, res: Response): Promise<void> {
  const authHeader = req.headers['authorization'];
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    await cache.delete(`auth:session:${token}`);
  }
  res.json({ message: 'Logged out successfully' });
}
