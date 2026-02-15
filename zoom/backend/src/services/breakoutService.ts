import { pool } from './db.js';
import { logger } from './logger.js';

/** Creates multiple named breakout rooms for a meeting. */
export async function createBreakoutRooms(meetingId: string, rooms: { name: string }[]) {
  const results = [];
  for (const room of rooms) {
    const result = await pool.query(
      `INSERT INTO breakout_rooms (meeting_id, name) VALUES ($1, $2) RETURNING *`,
      [meetingId, room.name]
    );
    results.push(result.rows[0]);
  }
  logger.info({ meetingId, count: rooms.length }, 'Breakout rooms created');
  return results;
}

/** Assigns a participant to a breakout room, idempotent via ON CONFLICT. */
export async function assignParticipant(breakoutRoomId: string, participantId: string) {
  const result = await pool.query(
    `INSERT INTO breakout_assignments (breakout_room_id, participant_id)
     VALUES ($1, $2)
     ON CONFLICT (breakout_room_id, participant_id) DO NOTHING
     RETURNING *`,
    [breakoutRoomId, participantId]
  );
  return result.rows[0] || null;
}

/** Activates all breakout rooms for a meeting. */
export async function activateBreakoutRooms(meetingId: string) {
  await pool.query(
    `UPDATE breakout_rooms SET is_active = true WHERE meeting_id = $1`,
    [meetingId]
  );
  logger.info({ meetingId }, 'Breakout rooms activated');
}

/** Closes breakout rooms and returns all participants to the main room. */
export async function closeBreakoutRooms(meetingId: string) {
  await pool.query(
    `UPDATE breakout_rooms SET is_active = false WHERE meeting_id = $1`,
    [meetingId]
  );
  // Delete assignments when closing
  await pool.query(
    `DELETE FROM breakout_assignments
     WHERE breakout_room_id IN (SELECT id FROM breakout_rooms WHERE meeting_id = $1)`,
    [meetingId]
  );
  logger.info({ meetingId }, 'Breakout rooms closed, participants returned to main room');
}

/** Returns all breakout rooms for a meeting with their assigned participants. */
export async function getBreakoutRooms(meetingId: string) {
  const rooms = await pool.query(
    `SELECT * FROM breakout_rooms WHERE meeting_id = $1 ORDER BY created_at`,
    [meetingId]
  );

  const result = [];
  for (const room of rooms.rows) {
    const assignments = await pool.query(
      `SELECT ba.*, mp.user_id, mp.display_name
       FROM breakout_assignments ba
       JOIN meeting_participants mp ON ba.participant_id = mp.id
       WHERE ba.breakout_room_id = $1`,
      [room.id]
    );
    result.push({
      ...room,
      participants: assignments.rows,
    });
  }
  return result;
}

/** Permanently deletes all breakout rooms for a meeting. */
export async function deleteBreakoutRooms(meetingId: string) {
  await pool.query(
    `DELETE FROM breakout_rooms WHERE meeting_id = $1`,
    [meetingId]
  );
  logger.info({ meetingId }, 'Breakout rooms deleted');
}
