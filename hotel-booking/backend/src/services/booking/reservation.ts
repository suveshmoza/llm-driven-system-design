/**
 * Reservation Service
 *
 * Handles booking creation with idempotency and distributed locking.
 *
 * WHY idempotency prevents double-charging:
 * - Network failures cause client retries
 * - Users may double-click submit buttons
 * - Without idempotency, retries create duplicate bookings
 * - Guest gets charged multiple times for same stay
 *
 * WHY distributed locking prevents overselling:
 * - Multiple API servers process booking requests simultaneously
 * - Pessimistic DB locks only work within single transaction
 * - Without distributed lock, concurrent requests see same availability
 * - Both could succeed, resulting in oversold room
 */

import { getClient } from '../../models/db.js';
import roomService from '../roomService.js';
import config from '../../config/index.js';
import {
  logger,
  generateIdempotencyKey,
  checkIdempotency,
  cacheIdempotencyResult,
  withLock,
  createRoomLockResource,
  bookingDurationSeconds,
  bookingsCreatedTotal,
  bookingRevenueTotal,
  idempotentRequestsTotal,
} from '../../shared/index.js';
import { invalidateAvailabilityCache } from './cache.js';
import { formatBooking } from './formatter.js';
import type { CreateBookingData, BookingTransactionData, Booking, BookingRow, RoomTypeRow } from './types.js';

/**
 * Create a booking with idempotency and distributed locking
 */
export async function createBooking(bookingData: CreateBookingData, userId: string): Promise<Booking> {
  const startTime = Date.now();
  const {
    hotelId,
    roomTypeId,
    checkIn,
    checkOut,
    roomCount = 1,
    guestCount,
    guestFirstName,
    guestLastName,
    guestEmail,
    guestPhone,
    specialRequests,
  } = bookingData;

  // Generate idempotency key from booking parameters
  const idempotencyKey = generateIdempotencyKey(userId, {
    hotelId,
    roomTypeId,
    checkIn,
    checkOut,
    roomCount,
  });

  // Check for existing booking with same idempotency key
  const existing = await checkIdempotency(idempotencyKey);
  if (existing) {
    logger.info(
      { idempotencyKey, bookingId: existing.id },
      'Returning existing booking (idempotent request)'
    );
    idempotentRequestsTotal.inc({ deduplicated: 'true' });
    return {
      ...formatBooking(existing as BookingRow),
      deduplicated: true,
    };
  }

  // Create distributed lock resource for this room type and dates
  const lockResource = createRoomLockResource(hotelId, roomTypeId, checkIn, checkOut);

  // Execute booking within distributed lock
  const booking = await withLock(
    lockResource,
    async () => {
      return executeBookingTransaction(
        {
          hotelId,
          roomTypeId,
          checkIn,
          checkOut,
          roomCount,
          guestCount,
          guestFirstName,
          guestLastName,
          guestEmail,
          guestPhone,
          specialRequests,
          idempotencyKey,
        },
        userId
      );
    },
    {
      ttlMs: 30000, // 30 second lock
      retryCount: 3,
      retryDelayMs: 100,
    }
  );

  // Cache idempotency result
  await cacheIdempotencyResult(idempotencyKey, booking as unknown as Record<string, unknown>);

  // Record metrics
  const durationSeconds = (Date.now() - startTime) / 1000;
  bookingDurationSeconds.observe(durationSeconds);
  bookingsCreatedTotal.inc({ status: 'reserved', hotel_id: hotelId });
  bookingRevenueTotal.inc(
    { hotel_id: hotelId, room_type_id: roomTypeId },
    Math.round(booking.totalPrice * 100) // Revenue in cents
  );

  logger.info(
    {
      bookingId: booking.id,
      hotelId,
      roomTypeId,
      checkIn,
      checkOut,
      totalPrice: booking.totalPrice,
      durationSeconds,
    },
    'Booking created successfully'
  );

  return booking;
}

/**
 * Execute the booking transaction with pessimistic locking
 * Called within a distributed lock for additional safety
 */
export async function executeBookingTransaction(
  bookingData: BookingTransactionData,
  userId: string
): Promise<Booking> {
  const {
    hotelId,
    roomTypeId,
    checkIn,
    checkOut,
    roomCount = 1,
    guestCount,
    guestFirstName,
    guestLastName,
    guestEmail,
    guestPhone,
    specialRequests,
    idempotencyKey,
  } = bookingData;

  const client = await getClient();

  try {
    await client.query('BEGIN');

    // Lock the room type row (pessimistic locking)
    await client.query(
      'SELECT id FROM room_types WHERE id = $1 AND hotel_id = $2 FOR UPDATE',
      [roomTypeId, hotelId]
    );

    // Get total rooms
    const roomResult = await client.query<RoomTypeRow>(
      'SELECT total_count, base_price FROM room_types WHERE id = $1 AND hotel_id = $2 AND is_active = true',
      [roomTypeId, hotelId]
    );

    if (roomResult.rows.length === 0 || !roomResult.rows[0]) {
      throw new Error('Room type not found');
    }

    const totalRooms = roomResult.rows[0].total_count;

    // Check availability with lock held
    const bookedResult = await client.query<{ max_booked: string }>(
      `SELECT COALESCE(MAX(daily_booked), 0) as max_booked
       FROM (
         SELECT d::date as date, COALESCE(SUM(b.room_count), 0) as daily_booked
         FROM generate_series($3::date, $4::date - 1, '1 day') d
         LEFT JOIN bookings b ON b.hotel_id = $1
           AND b.room_type_id = $2
           AND b.status IN ('reserved', 'confirmed')
           AND b.check_in <= d::date
           AND b.check_out > d::date
         GROUP BY d::date
       ) daily`,
      [hotelId, roomTypeId, checkIn, checkOut]
    );

    const maxBooked = parseInt(bookedResult.rows[0]?.max_booked ?? '0', 10);
    const availableRooms = totalRooms - maxBooked;

    if (availableRooms < roomCount) {
      throw new Error(`Only ${availableRooms} rooms available for the selected dates`);
    }

    // Calculate total price
    const priceInfo = await roomService.getPricesForRange(roomTypeId, checkIn, checkOut);
    const totalPrice = priceInfo.totalPrice * roomCount;

    // Set reservation expiry
    const reservedUntil = new Date(Date.now() + config.reservationHoldMinutes * 60 * 1000);

    // Create booking
    const bookingResult = await client.query<BookingRow>(
      `INSERT INTO bookings
       (user_id, hotel_id, room_type_id, check_in, check_out, room_count, guest_count,
        total_price, status, idempotency_key, reserved_until,
        guest_first_name, guest_last_name, guest_email, guest_phone, special_requests)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'reserved', $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        userId,
        hotelId,
        roomTypeId,
        checkIn,
        checkOut,
        roomCount,
        guestCount,
        totalPrice,
        idempotencyKey,
        reservedUntil,
        guestFirstName,
        guestLastName,
        guestEmail,
        guestPhone ?? null,
        specialRequests ?? null,
      ]
    );

    await client.query('COMMIT');

    const row = bookingResult.rows[0];
    if (!row) {
      throw new Error('Failed to create booking');
    }

    // Invalidate availability cache
    await invalidateAvailabilityCache(hotelId, roomTypeId, checkIn, checkOut);

    return formatBooking(row);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error, hotelId, roomTypeId }, 'Booking transaction failed');
    throw error;
  } finally {
    client.release();
  }
}
