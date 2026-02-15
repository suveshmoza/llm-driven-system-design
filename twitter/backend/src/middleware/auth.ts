import type { Request, Response, NextFunction } from 'express';

// Authentication middleware
/** Rejects unauthenticated requests with 401 if no active session exists. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

// Admin authorization middleware
/** Rejects non-admin users with 403 after verifying authentication. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (req.session.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

// Optional authentication - sets user info if logged in but doesn't require it
/** Passes through without blocking, allowing routes to optionally use session data. */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  // Session is already parsed, just continue
  next();
}
