import { Request, Response, NextFunction } from 'express';

// Augment express-session
declare module 'express-session' {
  interface SessionData {
    userId?: string;
    username?: string;
  }
}

/** Middleware that requires a valid session, rejecting unauthenticated requests with 401. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

/** Middleware that allows requests to proceed regardless of authentication status. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  // Session is automatically loaded by express-session
  // This middleware just ensures we continue even without auth
  next();
  void req;
}
