/**
 * Booking Service - Main export module.
 *
 * @description Re-exports all booking-related functionality from sub-modules.
 * This module provides backward-compatible exports for the BookingService class
 * and bookingService singleton, while internally delegating to focused sub-modules.
 *
 * The booking service is responsible for the complete booking lifecycle:
 * - Creation with double-booking prevention and idempotency
 * - Retrieval with optional filtering
 * - Rescheduling with conflict detection
 * - Cancellation with notification handling
 * - Dashboard statistics computation
 *
 * @module services/booking
 */

import { type CreateBookingInput } from '../../types/index.js';
import { type Booking, type BookingWithDetails, type DashboardStats, type CreateBookingResult } from './types.js';
import { createBooking } from './create.js';
import { cancelBooking } from './cancel.js';
import { rescheduleBooking } from './reschedule.js';
import {
  findById,
  findByIdWithDetails,
  getBookingsForUser,
  getBookingsForDateRange,
  getDashboardStats,
} from './slots.js';

// Re-export types for consumers
export { type Booking, type BookingWithDetails, type DashboardStats, type CreateBookingResult } from './types.js';

/**
 * Service for managing bookings (scheduled meetings).
 *
 * @description Handles the full booking lifecycle: creation, retrieval, rescheduling,
 * and cancellation. Implements double-booking prevention using PostgreSQL row-level
 * locking and optimistic concurrency control via version fields.
 *
 * Key features:
 * - **Idempotency**: Prevents duplicate bookings from network retries
 * - **Double-booking Prevention**: Uses database locking to prevent race conditions
 * - **Buffer Times**: Respects meeting type buffer configurations
 * - **Notifications**: Publishes to RabbitMQ for async processing by workers
 *
 * @example
 * import { bookingService } from './services/booking/index.js';
 *
 * // Create a booking
 * const result = await bookingService.createBooking({
 *   meeting_type_id: 'uuid',
 *   start_time: '2024-01-15T14:00:00Z',
 *   invitee_name: 'Jane Doe',
 *   invitee_email: 'jane@example.com',
 *   invitee_timezone: 'America/New_York'
 * });
 *
 * // Retrieve bookings
 * const upcoming = await bookingService.getBookingsForUser(userId, 'confirmed', true);
 *
 * // Reschedule
 * await bookingService.reschedule(bookingId, '2024-01-16T10:00:00Z');
 *
 * // Cancel
 * await bookingService.cancel(bookingId, 'Schedule conflict');
 */
export class BookingService {
  /**
   * Creates a new booking with double-booking prevention and idempotency handling.
   *
   * @param {CreateBookingInput} input - Booking details including meeting type, time, and invitee info
   * @param {string} [idempotencyKey] - Optional client-provided idempotency key
   * @returns {Promise<CreateBookingResult>} The created or cached booking
   * @throws {Error} If slot unavailable, meeting type not found, or limit reached
   * @see {@link createBooking} for full documentation
   */
  async createBooking(
    input: CreateBookingInput,
    idempotencyKey?: string
  ): Promise<CreateBookingResult> {
    return createBooking(input, idempotencyKey);
  }

  /**
   * Retrieves a booking by its unique ID.
   *
   * @param {string} id - The UUID of the booking to retrieve
   * @returns {Promise<Booking | null>} The booking if found, null otherwise
   */
  async findById(id: string): Promise<Booking | null> {
    return findById(id);
  }

  /**
   * Retrieves a booking with full related entity details.
   *
   * @param {string} id - The UUID of the booking to retrieve
   * @returns {Promise<BookingWithDetails | null>} Booking with meeting type and host details if found
   */
  async findByIdWithDetails(id: string): Promise<BookingWithDetails | null> {
    return findByIdWithDetails(id);
  }

  /**
   * Retrieves all bookings for a host user with optional filtering.
   *
   * @param {string} userId - The UUID of the host user
   * @param {string} [status] - Optional status filter ('confirmed', 'cancelled', 'rescheduled')
   * @param {boolean} [upcoming] - If true, only returns future bookings
   * @returns {Promise<BookingWithDetails[]>} Array of bookings sorted by start time ascending
   */
  async getBookingsForUser(
    userId: string,
    status?: string,
    upcoming?: boolean
  ): Promise<BookingWithDetails[]> {
    return getBookingsForUser(userId, status, upcoming);
  }

  /**
   * Retrieves confirmed bookings within a date range for availability calculation.
   *
   * @param {string} userId - The UUID of the host user
   * @param {Date} startDate - Range start (inclusive)
   * @param {Date} endDate - Range end (inclusive)
   * @returns {Promise<Booking[]>} Array of confirmed bookings in the range
   */
  async getBookingsForDateRange(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Booking[]> {
    return getBookingsForDateRange(userId, startDate, endDate);
  }

  /**
   * Reschedules a booking to a new time slot.
   *
   * @param {string} id - The UUID of the booking to reschedule
   * @param {string} newStartTime - New start time in ISO 8601 format
   * @param {string} [userId] - Optional user ID for ownership verification
   * @returns {Promise<Booking>} The updated booking with new times
   * @throws {Error} If booking not found, cancelled, or new slot unavailable
   */
  async reschedule(
    id: string,
    newStartTime: string,
    userId?: string
  ): Promise<Booking> {
    return rescheduleBooking(id, newStartTime, userId);
  }

  /**
   * Cancels a booking and frees up the time slot.
   *
   * @param {string} id - The UUID of the booking to cancel
   * @param {string} [reason] - Optional cancellation reason for notifications
   * @param {string} [userId] - Optional user ID for ownership verification
   * @returns {Promise<Booking>} The cancelled booking with updated status
   * @throws {Error} If booking not found or already cancelled
   */
  async cancel(id: string, reason?: string, userId?: string): Promise<Booking> {
    return cancelBooking(id, reason, userId);
  }

  /**
   * Computes dashboard statistics for a host user.
   *
   * @param {string} userId - The UUID of the host user
   * @returns {Promise<DashboardStats>} Aggregated booking statistics for the dashboard
   */
  async getDashboardStats(userId: string): Promise<DashboardStats> {
    return getDashboardStats(userId);
  }
}

/**
 * Singleton instance of BookingService for application-wide use.
 *
 * @description Pre-instantiated BookingService that should be imported and used
 * throughout the application. Provides a consistent interface for all booking
 * operations.
 *
 * @example
 * import { bookingService } from './services/booking/index.js';
 * const booking = await bookingService.findById(bookingId);
 */
export const bookingService = new BookingService();
