import { Request, Response, NextFunction } from 'express';
import redis from '../db/redis.js';
import { query } from '../db/index.js';

/**
 * Extended Express Request interface with authenticated user context.
 * Populated by authMiddleware after successful session validation.
 */
export interface AuthenticatedRequest extends Request {
  /** The authenticated user's unique identifier */
  userId?: string;
  /** The device ID if the user logged in from a specific device */
  deviceId?: string;
  /** The user's role for authorization checks */
  userRole?: 'user' | 'admin';
}

/**
 * Session authentication middleware.
 * Validates the X-Session-Id header against Redis session store.
 * Extends the session TTL on each successful request to implement
 * sliding window session expiration.
 *
 * @param req - Express request with X-Session-Id header
 * @param res - Express response
 * @param next - Next middleware function
 * @returns 401 if no session or invalid session, calls next() on success
 */
export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const sessionId = req.headers['x-session-id'] as string;

  if (!sessionId) {
    return res.status(401).json({ error: 'No session provided' });
  }

  try {
    const sessionData = await redis.get(`session:${sessionId}`);
    if (!sessionData) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    const session = JSON.parse(sessionData);
    req.userId = session.userId;
    req.deviceId = session.deviceId;
    req.userRole = session.role;

    // Refresh session TTL
    await redis.expire(`session:${sessionId}`, 3600);

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Admin role authorization middleware.
 * Must be used after authMiddleware to ensure user is authenticated.
 * Restricts endpoint access to users with admin role only.
 *
 * @param req - Authenticated request with userRole populated
 * @param res - Express response
 * @param next - Next middleware function
 * @returns 403 if user is not an admin, calls next() on success
 */
export async function adminMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * Biometric verification middleware for payment authorization.
 * Requires a valid, verified biometric session from the X-Biometric-Session header.
 * Sessions must be verified and not expired to pass this check.
 * This ensures payment operations are authorized by device biometrics.
 *
 * @param req - Authenticated request with X-Biometric-Session header
 * @param res - Express response
 * @param next - Next middleware function
 * @returns 401 if biometric session is missing, invalid, or expired
 */
export async function biometricMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const biometricSessionId = req.headers['x-biometric-session'] as string;

  if (!biometricSessionId) {
    return res.status(401).json({ error: 'Biometric verification required' });
  }

  try {
    const result = await query(
      `SELECT * FROM biometric_sessions
       WHERE id = $1 AND user_id = $2 AND status = 'verified'
       AND expires_at > NOW()`,
      [biometricSessionId, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired biometric session' });
    }

    next();
  } catch (error) {
    console.error('Biometric middleware error:', error);
    return res.status(500).json({ error: 'Biometric verification error' });
  }
}
