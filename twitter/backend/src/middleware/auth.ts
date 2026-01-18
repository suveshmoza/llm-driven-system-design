import type { Request, Response, NextFunction } from 'express';

// Authentication middleware
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

// Admin authorization middleware
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
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  // Session is already parsed, just continue
  next();
}
