import { Request, Response, NextFunction } from 'express';

// Extend Express Session to include our custom properties
declare module 'express-session' {
  interface SessionData {
    userId: number;
    role: string;
    shopIds: number[];
  }
}

/** Middleware that requires a valid session with userId before proceeding. */
export function isAuthenticated(req: Request, res: Response, next: NextFunction): Response | void {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.status(401).json({ error: 'Authentication required' });
}

/** Middleware that requires the authenticated user to have admin role. */
export function isAdmin(req: Request, res: Response, next: NextFunction): Response | void {
  if (req.session && req.session.role === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Admin access required' });
}

/** Middleware that verifies the authenticated user owns the shop being accessed. Must follow isAuthenticated. */
export function isShopOwner(req: Request, res: Response, next: NextFunction): Response | void {
  // This middleware checks if user owns the shop they're trying to access
  // It should be used after isAuthenticated
  const shopId = parseInt(req.params.shopId || req.body.shopId);
  if (req.session.shopIds && req.session.shopIds.includes(shopId)) {
    return next();
  }
  return res.status(403).json({ error: 'You do not own this shop' });
}
