import type { Request, Response, NextFunction } from 'express';
import logger from '../services/logger.js';

export interface SessionData {
  userId?: string;
  username?: string;
}

export interface AuthenticatedRequest extends Request {
  session: Request['session'] & SessionData;
}

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

export const optionalAuth = (_req: Request, _res: Response, next: NextFunction): void => {
  next();
};

export const attachUserContext = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void => {
  if (req.session?.userId) {
    // Session data is already available
  }
  next();
};

export default {
  requireAuth,
  optionalAuth,
  attachUserContext,
};
