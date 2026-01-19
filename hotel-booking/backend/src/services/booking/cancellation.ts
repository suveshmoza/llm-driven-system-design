/**
 * Booking Cancellation Service
 *
 * Handles booking cancellation and expiry of stale reservations.
 */

import { query } from '../../models/db.js';
import { logger, bookingsCancelledTotal } from '../../shared/index.js';
import { invalidateAvailabilityCache } from './cache.js';
import { formatBooking } from './formatter.js';
import type { Booking, BookingRow } from './types.js';

/**
 * Cancel a booking
 */
export async function cancelBooking(
  bookingId: string,
  userId: string,
  reason: string = 'user_requested'
): Promise<Booking> {
  const result = await query<BookingRow>(
    `UPDATE bookings
     SET status = 'cancelled'
     WHERE id = $1 AND user_id = $2 AND status IN ('reserved', 'confirmed')
     RETURNING *`,
    [bookingId, userId]
  );

  if (result.rows.length === 0 || !result.rows[0]) {
    throw new Error('Booking not found or cannot be cancelled');
  }

  const booking = formatBooking(result.rows[0]);

  // Record metrics
  bookingsCancelledTotal.inc({ hotel_id: booking.hotelId, reason });

  // Invalidate availability cache
  await invalidateAvailabilityCache(
    booking.hotelId,
    booking.roomTypeId,
    booking.checkIn.toISOString().split('T')[0] ?? '',
    booking.checkOut.toISOString().split('T')[0] ?? ''
  );

  logger.info({ bookingId, reason }, 'Booking cancelled');

  return booking;
}

/**
 * Expire stale reservations (to be called by a background job)
 */
export async function expireStaleReservations(): Promise<number> {
  const result = await query<{ hotel_id: string; room_type_id: string; check_in: Date; check_out: Date }>(
    `UPDATE bookings
     SET status = 'expired'
     WHERE status = 'reserved' AND reserved_until < NOW()
     RETURNING hotel_id, room_type_id, check_in, check_out`
  );

  // Invalidate cache for expired reservations
  for (const row of result.rows) {
    await invalidateAvailabilityCache(
      row.hotel_id,
      row.room_type_id,
      row.check_in.toISOString().split('T')[0] ?? '',
      row.check_out.toISOString().split('T')[0] ?? ''
    );
  }

  if (result.rowCount && result.rowCount > 0) {
    logger.info({ count: result.rowCount }, 'Expired stale reservations');
  }

  return result.rowCount ?? 0;
}
