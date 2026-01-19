/**
 * Booking Service - Main export module.
 * Re-exports all booking-related functionality from sub-modules.
 *
 * This module provides backward-compatible exports for the BookingService class
 * and bookingService singleton, while internally delegating to focused sub-modules.
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
 * Handles the full booking lifecycle: creation, retrieval, rescheduling, and cancellation.
 * Implements double-booking prevention using PostgreSQL row-level locking and
 * optimistic concurrency control via version fields.
 *
 * Also implements idempotency to prevent duplicate bookings from network retries.
 *
 * Notifications are published to RabbitMQ for async processing by workers.
 */
export class BookingService {
  /**
   * Creates a new booking with double-booking prevention and idempotency handling.
   */
  async createBooking(
    input: CreateBookingInput,
    idempotencyKey?: string
  ): Promise<CreateBookingResult> {
    return createBooking(input, idempotencyKey);
  }

  /**
   * Retrieves a booking by its unique ID.
   */
  async findById(id: string): Promise<Booking | null> {
    return findById(id);
  }

  /**
   * Retrieves a booking with full related entity details.
   */
  async findByIdWithDetails(id: string): Promise<BookingWithDetails | null> {
    return findByIdWithDetails(id);
  }

  /**
   * Retrieves all bookings for a host user with optional filtering.
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
   */
  async getBookingsForDateRange(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Booking[]> {
    return getBookingsForDateRange(userId, startDate, endDate);
  }

  /**
   * Reschedules a booking to a new time.
   */
  async reschedule(
    id: string,
    newStartTime: string,
    userId?: string
  ): Promise<Booking> {
    return rescheduleBooking(id, newStartTime, userId);
  }

  /**
   * Cancels a booking.
   */
  async cancel(id: string, reason?: string, userId?: string): Promise<Booking> {
    return cancelBooking(id, reason, userId);
  }

  /**
   * Computes dashboard statistics for a host user.
   */
  async getDashboardStats(userId: string): Promise<DashboardStats> {
    return getDashboardStats(userId);
  }
}

/** Singleton instance of BookingService for application-wide use */
export const bookingService = new BookingService();
