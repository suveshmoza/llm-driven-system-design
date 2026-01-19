/**
 * Booking Queries Service
 *
 * Handles booking retrieval operations.
 */

import { query } from '../../models/db.js';
import { formatBooking } from './formatter.js';
import type { BookingWithDetails, BookingRow } from './types.js';

/**
 * Get booking by ID
 */
export async function getBookingById(
  bookingId: string,
  userId: string | null = null
): Promise<BookingWithDetails | null> {
  let queryStr = `
    SELECT b.*, h.name as hotel_name, h.address as hotel_address, h.city as hotel_city,
           rt.name as room_type_name
    FROM bookings b
    JOIN hotels h ON b.hotel_id = h.id
    JOIN room_types rt ON b.room_type_id = rt.id
    WHERE b.id = $1
  `;
  const params: unknown[] = [bookingId];

  if (userId) {
    queryStr += ' AND b.user_id = $2';
    params.push(userId);
  }

  const result = await query<BookingRow>(queryStr, params);

  if (result.rows.length === 0 || !result.rows[0]) {
    return null;
  }

  const row = result.rows[0];
  return {
    ...formatBooking(row),
    hotelName: row.hotel_name,
    hotelAddress: row.hotel_address,
    hotelCity: row.hotel_city,
    roomTypeName: row.room_type_name,
  };
}

/**
 * Get bookings for a user
 */
export async function getBookingsByUser(
  userId: string,
  status: string | null = null
): Promise<BookingWithDetails[]> {
  let queryStr = `
    SELECT b.*, h.name as hotel_name, h.address as hotel_address, h.city as hotel_city,
           h.images as hotel_images, rt.name as room_type_name
    FROM bookings b
    JOIN hotels h ON b.hotel_id = h.id
    JOIN room_types rt ON b.room_type_id = rt.id
    WHERE b.user_id = $1
  `;
  const params: unknown[] = [userId];

  if (status) {
    queryStr += ' AND b.status = $2';
    params.push(status);
  }

  queryStr += ' ORDER BY b.created_at DESC';

  const result = await query<BookingRow>(queryStr, params);

  return result.rows.map((row) => ({
    ...formatBooking(row),
    hotelName: row.hotel_name,
    hotelAddress: row.hotel_address,
    hotelCity: row.hotel_city,
    hotelImages: row.hotel_images,
    roomTypeName: row.room_type_name,
  }));
}

/**
 * Get bookings for a hotel (for hotel admin)
 */
export async function getBookingsByHotel(
  hotelId: string,
  ownerId: string,
  status: string | null = null,
  startDate: string | null = null,
  endDate: string | null = null
): Promise<BookingWithDetails[]> {
  // Verify ownership
  const ownerCheck = await query<{ id: string }>(
    'SELECT id FROM hotels WHERE id = $1 AND owner_id = $2',
    [hotelId, ownerId]
  );

  if (ownerCheck.rows.length === 0) {
    throw new Error('Hotel not found or access denied');
  }

  let queryStr = `
    SELECT b.*, u.first_name, u.last_name, u.email as user_email,
           rt.name as room_type_name
    FROM bookings b
    JOIN users u ON b.user_id = u.id
    JOIN room_types rt ON b.room_type_id = rt.id
    WHERE b.hotel_id = $1
  `;
  const params: unknown[] = [hotelId];
  let paramIndex = 2;

  if (status) {
    queryStr += ` AND b.status = $${paramIndex}`;
    params.push(status);
    paramIndex++;
  }

  if (startDate) {
    queryStr += ` AND b.check_in >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }

  if (endDate) {
    queryStr += ` AND b.check_out <= $${paramIndex}`;
    params.push(endDate);
    paramIndex++;
  }

  queryStr += ' ORDER BY b.check_in ASC';

  const result = await query<BookingRow>(queryStr, params);

  return result.rows.map((row) => ({
    ...formatBooking(row),
    userFirstName: row.first_name,
    userLastName: row.last_name,
    userEmail: row.user_email,
    roomTypeName: row.room_type_name,
  }));
}
