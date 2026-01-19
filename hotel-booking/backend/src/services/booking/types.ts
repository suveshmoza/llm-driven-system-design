/**
 * Booking Types
 *
 * Shared types and interfaces for booking-related operations.
 */

/**
 * @description Data required to create a new booking.
 * Contains all guest and reservation details needed for the booking process.
 */
export interface CreateBookingData {
  /** The unique identifier of the hotel */
  hotelId: string;
  /** The unique identifier of the room type being booked */
  roomTypeId: string;
  /** Check-in date in ISO format (YYYY-MM-DD) */
  checkIn: string;
  /** Check-out date in ISO format (YYYY-MM-DD) */
  checkOut: string;
  /** Number of rooms to book (defaults to 1) */
  roomCount?: number;
  /** Total number of guests staying */
  guestCount: number;
  /** First name of the primary guest */
  guestFirstName: string;
  /** Last name of the primary guest */
  guestLastName: string;
  /** Email address for booking confirmation */
  guestEmail: string;
  /** Optional phone number for the guest */
  guestPhone?: string;
  /** Optional special requests or notes for the hotel */
  specialRequests?: string;
}

/**
 * @description Extended booking data that includes an idempotency key.
 * Used internally during transaction processing to prevent duplicate bookings.
 */
export interface BookingTransactionData extends CreateBookingData {
  /** Unique key to ensure the booking is processed only once */
  idempotencyKey: string;
}

/**
 * @description Result of an availability check for a room type.
 * Provides information about whether the requested rooms are available.
 */
export interface AvailabilityCheck {
  /** Whether the requested number of rooms is available */
  available: boolean;
  /** Number of rooms currently available for the date range */
  availableRooms: number;
  /** Total number of rooms of this type in the hotel */
  totalRooms: number;
  /** Number of rooms requested by the user */
  requestedRooms: number;
}

/**
 * @description Represents a single day in the availability calendar.
 * Used for displaying availability and pricing information in the UI.
 */
export interface CalendarDay {
  /** Date in ISO format (YYYY-MM-DD) */
  date: string;
  /** Number of rooms available on this date */
  available: number;
  /** Total number of rooms of this type */
  total: number;
  /** Number of rooms already booked on this date */
  booked: number;
  /** Price per room per night for this date */
  price: number;
}

/**
 * @description Represents a booking entity with camelCase property names.
 * This is the application-level representation of a booking.
 */
export interface Booking {
  /** Unique booking identifier (UUID) */
  id: string;
  /** ID of the user who made the booking */
  userId: string;
  /** ID of the hotel being booked */
  hotelId: string;
  /** ID of the room type being booked */
  roomTypeId: string;
  /** Check-in date */
  checkIn: Date;
  /** Check-out date */
  checkOut: Date;
  /** Number of rooms booked */
  roomCount: number;
  /** Number of guests */
  guestCount: number;
  /** Total price for the entire stay */
  totalPrice: number;
  /** Booking status: 'reserved', 'confirmed', 'cancelled', or 'expired' */
  status: string;
  /** Payment transaction ID (null if unpaid) */
  paymentId: string | null;
  /** Expiration time for reserved bookings (null after confirmation) */
  reservedUntil: Date | null;
  /** Guest's first name */
  guestFirstName: string;
  /** Guest's last name */
  guestLastName: string;
  /** Guest's email address */
  guestEmail: string;
  /** Guest's phone number (optional) */
  guestPhone: string | null;
  /** Special requests or notes (optional) */
  specialRequests: string | null;
  /** When the booking was created */
  createdAt: Date;
  /** When the booking was last updated */
  updatedAt: Date;
  /** Flag indicating if this booking was returned from idempotency cache */
  deduplicated?: boolean;
}

/**
 * @description Extended booking with additional hotel, room type, and user details.
 * Used when displaying booking information with related entity data.
 */
export interface BookingWithDetails extends Booking {
  /** Name of the hotel */
  hotelName?: string;
  /** Street address of the hotel */
  hotelAddress?: string;
  /** City where the hotel is located */
  hotelCity?: string;
  /** Array of hotel image URLs */
  hotelImages?: string[];
  /** Name of the room type */
  roomTypeName?: string;
  /** First name of the user who booked */
  userFirstName?: string;
  /** Last name of the user who booked */
  userLastName?: string;
  /** Email of the user who booked */
  userEmail?: string;
}

/**
 * @description Database row representation of a booking.
 * Uses snake_case property names matching the PostgreSQL column names.
 */
export interface BookingRow {
  /** Unique booking identifier (UUID) */
  id: string;
  /** Foreign key to users table */
  user_id: string;
  /** Foreign key to hotels table */
  hotel_id: string;
  /** Foreign key to room_types table */
  room_type_id: string;
  /** Check-in date */
  check_in: Date;
  /** Check-out date */
  check_out: Date;
  /** Number of rooms booked */
  room_count: number;
  /** Number of guests */
  guest_count: number;
  /** Total price as string (PostgreSQL DECIMAL) */
  total_price: string;
  /** Booking status */
  status: string;
  /** Payment transaction ID */
  payment_id: string | null;
  /** Reservation expiration time */
  reserved_until: Date | null;
  /** Guest's first name */
  guest_first_name: string;
  /** Guest's last name */
  guest_last_name: string;
  /** Guest's email */
  guest_email: string;
  /** Guest's phone */
  guest_phone: string | null;
  /** Special requests */
  special_requests: string | null;
  /** Idempotency key for deduplication */
  idempotency_key: string;
  /** Creation timestamp */
  created_at: Date;
  /** Last update timestamp */
  updated_at: Date;
  /** Hotel name (from JOIN) */
  hotel_name?: string;
  /** Hotel address (from JOIN) */
  hotel_address?: string;
  /** Hotel city (from JOIN) */
  hotel_city?: string;
  /** Hotel images (from JOIN) */
  hotel_images?: string[];
  /** Room type name (from JOIN) */
  room_type_name?: string;
  /** User first name (from JOIN) */
  first_name?: string;
  /** User last name (from JOIN) */
  last_name?: string;
  /** User email (from JOIN) */
  user_email?: string;
}

/**
 * @description Database row representation of a room type.
 * Contains inventory and pricing information.
 */
export interface RoomTypeRow {
  /** Unique room type identifier (UUID) */
  id: string;
  /** Total number of rooms of this type available */
  total_count: number;
  /** Base price per night as string (PostgreSQL DECIMAL) */
  base_price: string;
}

/**
 * @description Database row for counting booked rooms.
 * Used in availability calculations.
 */
export interface BookingCountRow {
  /** Check-in date of the booking */
  check_in: Date;
  /** Check-out date of the booking */
  check_out: Date;
  /** Number of rooms in this booking */
  room_count: number;
}

/**
 * @description Database row for price overrides.
 * Used for dynamic pricing on specific dates.
 */
export interface PriceOverrideRow {
  /** Date for the price override */
  date: Date;
  /** Override price as string (PostgreSQL DECIMAL) */
  price: string;
}
