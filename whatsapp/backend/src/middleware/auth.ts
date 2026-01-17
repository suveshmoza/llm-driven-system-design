import { Request, Response, NextFunction } from 'express';

/**
 * Middleware that requires authentication.
 * Returns 401 Unauthorized if no session exists.
 * Used to protect API endpoints that require a logged-in user.
 * @param req - Express request object with session
 * @param res - Express response object
 * @param next - Next middleware function
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

/**
 * Middleware that allows both authenticated and unauthenticated requests.
 * Passes through without checking session, but session data is still available.
 * Used for endpoints that behave differently based on auth state.
 * @param req - Express request object with session
 * @param res - Express response object
 * @param next - Next middleware function
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  // Just continue - userId may or may not be set
  next();
}
