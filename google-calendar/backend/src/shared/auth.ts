import type { RequestHandler } from 'express'

declare module 'express-session' {
  interface SessionData {
    userId: number
    username: string
  }
}

/** Middleware that rejects unauthenticated requests with 401. */
export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}
