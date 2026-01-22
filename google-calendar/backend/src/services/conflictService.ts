import { pool } from '../shared/db.js'

export interface ConflictingEvent {
  id: number
  title: string
  start_time: Date
  end_time: Date
  calendar_name: string
}

/**
 * Check for overlapping events across all user's calendars
 */
export async function checkConflicts(
  userId: number,
  start: Date,
  end: Date,
  excludeEventId?: number
): Promise<ConflictingEvent[]> {
  const result = await pool.query<ConflictingEvent>(
    `SELECT e.id, e.title, e.start_time, e.end_time, c.name as calendar_name
     FROM events e
     JOIN calendars c ON e.calendar_id = c.id
     WHERE c.user_id = $1
       AND e.id != COALESCE($4, 0)
       AND e.start_time < $3
       AND e.end_time > $2
       AND e.all_day = false
     ORDER BY e.start_time`,
    [userId, start, end, excludeEventId]
  )

  return result.rows
}
