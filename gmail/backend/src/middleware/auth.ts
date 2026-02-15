import type { Request, Response, NextFunction } from 'express';
import logger from '../services/logger.js';

export interface AuthenticatedRequest extends Request {
  session: Request['session'] & {
    userId?: string;
    username?: string;
  };
}

/**
 * Require authentication middleware
 */
export const requireAuth = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Response | void => {
  if (!req.session || !req.session.userId) {
    logger.debug(
      {
        type: 'auth',
        result: 'denied',
        reason: 'not_authenticated',
        path: req.path,
        ip: req.ip,
      },
      'Authentication required'
    );
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};

/**
 * Attach user context middleware
 */
export const attachUserContext = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void => {
  next();
};

export default { requireAuth, attachUserContext };
