/**
 * Authentication middleware for Express routes.
 *
 * Provides middleware functions to protect routes that require authentication
 * and to distinguish between regular users and administrators.
 */
import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.js';
import type { User } from '../types/index.js';

/**
 * Extends the Express Request interface to include user and session information.
 * This allows authenticated routes to access user data via req.user.
 */
declare global {
  namespace Express {
    interface Request {
      /** The authenticated user, if any. */
      user?: User;
      /** The session ID from the cookie, if present. */
      sessionId?: string;
    }
  }
}

/**
 * Middleware that requires a valid session.
 * Returns 401 Unauthorized if no valid session is found.
 *
 * @param req - Express request object.
 * @param res - Express response object.
 * @param next - Express next function.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const sessionId = req.cookies?.session;

  if (!sessionId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const user = await authService.validateSession(sessionId);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  req.user = user;
  req.sessionId = sessionId;
  next();
}

/**
 * Middleware that attaches user information if authenticated, but does not fail otherwise.
 * Useful for routes that work for both authenticated and anonymous users.
 *
 * @param req - Express request object.
 * @param res - Express response object.
 * @param next - Express next function.
 */
export async function optionalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const sessionId = req.cookies?.session;

  if (sessionId) {
    const user = await authService.validateSession(sessionId);
    if (user) {
      req.user = user;
      req.sessionId = sessionId;
    }
  }

  next();
}

/**
 * Middleware that requires admin role.
 * Must be used after authMiddleware. Returns 403 Forbidden if user is not an admin.
 *
 * @param req - Express request object (must have req.user set by authMiddleware).
 * @param res - Express response object.
 * @param next - Express next function.
 */
export async function adminMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
