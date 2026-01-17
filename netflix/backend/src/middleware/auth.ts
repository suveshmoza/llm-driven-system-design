import { Request, Response, NextFunction } from 'express';
import { getSession, Session } from '../services/redis.js';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      session?: Session;
      accountId?: string;
      profileId?: string;
    }
  }
}

/**
 * Authentication middleware - validates session token from cookie.
 * Extracts session data from Redis and attaches account/profile info to the request.
 * Returns 401 if no valid session exists.
 *
 * @param req - Express request object (will be augmented with session data)
 * @param res - Express response object
 * @param next - Express next function
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.cookies?.session_token;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const session = await getSession(token);

  if (!session) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  req.session = session;
  req.accountId = session.accountId;
  req.profileId = session.profileId;

  next();
}

/**
 * Optional authentication middleware.
 * Sets session info if a valid token exists but does not require authentication.
 * Useful for endpoints that work for both authenticated and anonymous users.
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.cookies?.session_token;

  if (token) {
    const session = await getSession(token);
    if (session) {
      req.session = session;
      req.accountId = session.accountId;
      req.profileId = session.profileId;
    }
  }

  next();
}

/**
 * Middleware that requires a profile to be selected.
 * Should be used after authenticate() for endpoints that need profile-specific data
 * (e.g., viewing history, personalized recommendations).
 *
 * @param req - Express request object (must have session attached)
 * @param res - Express response object
 * @param next - Express next function
 */
export async function requireProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.profileId) {
    res.status(400).json({ error: 'Profile selection required' });
    return;
  }

  next();
}
