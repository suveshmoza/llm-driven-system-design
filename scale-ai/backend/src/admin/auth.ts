/**
 * Authentication routes for the admin service.
 * Handles login, logout, and session management.
 * @module admin/auth
 */

import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { validateLogin, createSession, getSession, deleteSession } from '../shared/auth.js'
import { logger, createChildLogger, logError } from '../shared/logger.js'

const router = Router()

/**
 * Authentication middleware that verifies the admin session cookie.
 * Attaches session data to req.adminSession on success.
 * Returns 401 if not authenticated or session expired.
 */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const sessionId = req.cookies.adminSession

  if (!sessionId) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  const session = await getSession(sessionId)
  if (!session) {
    res.status(401).json({ error: 'Session expired' })
    return
  }

  // Attach session to request
  req.adminSession = {
    userId: session.userId,
    email: session.email,
    name: session.name,
  }

  next()
}

/**
 * POST /api/admin/auth/login - Authenticates an admin user.
 * Creates a session and sets an httpOnly cookie.
 */
router.post('/login', async (req: Request, res: Response) => {
  const reqLogger = createChildLogger({ endpoint: '/api/admin/auth/login' })

  try {
    const { email, password, rememberMe } = req.body

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' })
      return
    }

    const user = await validateLogin(email, password)
    if (!user) {
      reqLogger.warn({ msg: 'Invalid login attempt', email })
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const { sessionId, ttl } = await createSession(user.id, user.email, user.name, rememberMe)

    res.cookie('adminSession', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: ttl * 1000, // Convert seconds to milliseconds
    })

    reqLogger.info({ msg: 'Admin login successful', email })

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    })
  } catch (error) {
    logError(error as Error, { endpoint: '/api/admin/auth/login' })
    res.status(500).json({ error: 'Login failed' })
  }
})

/**
 * POST /api/admin/auth/logout - Logs out the current admin user.
 * Clears the session from Redis and removes the cookie.
 */
router.post('/logout', async (req: Request, res: Response) => {
  const sessionId = req.cookies.adminSession

  if (sessionId) {
    await deleteSession(sessionId)
    logger.info({ msg: 'Admin logout', sessionId: sessionId.substring(0, 8) + '...' })
  }

  res.clearCookie('adminSession')
  res.json({ success: true })
})

/**
 * GET /api/admin/auth/me - Returns the current authenticated user.
 */
router.get('/me', requireAdmin, (req: Request, res: Response) => {
  res.json({ user: req.adminSession })
})

export { router as authRouter }
