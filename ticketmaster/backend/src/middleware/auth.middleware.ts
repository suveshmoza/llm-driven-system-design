/**
 * Authentication middleware for Express routes.
 * Provides session-based authentication using cookies and Redis.
 */
import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';

/**
 * Extended Express Request with authentication properties.
 * Populated by auth middleware when a valid session is present.
 */
export interface AuthenticatedRequest extends Request {
  /** The authenticated user's ID */
  userId?: string;
  /** The user's role ('user' or 'admin') */
  userRole?: string;
  /** The current session ID */
  sessionId?: string;
}

/**
 * Middleware that requires authentication.
 * Validates session from cookie or X-Session-Id header.
 * Returns 401 if no valid session is found.
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const sessionId = req.cookies?.session || req.headers['x-session-id'] as string;

  if (!sessionId) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  const session = await authService.validateSession(sessionId);
  if (!session) {
    res.status(401).json({ success: false, error: 'Invalid or expired session' });
    return;
  }

  req.userId = session.userId;
  req.userRole = session.role;
  req.sessionId = sessionId;

  next();
};

/**
 * Middleware that requires admin role.
 * Must be used after authMiddleware.
 * Returns 403 if user is not an admin.
 *
 * @param req - Express request object (must be authenticated)
 * @param res - Express response object
 * @param next - Express next function
 */
export const adminMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (req.userRole !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return;
  }
  next();
};

/**
 * Middleware that optionally authenticates.
 * Populates user info if session is valid, but allows unauthenticated access.
 * Useful for routes that work for both guests and logged-in users.
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const optionalAuthMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const sessionId = req.cookies?.session || req.headers['x-session-id'] as string;

  if (sessionId) {
    const session = await authService.validateSession(sessionId);
    if (session) {
      req.userId = session.userId;
      req.userRole = session.role;
      req.sessionId = sessionId;
    }
  }

  next();
};
