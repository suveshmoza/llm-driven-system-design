/**
 * Available time slot computation logic.
 * Handles querying bookings for date ranges and fetching booking details.
 */

import { pool, redis } from '../../db/index.js';
import { type Booking, type BookingWithDetails, type DashboardStats } from './types.js';
import { activeBookingsGauge } from '../../shared/metrics.js';
import { logger } from '../../shared/logger.js';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';

/**
 * Retrieves a booking by its unique ID.
 * @param id - The UUID of the booking
 * @returns The booking if found, null otherwise
 */
export async function findById(id: string): Promise<Booking | null> {
  const result = await pool.query(
    `SELECT * FROM bookings WHERE id = $1`,
    [id]
  );

  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Retrieves a booking with full related entity details.
 * Includes meeting type name, duration, and host information.
 * @param id - The UUID of the booking
 * @returns Booking with details if found, null otherwise
 */
export async function findByIdWithDetails(id: string): Promise<BookingWithDetails | null> {
  const result = await pool.query(
    `SELECT b.*,
            mt.name as meeting_type_name,
            mt.duration_minutes as meeting_type_duration,
            u.name as host_name,
            u.email as host_email
     FROM bookings b
     JOIN meeting_types mt ON b.meeting_type_id = mt.id
     JOIN users u ON b.host_user_id = u.id
     WHERE b.id = $1`,
    [id]
  );

  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Retrieves all bookings for a host user with optional filtering.
 * Includes full booking details with meeting type and host info.
 * @param userId - The UUID of the host user
 * @param status - Optional status filter ('confirmed', 'cancelled', 'rescheduled')
 * @param upcoming - If true, only returns future bookings
 * @returns Array of bookings sorted by start time ascending
 */
export async function getBookingsForUser(
  userId: string,
  status?: string,
  upcoming: boolean = false
): Promise<BookingWithDetails[]> {
  let query = `
    SELECT b.*,
           mt.name as meeting_type_name,
           mt.duration_minutes as meeting_type_duration,
           u.name as host_name,
           u.email as host_email
    FROM bookings b
    JOIN meeting_types mt ON b.meeting_type_id = mt.id
    JOIN users u ON b.host_user_id = u.id
    WHERE b.host_user_id = $1
  `;
  const params: (string | Date)[] = [userId];
  let paramIndex = 2;

  if (status) {
    query += ` AND b.status = $${paramIndex++}`;
    params.push(status);
  }

  if (upcoming) {
    query += ` AND b.start_time > NOW()`;
  }

  query += ` ORDER BY b.start_time ASC`;

  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Retrieves confirmed bookings within a date range for availability calculation.
 * Used internally to determine busy periods when computing available slots.
 * @param userId - The UUID of the host user
 * @param startDate - Range start (inclusive)
 * @param endDate - Range end (inclusive)
 * @returns Array of confirmed bookings in the range
 */
export async function getBookingsForDateRange(
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<Booking[]> {
  const result = await pool.query(
    `SELECT * FROM bookings
     WHERE host_user_id = $1
       AND status = 'confirmed'
       AND start_time >= $2
       AND start_time <= $3
     ORDER BY start_time`,
    [userId, startDate.toISOString(), endDate.toISOString()]
  );

  return result.rows;
}

/**
 * Computes dashboard statistics for a host user.
 * Provides aggregated counts of bookings for display on the dashboard.
 * @param userId - The UUID of the host user
 * @returns Statistics including total, upcoming, and time-period counts
 */
export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const now = new Date();
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const [totalResult, upcomingResult, meetingTypesResult, weekResult, monthResult] =
    await Promise.all([
      pool.query(
        `SELECT COUNT(*) as count FROM bookings WHERE host_user_id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(*) as count FROM bookings
         WHERE host_user_id = $1 AND status = 'confirmed' AND start_time > NOW()`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(*) as count FROM meeting_types WHERE user_id = $1 AND is_active = true`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(*) as count FROM bookings
         WHERE host_user_id = $1 AND created_at >= $2 AND created_at <= $3`,
        [userId, weekStart.toISOString(), weekEnd.toISOString()]
      ),
      pool.query(
        `SELECT COUNT(*) as count FROM bookings
         WHERE host_user_id = $1 AND created_at >= $2 AND created_at <= $3`,
        [userId, monthStart.toISOString(), monthEnd.toISOString()]
      ),
    ]);

  return {
    total_bookings: parseInt(totalResult.rows[0].count),
    upcoming_bookings: parseInt(upcomingResult.rows[0].count),
    total_meeting_types: parseInt(meetingTypesResult.rows[0].count),
    bookings_this_week: parseInt(weekResult.rows[0].count),
    bookings_this_month: parseInt(monthResult.rows[0].count),
  };
}

/**
 * Updates the active bookings Prometheus gauge.
 * Called after booking creation or cancellation.
 */
export async function updateActiveBookingsGauge(): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM bookings
       WHERE status = 'confirmed' AND start_time > NOW()`
    );
    activeBookingsGauge.set(parseInt(result.rows[0].count));
  } catch (error) {
    logger.error({ error }, 'Failed to update active bookings gauge');
  }
}

/**
 * Clears cached availability slots when bookings change.
 * Ensures invitees see up-to-date availability.
 * @param userId - The UUID of the host user
 * @param meetingTypeId - The UUID of the affected meeting type
 */
export async function invalidateAvailabilityCache(
  userId: string,
  meetingTypeId: string
): Promise<void> {
  const keys = await redis.keys(`slots:${meetingTypeId}:*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}
