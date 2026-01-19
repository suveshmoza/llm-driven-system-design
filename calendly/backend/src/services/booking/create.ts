/**
 * Booking creation logic with double-booking prevention and idempotency handling.
 */

import { pool } from '../../db/index.js';
import { type CreateBookingInput } from '../../types/index.js';
import { type Booking, type CreateBookingResult } from './types.js';
import { meetingTypeService } from '../meetingTypeService.js';
import { logger } from '../../shared/logger.js';
import {
  bookingCreationDuration,
  doubleBookingPrevented,
  emailNotificationsTotal,
  recordBookingOperation,
} from '../../shared/metrics.js';
import { v4 as uuidv4 } from 'uuid';
import { parseISO, addMinutes } from 'date-fns';
import {
  publishBookingConfirmation,
  scheduleReminders,
  sendConfirmationEmails,
} from './notifications.js';
import { invalidateAvailabilityCache, updateActiveBookingsGauge } from './slots.js';
import {
  checkBookingIdempotency,
  acquireBookingLock,
  storeBookingResult,
  releaseBookingLock,
} from './idempotency.js';

/**
 * Creates a new booking with double-booking prevention and idempotency handling.
 * @param input - Booking details including meeting type, time, and invitee info
 * @param idempotencyKey - Optional client-provided idempotency key
 * @returns The newly created booking or cached result
 * @throws Error if slot is unavailable, meeting type not found, or limit reached
 */
export async function createBooking(
  input: CreateBookingInput,
  idempotencyKey?: string
): Promise<CreateBookingResult> {
  const startTimer = Date.now();
  const bookingLogger = logger.child({
    operation: 'createBooking',
    meetingTypeId: input.meeting_type_id,
    startTime: input.start_time,
    inviteeEmail: input.invitee_email,
  });

  // Check for cached idempotent result
  const { cached, effectiveKey } = await checkBookingIdempotency(
    input.meeting_type_id,
    input.start_time,
    input.invitee_email,
    idempotencyKey
  );
  if (cached) return cached;

  // Acquire idempotency lock
  const lockResult = await acquireBookingLock(effectiveKey);
  if (!lockResult.lockAcquired) return lockResult.cached;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get and validate meeting type
    const meetingType = await meetingTypeService.findByIdWithUser(input.meeting_type_id);
    if (!meetingType) throw new Error('Meeting type not found');
    if (!meetingType.is_active) throw new Error('Meeting type is not active');

    const startTime = parseISO(input.start_time);
    const endTime = addMinutes(startTime, meetingType.duration_minutes);

    // Lock host's row to serialize concurrent booking attempts
    await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [meetingType.user_id]);

    // Check for overlapping bookings (including buffer times)
    const bufferStart = addMinutes(startTime, -meetingType.buffer_before_minutes);
    const bufferEnd = addMinutes(endTime, meetingType.buffer_after_minutes);

    const conflicts = await client.query(
      `SELECT id FROM bookings WHERE host_user_id = $1 AND status = 'confirmed'
       AND start_time < $2 AND end_time > $3`,
      [meetingType.user_id, bufferEnd.toISOString(), bufferStart.toISOString()]
    );

    if (conflicts.rows.length > 0) {
      doubleBookingPrevented.inc();
      recordBookingOperation('create', 'conflict');
      bookingLogger.warn('Double booking prevented - slot no longer available');
      throw new Error('Time slot is no longer available. Please select another time.');
    }

    // Check max bookings per day if set
    if (meetingType.max_bookings_per_day) {
      const dayStart = new Date(startTime);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(startTime);
      dayEnd.setHours(23, 59, 59, 999);

      const dayBookings = await client.query(
        `SELECT COUNT(*) as count FROM bookings WHERE meeting_type_id = $1
         AND status = 'confirmed' AND start_time >= $2 AND start_time <= $3`,
        [input.meeting_type_id, dayStart.toISOString(), dayEnd.toISOString()]
      );

      if (parseInt(dayBookings.rows[0].count) >= meetingType.max_bookings_per_day) {
        recordBookingOperation('create', 'failure');
        throw new Error('Maximum bookings for this day has been reached.');
      }
    }

    // Create the booking
    const id = uuidv4();
    const result = await client.query(
      `INSERT INTO bookings
       (id, meeting_type_id, host_user_id, invitee_name, invitee_email,
        start_time, end_time, invitee_timezone, status, notes, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', $9, $10) RETURNING *`,
      [id, input.meeting_type_id, meetingType.user_id, input.invitee_name,
       input.invitee_email, startTime.toISOString(), endTime.toISOString(),
       input.invitee_timezone, input.notes || null, effectiveKey]
    );

    await client.query('COMMIT');
    const booking = result.rows[0];

    // Record success metrics
    const duration = (Date.now() - startTimer) / 1000;
    bookingCreationDuration.observe({ status: 'success' }, duration);
    recordBookingOperation('create', 'success');

    // Store result for idempotency
    await storeBookingResult(effectiveKey, booking);

    // Invalidate cache and update gauges
    await invalidateAvailabilityCache(meetingType.user_id, input.meeting_type_id);
    await updateActiveBookingsGauge();

    // Async notifications (fire and forget with error logging)
    publishBookingConfirmation(booking, meetingType).catch((error) => {
      bookingLogger.error({ error }, 'Failed to publish booking notification');
    });
    scheduleReminders(booking).catch((error) => {
      bookingLogger.error({ error }, 'Failed to schedule reminders');
    });
    sendConfirmationEmails(booking, meetingType).catch((error) => {
      bookingLogger.error({ error }, 'Failed to send confirmation emails');
      emailNotificationsTotal.inc({ type: 'confirmation', status: 'failure' });
    });

    bookingLogger.info({ bookingId: booking.id, duration }, 'Booking created successfully');
    return { booking, cached: false };
  } catch (error) {
    await client.query('ROLLBACK');
    const duration = (Date.now() - startTimer) / 1000;
    bookingCreationDuration.observe({ status: 'failure' }, duration);
    bookingLogger.error({ error }, 'Failed to create booking');
    throw error;
  } finally {
    client.release();
    await releaseBookingLock(effectiveKey);
  }
}
