import type { Request, Response, NextFunction } from 'express';
import { pool, redis } from '../db.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
  storageQuota: number;
  storageUsed: number;
}

// Extend Express Request to include user and deviceId
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      deviceId?: string;
    }
  }
}

interface SessionData {
  user: AuthenticatedUser;
  deviceId: string;
}

// Verify session token
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const token = req.cookies.session_token || authHeader?.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Check Redis cache first
    const cachedSession = await redis.get(`session:${token}`);

    if (cachedSession) {
      const session: SessionData = JSON.parse(cachedSession);
      req.user = session.user;
      req.deviceId = session.deviceId;
      next();
      return;
    }

    // Check database
    const result = await pool.query(
      `SELECT s.*, u.id as user_id, u.email, u.role, u.storage_quota, u.storage_used
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token = $1 AND s.expires_at > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    const session = result.rows[0];

    req.user = {
      id: session.user_id,
      email: session.email,
      role: session.role,
      storageQuota: session.storage_quota,
      storageUsed: session.storage_used,
    };
    req.deviceId = session.device_id;

    // Cache session in Redis (expire in 5 minutes)
    await redis.setex(
      `session:${token}`,
      300,
      JSON.stringify({ user: req.user, deviceId: req.deviceId })
    );

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
}

// Check if user is admin
export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
