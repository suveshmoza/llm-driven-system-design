/**
 * @fileoverview Authentication middleware for protecting API routes.
 * Provides middleware functions for requiring authentication and workspace context.
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Express middleware that requires a valid user session.
 * Returns 401 if the request has no authenticated user.
 * Use this on routes that require login.
 * @param req - Express request object with session
 * @param res - Express response object
 * @param next - Express next function
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

/**
 * Express middleware that requires an active workspace context.
 * Returns 400 if no workspace is selected in the session.
 * Should be used after requireAuth on workspace-scoped routes.
 * @param req - Express request object with session
 * @param res - Express response object
 * @param next - Express next function
 */
export function requireWorkspace(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.workspaceId) {
    res.status(400).json({ error: 'Workspace context required. Please select a workspace.' });
    return;
  }
  next();
}
