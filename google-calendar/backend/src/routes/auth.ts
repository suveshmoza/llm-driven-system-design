import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { pool } from '../shared/db.js'

const router = Router()

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password required' })
      return
    }

    const result = await pool.query(
      'SELECT id, username, email, password_hash, timezone FROM users WHERE username = $1',
      [username]
    )

    const user = result.rows[0]
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    req.session.userId = user.id
    req.session.username = user.username

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        timezone: user.timezone,
      },
    })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: 'Failed to logout' })
      return
    }
    res.clearCookie('connect.sid')
    res.json({ success: true })
  })
})

// Get current user
router.get('/me', (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  pool.query(
    'SELECT id, username, email, timezone FROM users WHERE id = $1',
    [req.session.userId]
  )
    .then(result => {
      if (result.rows.length === 0) {
        res.status(401).json({ error: 'User not found' })
        return
      }
      res.json({ user: result.rows[0] })
    })
    .catch(error => {
      console.error('Get user error:', error)
      res.status(500).json({ error: 'Internal server error' })
    })
})

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, timezone } = req.body

    if (!username || !email || !password) {
      res.status(400).json({ error: 'Username, email, and password required' })
      return
    }

    const passwordHash = await bcrypt.hash(password, 10)

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, timezone)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, timezone`,
      [username, email, passwordHash, timezone || 'UTC']
    )

    const user = result.rows[0]

    // Create default calendar
    await pool.query(
      `INSERT INTO calendars (user_id, name, color, is_primary)
       VALUES ($1, 'Personal', '#3B82F6', true)`,
      [user.id]
    )

    req.session.userId = user.id
    req.session.username = user.username

    res.status(201).json({ user })
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      res.status(409).json({ error: 'Username or email already exists' })
      return
    }
    console.error('Register error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
