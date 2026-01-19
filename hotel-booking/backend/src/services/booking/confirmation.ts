/**
 * Booking Confirmation Service
 *
 * Handles booking confirmation after payment.
 */

import { query } from '../../models/db.js';
import { logger, bookingsConfirmedTotal } from '../../shared/index.js';
import { invalidateAvailabilityCache } from './cache.js';
import { formatBooking } from './formatter.js';
import type { Booking, BookingRow } from './types.js';

/**
 * Confirm a booking (after payment)
 */
export async function confirmBooking(
  bookingId: string,
  userId: string,
  paymentId: string | null = null
): Promise<Booking> {
  const result = await query<BookingRow>(
    `UPDATE bookings
     SET status = 'confirmed', payment_id = $3
     WHERE id = $1 AND user_id = $2 AND status = 'reserved'
     RETURNING *`,
    [bookingId, userId, paymentId]
  );

  if (result.rows.length === 0 || !result.rows[0]) {
    throw new Error('Booking not found or cannot be confirmed');
  }

  const booking = formatBooking(result.rows[0]);

  // Record metrics
  bookingsConfirmedTotal.inc({ hotel_id: booking.hotelId });

  // Invalidate availability cache
  await invalidateAvailabilityCache(
    booking.hotelId,
    booking.roomTypeId,
    booking.checkIn.toISOString().split('T')[0] ?? '',
    booking.checkOut.toISOString().split('T')[0] ?? ''
  );

  logger.info({ bookingId, paymentId }, 'Booking confirmed');

  return booking;
}
