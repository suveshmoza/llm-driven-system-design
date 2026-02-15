import { Request, Response, NextFunction } from 'express';
import { getSession } from '../services/redis.js';
import { query } from '../services/database.js';

/** Middleware that requires a valid session cookie, rejecting unauthenticated requests with 401. */
async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const sessionId = req.cookies.session as string | undefined;

  if (!sessionId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const userId = await getSession(sessionId);
  if (!userId) {
    res.clearCookie('session');
    res.status(401).json({ error: 'Session expired' });
    return;
  }

  req.userId = userId;
  next();
}

/** Middleware that requires admin role, rejecting non-admin users with 403. */
async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const sessionId = req.cookies.session as string | undefined;

  if (!sessionId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const userId = await getSession(sessionId);
  if (!userId) {
    res.clearCookie('session');
    res.status(401).json({ error: 'Session expired' });
    return;
  }

  const result = await query<{ role: string }>('SELECT role FROM users WHERE id = $1', [userId]);
  if (result.rows.length === 0 || result.rows[0].role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  req.userId = userId;
  req.userRole = 'admin';
  next();
}

/** Middleware that attaches userId to request if a valid session exists, without blocking. */
async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const sessionId = req.cookies.session as string | undefined;

  if (sessionId) {
    const userId = await getSession(sessionId);
    if (userId) {
      req.userId = userId;
    }
  }

  next();
}

export {
  requireAuth,
  requireAdmin,
  optionalAuth
};
