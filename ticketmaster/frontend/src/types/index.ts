/**
 * Type definitions for the Ticketmaster frontend.
 * These types mirror the backend API responses and define the client-side data model.
 */

/**
 * Represents an authenticated user's profile.
 */
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
}

/**
 * Represents a physical venue where events are held.
 */
export interface Venue {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string | null;
  country: string;
  capacity: number;
  image_url: string | null;
}

/**
 * Represents an event with full venue details.
 */
export interface Event {
  id: string;
  name: string;
  description: string | null;
  venue_id: string;
  artist: string | null;
  category: 'concert' | 'sports' | 'theater' | 'comedy' | 'other';
  event_date: string;
  on_sale_date: string;
  status: 'upcoming' | 'on_sale' | 'sold_out' | 'cancelled' | 'completed';
  total_capacity: number;
  available_seats: number;
  image_url: string | null;
  waiting_room_enabled: boolean;
  max_concurrent_shoppers: number;
  max_tickets_per_user: number;
  venue: Venue;
}

/**
 * Represents a single seat displayed in the seat map.
 */
export interface Seat {
  id: string;
  row: string;
  seat_number: string;
  price: number;
  price_tier: 'vip' | 'premium' | 'standard' | 'economy';
  status: 'available' | 'held' | 'sold';
}

/**
 * Aggregated availability data for a venue section.
 */
export interface SectionAvailability {
  section: string;
  available: number;
  total: number;
  min_price: number;
  max_price: number;
  seats: Seat[];
}

/**
 * Active seat reservation during checkout.
 */
export interface Reservation {
  event_id: string;
  seats: EventSeat[];
  total_price: number;
  expires_at: string;
}

/**
 * Seat details from an event (used in reservations).
 */
export interface EventSeat {
  id: string;
  event_id: string;
  section: string;
  row: string;
  seat_number: string;
  price_tier: string;
  price: number;
  status: string;
}

/**
 * User's ticket order with optional event details.
 */
export interface Order {
  id: string;
  user_id: string;
  event_id: string;
  status: 'pending' | 'completed' | 'cancelled' | 'refunded' | 'payment_failed';
  total_amount: number;
  payment_id: string | null;
  created_at: string;
  completed_at: string | null;
  event_name?: string;
  event_date?: string;
  artist?: string;
  venue_name?: string;
  venue_city?: string;
}

/**
 * User's position and status in the virtual waiting room.
 */
export interface QueueStatus {
  position: number;
  status: 'waiting' | 'active' | 'not_in_queue';
  estimated_wait_seconds: number;
}

/**
 * Generic API response wrapper.
 * @template T - The type of data in the response
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Paginated API response with metadata.
 * @template T - The type of items in the data array
 */
export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
