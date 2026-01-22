import express from 'express'
import cors from 'cors'
import session from 'express-session'
import pgSession from 'connect-pg-simple'
import { pool } from '../shared/db.js'
import authRoutes from '../routes/auth.js'
import calendarRoutes from '../routes/calendars.js'
import eventRoutes from '../routes/events.js'

const PgSession = pgSession(session)

export const app = express()

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json())

// Session
app.use(session({
  store: new PgSession({
    pool,
    tableName: 'session',
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
}))

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/calendars', calendarRoutes)
app.use('/api/events', eventRoutes)

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})
