import { Request, Response, NextFunction } from 'express';
import { getSession } from '../services/redis.js';
import { query } from '../services/database.js';

// Extend Express Request to include user and sessionId
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        email: string;
        name: string;
        role: 'user' | 'admin' | 'seller';
      } | null;
      sessionId?: string;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessionId = (req.headers['x-session-id'] as string) || req.headers.authorization?.replace('Bearer ', '');

    if (!sessionId) {
      req.user = null;
      return next();
    }

    const session = await getSession(sessionId);
    if (!session) {
      req.user = null;
      return next();
    }

    // Get fresh user data
    const result = await query(
      'SELECT id, email, name, role FROM users WHERE id = $1',
      [session.userId]
    );

    if (result.rows.length === 0) {
      req.user = null;
      return next();
    }

    const row = result.rows[0];
    req.user = {
      id: row.id as number,
      email: row.email as string,
      name: row.name as string,
      role: row.role as 'user' | 'admin' | 'seller'
    };
    req.sessionId = sessionId;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    req.user = null;
    next();
  }
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

export function requireSeller(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (req.user.role !== 'seller' && req.user.role !== 'admin') {
    res.status(403).json({ error: 'Seller access required' });
    return;
  }
  next();
}
