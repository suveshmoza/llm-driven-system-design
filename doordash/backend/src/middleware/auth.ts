import type { Request, Response, NextFunction } from 'express';
import { getSession, getUserById, User } from '../services/auth.js';

// Extend Express Request to include user property
declare global {
  namespace Express {
    interface Request {
      user?: User | null;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const sessionId = req.cookies?.session;

  if (!sessionId) {
    req.user = null;
    next();
    return;
  }

  try {
    const session = await getSession(sessionId);
    if (!session) {
      req.user = null;
      next();
      return;
    }

    const user = await getUserById(session.userId);
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    req.user = null;
    next();
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

export function requireRole(
  ...roles: string[]
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
