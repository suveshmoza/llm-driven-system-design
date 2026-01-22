import { Router } from 'express'
import { pool } from '../shared/db.js'
import { requireAuth } from '../shared/auth.js'

const router = Router()

// All routes require authentication
router.use(requireAuth)

// Get user's calendars
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, color, is_primary, created_at
       FROM calendars
       WHERE user_id = $1
       ORDER BY is_primary DESC, name`,
      [req.session.userId]
    )

    res.json({ calendars: result.rows })
  } catch (error) {
    console.error('Get calendars error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create calendar
router.post('/', async (req, res) => {
  try {
    const { name, color } = req.body

    if (!name) {
      res.status(400).json({ error: 'Calendar name required' })
      return
    }

    const result = await pool.query(
      `INSERT INTO calendars (user_id, name, color, is_primary)
       VALUES ($1, $2, $3, false)
       RETURNING id, name, color, is_primary, created_at`,
      [req.session.userId, name, color || '#3B82F6']
    )

    res.status(201).json({ calendar: result.rows[0] })
  } catch (error) {
    console.error('Create calendar error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update calendar
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { name, color } = req.body

    const result = await pool.query(
      `UPDATE calendars
       SET name = COALESCE($1, name),
           color = COALESCE($2, color)
       WHERE id = $3 AND user_id = $4
       RETURNING id, name, color, is_primary, created_at`,
      [name, color, id, req.session.userId]
    )

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Calendar not found' })
      return
    }

    res.json({ calendar: result.rows[0] })
  } catch (error) {
    console.error('Update calendar error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Delete calendar
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params

    // Prevent deleting primary calendar
    const checkResult = await pool.query(
      'SELECT is_primary FROM calendars WHERE id = $1 AND user_id = $2',
      [id, req.session.userId]
    )

    if (checkResult.rows.length === 0) {
      res.status(404).json({ error: 'Calendar not found' })
      return
    }

    if (checkResult.rows[0].is_primary) {
      res.status(400).json({ error: 'Cannot delete primary calendar' })
      return
    }

    await pool.query(
      'DELETE FROM calendars WHERE id = $1 AND user_id = $2',
      [id, req.session.userId]
    )

    res.json({ success: true })
  } catch (error) {
    console.error('Delete calendar error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
