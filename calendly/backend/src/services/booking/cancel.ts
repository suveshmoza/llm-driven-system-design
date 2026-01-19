/**
 * Booking cancellation logic.
 * Handles cancelling bookings with proper notification handling.
 */

import { pool } from '../../db/index.js';
import { type Booking } from './types.js';
import { logger } from '../../shared/logger.js';
import { emailNotificationsTotal, recordBookingOperation } from '../../shared/metrics.js';
import { publishCancellationNotification, sendCancellationEmail } from './notifications.js';
import { invalidateAvailabilityCache, updateActiveBookingsGauge } from './slots.js';

/**
 * Cancels a booking.
 * Frees up the time slot for new bookings.
 * Sends cancellation notification email after success.
 * @param id - The UUID of the booking to cancel
 * @param reason - Optional cancellation reason for the notification
 * @param userId - Optional user ID for ownership verification
 * @returns The cancelled booking
 * @throws Error if booking not found or already cancelled
 */
export async function cancelBooking(
  id: string,
  reason?: string,
  userId?: string
): Promise<Booking> {
  const cancelLogger = logger.child({ operation: 'cancel', bookingId: id });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get booking with lock and meeting type/host details
    const existingResult = await client.query(
      `SELECT b.*, mt.name as meeting_type_name, mt.id as meeting_type_id,
              u.name as host_name, u.email as host_email
       FROM bookings b
       JOIN meeting_types mt ON b.meeting_type_id = mt.id
       JOIN users u ON b.host_user_id = u.id
       WHERE b.id = $1
       FOR UPDATE`,
      [id]
    );

    if (existingResult.rows.length === 0) {
      throw new Error('Booking not found');
    }

    const existing = existingResult.rows[0];

    if (userId && existing.host_user_id !== userId) {
      throw new Error('Unauthorized to cancel this booking');
    }

    if (existing.status === 'cancelled') {
      throw new Error('Booking is already cancelled');
    }

    // Update the booking
    const result = await client.query(
      `UPDATE bookings
       SET status = 'cancelled', cancellation_reason = $1,
           updated_at = NOW(), version = version + 1
       WHERE id = $2
       RETURNING *`,
      [reason || null, id]
    );

    await client.query('COMMIT');

    const booking = result.rows[0];

    // Record success metric
    recordBookingOperation('cancel', 'success');

    // Invalidate cache
    await invalidateAvailabilityCache(existing.host_user_id, existing.meeting_type_id);

    // Update active bookings gauge
    await updateActiveBookingsGauge();

    // Publish cancellation notification to RabbitMQ
    publishCancellationNotification(booking, existing, reason).catch((error) => {
      cancelLogger.error({ error }, 'Failed to publish cancellation notification');
    });

    // Send cancellation notification (legacy path)
    sendCancellationEmail(booking, reason).catch((error) => {
      cancelLogger.error({ error }, 'Failed to send cancellation notification');
      emailNotificationsTotal.inc({ type: 'cancellation', status: 'failure' });
    });

    cancelLogger.info({ reason }, 'Booking cancelled successfully');

    return booking;
  } catch (error) {
    await client.query('ROLLBACK');
    cancelLogger.error({ error }, 'Failed to cancel booking');
    throw error;
  } finally {
    client.release();
  }
}
