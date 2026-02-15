import type { Request, Response, NextFunction } from 'express';
import logger from '../services/logger.js';

export interface SessionData {
  userId?: string;
  username?: string;
}

export interface AuthenticatedRequest extends Request {
  session: Request['session'] & SessionData;
}

/** Rejects unauthenticated requests with 401 if no valid session exists. */
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

/** Passes through all requests without requiring authentication. */
export const optionalAuth = (_req: Request, _res: Response, next: NextFunction): void => {
  next();
};

/** Attaches user context from session data to the request for downstream logging. */
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
