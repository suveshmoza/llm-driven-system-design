/**
 * Booking Types
 *
 * Shared types and interfaces for booking-related operations.
 */

export interface CreateBookingData {
  hotelId: string;
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
  roomCount?: number;
  guestCount: number;
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  guestPhone?: string;
  specialRequests?: string;
}

export interface BookingTransactionData extends CreateBookingData {
  idempotencyKey: string;
}

export interface AvailabilityCheck {
  available: boolean;
  availableRooms: number;
  totalRooms: number;
  requestedRooms: number;
}

export interface CalendarDay {
  date: string;
  available: number;
  total: number;
  booked: number;
  price: number;
}

export interface Booking {
  id: string;
  userId: string;
  hotelId: string;
  roomTypeId: string;
  checkIn: Date;
  checkOut: Date;
  roomCount: number;
  guestCount: number;
  totalPrice: number;
  status: string;
  paymentId: string | null;
  reservedUntil: Date | null;
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  guestPhone: string | null;
  specialRequests: string | null;
  createdAt: Date;
  updatedAt: Date;
  deduplicated?: boolean;
}

export interface BookingWithDetails extends Booking {
  hotelName?: string;
  hotelAddress?: string;
  hotelCity?: string;
  hotelImages?: string[];
  roomTypeName?: string;
  userFirstName?: string;
  userLastName?: string;
  userEmail?: string;
}

export interface BookingRow {
  id: string;
  user_id: string;
  hotel_id: string;
  room_type_id: string;
  check_in: Date;
  check_out: Date;
  room_count: number;
  guest_count: number;
  total_price: string;
  status: string;
  payment_id: string | null;
  reserved_until: Date | null;
  guest_first_name: string;
  guest_last_name: string;
  guest_email: string;
  guest_phone: string | null;
  special_requests: string | null;
  idempotency_key: string;
  created_at: Date;
  updated_at: Date;
  hotel_name?: string;
  hotel_address?: string;
  hotel_city?: string;
  hotel_images?: string[];
  room_type_name?: string;
  first_name?: string;
  last_name?: string;
  user_email?: string;
}

export interface RoomTypeRow {
  id: string;
  total_count: number;
  base_price: string;
}

export interface BookingCountRow {
  check_in: Date;
  check_out: Date;
  room_count: number;
}

export interface PriceOverrideRow {
  date: Date;
  price: string;
}
