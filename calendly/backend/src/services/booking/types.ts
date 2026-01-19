/**
 * Shared types for the booking service modules.
 * Centralizes type definitions used across create, cancel, reschedule, and notification modules.
 */

import { type Booking, type BookingWithDetails, type DashboardStats } from '../../types/index.js';

/** Re-export core types from the main types module */
export { type Booking, type BookingWithDetails, type DashboardStats };

/**
 * Meeting type with user/host details.
 * Used when fetching meeting type info for booking operations.
 */
export interface MeetingTypeWithUser {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  max_bookings_per_day: number | null;
  is_active: boolean;
  user_name: string;
  user_email: string;
}

/**
 * Meeting details included when publishing notifications.
 */
export interface MeetingDetails {
  meeting_type_name: string;
  meeting_type_id: string;
  host_name: string;
  host_email: string;
}

/**
 * Result of a booking creation operation.
 */
export interface CreateBookingResult {
  booking: Booking;
  cached: boolean;
}

/**
 * Extended booking result from a query that includes
 * meeting type and buffer time information.
 */
export interface BookingWithMeetingDetails extends Booking {
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  meeting_type_name: string;
  meeting_type_id: string;
  host_name: string;
  host_email: string;
}
