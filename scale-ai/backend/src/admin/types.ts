/**
 * Shared types and interfaces for the admin service.
 * @module admin/types
 */

import type { Request, Response, NextFunction } from 'express'

/**
 * Session data attached to authenticated requests.
 */
export interface AdminSession {
  userId: string
  email: string
  name: string | null
}

/**
 * Express request with admin session attached.
 */
export interface AdminRequest extends Request {
  adminSession?: AdminSession
}

/**
 * Express route handler type for admin routes.
 */
export type AdminHandler = (
  req: AdminRequest,
  res: Response,
  next: NextFunction
) => void | Promise<void>

// Extend Express Request type globally
declare global {
  namespace Express {
    interface Request {
      adminSession?: AdminSession
    }
  }
}
