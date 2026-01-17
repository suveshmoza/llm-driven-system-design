/**
 * @fileoverview Authentication middleware for Express routes.
 * Provides optional, required, and admin-only authentication middleware.
 * Extracts user information from Bearer tokens or cookies.
 */

import type { Request, Response, NextFunction } from 'express';
import { validateSession } from '../services/authService.js';

/**
 * Extended Express Request with authentication properties.
 */
export interface AuthenticatedRequest extends Request {
  userId?: string;
  userRole?: string;
}

/**
 * Optional authentication middleware.
 * Sets userId and userRole on the request if a valid token is present.
 * Always calls next() - anonymous access is allowed.
 * @param req - Express request with potential auth token
 * @param res - Express response
 * @param next - Express next function
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;

  if (token) {
    try {
      const session = await validateSession(token);
      if (session) {
        req.userId = session.userId;
        req.userRole = session.role;
      }
    } catch (error) {
      // Token invalid, continue as anonymous
    }
  }

  next();
}

/**
 * Required authentication middleware.
 * Validates the session token and sets user info on the request.
 * Returns 401 if no token or invalid/expired session.
 * @param req - Express request with required auth token
 * @param res - Express response
 * @param next - Express next function
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const session = await validateSession(token);
    if (!session) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    req.userId = session.userId;
    req.userRole = session.role;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
}

/**
 * Admin-only authentication middleware.
 * Validates the session token and ensures the user has admin role.
 * Returns 401 if not authenticated, 403 if not an admin.
 * @param req - Express request with required admin auth token
 * @param res - Express response
 * @param next - Express next function
 */
export async function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const session = await validateSession(token);
    if (!session) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    if (session.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    req.userId = session.userId;
    req.userRole = session.role;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
}
