/**
 * Booking Service
 *
 * Main entry point that combines all booking-related modules.
 *
 * Handles all booking operations with:
 * - Idempotency to prevent double-booking
 * - Distributed locking for room selection
 * - Pessimistic database locking
 * - Metrics for monitoring and alerting
 * - Structured logging for debugging
 */

// Re-export all types
export type {
  CreateBookingData,
  BookingTransactionData,
  AvailabilityCheck,
  CalendarDay,
  Booking,
  BookingWithDetails,
  BookingRow,
  RoomTypeRow,
  BookingCountRow,
  PriceOverrideRow,
} from './types.js';

// Import functions from modules
import { checkAvailability, getAvailabilityCalendar } from './availability.js';
import { createBooking, executeBookingTransaction } from './reservation.js';
import { confirmBooking } from './confirmation.js';
import { cancelBooking, expireStaleReservations } from './cancellation.js';
import { getBookingById, getBookingsByUser, getBookingsByHotel } from './queries.js';
import { invalidateAvailabilityCache } from './cache.js';
import { formatBooking } from './formatter.js';

/**
 * Booking Service class that wraps all booking operations
 * Maintains backward compatibility with the original class-based interface
 */
class BookingService {
  checkAvailability = checkAvailability;
  getAvailabilityCalendar = getAvailabilityCalendar;
  createBooking = createBooking;
  _executeBookingTransaction = executeBookingTransaction;
  confirmBooking = confirmBooking;
  cancelBooking = cancelBooking;
  expireStaleReservations = expireStaleReservations;
  getBookingById = getBookingById;
  getBookingsByUser = getBookingsByUser;
  getBookingsByHotel = getBookingsByHotel;
  invalidateAvailabilityCache = invalidateAvailabilityCache;
  formatBooking = formatBooking;
}

export default new BookingService();

// Also export individual functions for direct imports
export {
  checkAvailability,
  getAvailabilityCalendar,
  createBooking,
  executeBookingTransaction,
  confirmBooking,
  cancelBooking,
  expireStaleReservations,
  getBookingById,
  getBookingsByUser,
  getBookingsByHotel,
  invalidateAvailabilityCache,
  formatBooking,
};
