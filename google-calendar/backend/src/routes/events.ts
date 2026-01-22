import { Router } from 'express'
import { pool } from '../shared/db.js'
import { requireAuth } from '../shared/auth.js'
import { checkConflicts } from '../services/conflictService.js'

const router = Router()

// All routes require authentication
router.use(requireAuth)

// Get events in date range
router.get('/', async (req, res) => {
  try {
    const { start, end, calendarId } = req.query

    if (!start || !end) {
      res.status(400).json({ error: 'Start and end dates required' })
      return
    }

    let query = `
      SELECT e.id, e.calendar_id, e.title, e.description, e.location,
             e.start_time, e.end_time, e.all_day,
             COALESCE(e.color, c.color) as color,
             e.recurrence_rule, e.created_at, e.updated_at,
             c.name as calendar_name
      FROM events e
      JOIN calendars c ON e.calendar_id = c.id
      WHERE c.user_id = $1
        AND e.start_time < $3
        AND e.end_time > $2
    `
    const params: (string | number)[] = [req.session.userId!, start as string, end as string]

    if (calendarId) {
      query += ' AND e.calendar_id = $4'
      params.push(calendarId as string)
    }

    query += ' ORDER BY e.start_time'

    const result = await pool.query(query, params)

    res.json({ events: result.rows })
  } catch (error) {
    console.error('Get events error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get single event
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params

    const result = await pool.query(
      `SELECT e.*, COALESCE(e.color, c.color) as color, c.name as calendar_name
       FROM events e
       JOIN calendars c ON e.calendar_id = c.id
       WHERE e.id = $1 AND c.user_id = $2`,
      [id, req.session.userId]
    )

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Event not found' })
      return
    }

    res.json({ event: result.rows[0] })
  } catch (error) {
    console.error('Get event error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Check conflicts for an event
router.get('/:id/conflicts', async (req, res) => {
  try {
    const { id } = req.params

    // Get the event
    const eventResult = await pool.query(
      `SELECT e.calendar_id, e.start_time, e.end_time
       FROM events e
       JOIN calendars c ON e.calendar_id = c.id
       WHERE e.id = $1 AND c.user_id = $2`,
      [id, req.session.userId]
    )

    if (eventResult.rows.length === 0) {
      res.status(404).json({ error: 'Event not found' })
      return
    }

    const event = eventResult.rows[0]
    const conflicts = await checkConflicts(
      req.session.userId!,
      new Date(event.start_time),
      new Date(event.end_time),
      parseInt(id)
    )

    res.json({ conflicts })
  } catch (error) {
    console.error('Check conflicts error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create event
router.post('/', async (req, res) => {
  try {
    const { calendarId, title, description, location, startTime, endTime, allDay, color } = req.body

    if (!calendarId || !title || !startTime || !endTime) {
      res.status(400).json({ error: 'Calendar ID, title, start time, and end time required' })
      return
    }

    // Verify calendar belongs to user
    const calendarCheck = await pool.query(
      'SELECT id FROM calendars WHERE id = $1 AND user_id = $2',
      [calendarId, req.session.userId]
    )

    if (calendarCheck.rows.length === 0) {
      res.status(404).json({ error: 'Calendar not found' })
      return
    }

    // Check for conflicts
    const conflicts = await checkConflicts(
      req.session.userId!,
      new Date(startTime),
      new Date(endTime)
    )

    const result = await pool.query(
      `INSERT INTO events (calendar_id, title, description, location, start_time, end_time, all_day, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [calendarId, title, description, location, startTime, endTime, allDay || false, color]
    )

    res.status(201).json({
      event: result.rows[0],
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    })
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('valid_time_range')) {
      res.status(400).json({ error: 'End time must be after start time' })
      return
    }
    console.error('Create event error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update event
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { calendarId, title, description, location, startTime, endTime, allDay, color } = req.body

    // Verify event belongs to user
    const eventCheck = await pool.query(
      `SELECT e.id FROM events e
       JOIN calendars c ON e.calendar_id = c.id
       WHERE e.id = $1 AND c.user_id = $2`,
      [id, req.session.userId]
    )

    if (eventCheck.rows.length === 0) {
      res.status(404).json({ error: 'Event not found' })
      return
    }

    // If changing calendar, verify new calendar belongs to user
    if (calendarId) {
      const calendarCheck = await pool.query(
        'SELECT id FROM calendars WHERE id = $1 AND user_id = $2',
        [calendarId, req.session.userId]
      )
      if (calendarCheck.rows.length === 0) {
        res.status(404).json({ error: 'Calendar not found' })
        return
      }
    }

    const result = await pool.query(
      `UPDATE events
       SET calendar_id = COALESCE($1, calendar_id),
           title = COALESCE($2, title),
           description = COALESCE($3, description),
           location = COALESCE($4, location),
           start_time = COALESCE($5, start_time),
           end_time = COALESCE($6, end_time),
           all_day = COALESCE($7, all_day),
           color = $8
       WHERE id = $9
       RETURNING *`,
      [calendarId, title, description, location, startTime, endTime, allDay, color, id]
    )

    // Check for conflicts with updated times
    const event = result.rows[0]
    const conflicts = await checkConflicts(
      req.session.userId!,
      new Date(event.start_time),
      new Date(event.end_time),
      parseInt(id)
    )

    res.json({
      event,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    })
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('valid_time_range')) {
      res.status(400).json({ error: 'End time must be after start time' })
      return
    }
    console.error('Update event error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Delete event
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params

    const result = await pool.query(
      `DELETE FROM events
       WHERE id = $1
         AND calendar_id IN (SELECT id FROM calendars WHERE user_id = $2)
       RETURNING id`,
      [id, req.session.userId]
    )

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Event not found' })
      return
    }

    res.json({ success: true })
  } catch (error) {
    console.error('Delete event error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
