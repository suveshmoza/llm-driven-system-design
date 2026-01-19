/**
 * Booking Formatter
 *
 * Utility functions for formatting booking data.
 */

import type { Booking, BookingRow } from './types.js';

/**
 * @description Transforms a database booking row (snake_case) into an application booking object (camelCase).
 * This function handles the conversion of PostgreSQL column naming conventions to JavaScript/TypeScript
 * conventions, including parsing the total_price from string to number.
 *
 * @param {BookingRow} row - The raw database row from a PostgreSQL query result
 * @returns {Booking} The formatted booking object with camelCase properties
 *
 * @example
 * const row = await query<BookingRow>('SELECT * FROM bookings WHERE id = $1', [id]);
 * if (row.rows[0]) {
 *   const booking = formatBooking(row.rows[0]);
 *   console.log(booking.totalPrice); // number, not string
 * }
 */
export function formatBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    userId: row.user_id,
    hotelId: row.hotel_id,
    roomTypeId: row.room_type_id,
    checkIn: row.check_in,
    checkOut: row.check_out,
    roomCount: row.room_count,
    guestCount: row.guest_count,
    totalPrice: parseFloat(row.total_price),
    status: row.status,
    paymentId: row.payment_id,
    reservedUntil: row.reserved_until,
    guestFirstName: row.guest_first_name,
    guestLastName: row.guest_last_name,
    guestEmail: row.guest_email,
    guestPhone: row.guest_phone,
    specialRequests: row.special_requests,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
