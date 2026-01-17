/**
 * Represents a user in the hotel booking system.
 * Users can be guests, hotel administrators, or system admins.
 */
export interface User {
  /** Unique user identifier (UUID) */
  id: string;
  /** User's email address (used for login) */
  email: string;
  /** User's first name */
  firstName: string;
  /** User's last name */
  lastName: string;
  /** Optional phone number for booking confirmations */
  phone?: string;
  /** User role determining access permissions */
  role: 'user' | 'hotel_admin' | 'admin';
}

/**
 * Response from authentication endpoints (login/register).
 * Contains both user data and JWT token for subsequent requests.
 */
export interface AuthResponse {
  /** Authenticated user data */
  user: User;
  /** JWT token for API authentication */
  token: string;
}

/**
 * Represents a hotel property in the system.
 * Contains all hotel details, policies, and optionally nested room types.
 */
export interface Hotel {
  /** Unique hotel identifier (UUID) */
  id: string;
  /** ID of the hotel admin who owns this property */
  ownerId?: string;
  /** Hotel display name */
  name: string;
  /** Full hotel description */
  description: string;
  /** Street address */
  address: string;
  /** City name (used for search) */
  city: string;
  /** State or province */
  state?: string;
  /** Country name */
  country: string;
  /** Postal/ZIP code */
  postalCode?: string;
  /** Geographic latitude for map display */
  latitude?: number;
  /** Geographic longitude for map display */
  longitude?: number;
  /** Official star rating (1-5) */
  starRating: number;
  /** List of amenity codes (e.g., 'wifi', 'pool') */
  amenities: string[];
  /** Standard check-in time (e.g., "15:00") */
  checkInTime: string;
  /** Standard check-out time (e.g., "11:00") */
  checkOutTime: string;
  /** Cancellation policy description */
  cancellationPolicy: string;
  /** Array of image URLs for the property */
  images: string[];
  /** Whether the hotel is active and bookable */
  isActive: boolean;
  /** Average guest rating (calculated from reviews) */
  avgRating: number;
  /** Total number of reviews */
  reviewCount: number;
  /** Nested room types (populated on detail view) */
  roomTypes?: RoomType[];
  /** Timestamp of hotel creation */
  createdAt?: string;
  /** Timestamp of last update */
  updatedAt?: string;
  /** Lowest available room price (from search results) */
  startingPrice?: number;
  /** Room types with availability (from search with dates) */
  availableRoomTypes?: AvailableRoomType[];
}

/**
 * Represents a room category within a hotel.
 * Hotels have multiple room types with different capacities and prices.
 */
export interface RoomType {
  /** Unique room type identifier (UUID) */
  id: string;
  /** Parent hotel ID */
  hotelId: string;
  /** Room type name (e.g., "Deluxe King") */
  name: string;
  /** Full description of the room */
  description: string;
  /** Maximum guest capacity */
  capacity: number;
  /** Bed configuration (e.g., "King", "2 Queens") */
  bedType: string;
  /** Total number of rooms of this type in the hotel */
  totalCount: number;
  /** Base nightly rate before any dynamic pricing */
  basePrice: number;
  /** List of room-specific amenity codes */
  amenities: string[];
  /** Array of image URLs for this room type */
  images: string[];
  /** Room size in square meters */
  sizeSqm?: number;
  /** Whether this room type is available for booking */
  isActive: boolean;
  /** Real-time availability info (populated when querying with dates) */
  availability?: {
    available: boolean;
    availableRooms: number;
    totalRooms: number;
    requestedRooms: number;
  };
  /** Total price for the stay (calculated for date range) */
  totalPrice?: number;
  /** Number of nights (for price display) */
  nights?: number;
  /** Average price per night (may differ from base due to dynamic pricing) */
  pricePerNight?: number;
}

/**
 * Simplified room type info returned in search results.
 * Contains only essential fields for listing display.
 */
export interface AvailableRoomType {
  /** Room type ID */
  id: string;
  /** Maximum guest capacity */
  capacity: number;
  /** Base nightly rate */
  basePrice: number;
  /** Number of rooms available for the search dates */
  availableRooms: number;
}

/**
 * Represents a hotel reservation.
 * Tracks the complete booking lifecycle from reservation to completion.
 */
export interface Booking {
  /** Unique booking identifier (UUID) */
  id: string;
  /** ID of the user who made the booking */
  userId: string;
  /** ID of the booked hotel */
  hotelId: string;
  /** ID of the booked room type */
  roomTypeId: string;
  /** Check-in date (YYYY-MM-DD) */
  checkIn: string;
  /** Check-out date (YYYY-MM-DD) */
  checkOut: string;
  /** Number of rooms booked */
  roomCount: number;
  /** Total number of guests */
  guestCount: number;
  /** Total price for the entire stay */
  totalPrice: number;
  /** Current booking status */
  status: 'pending' | 'reserved' | 'confirmed' | 'cancelled' | 'completed' | 'expired';
  /** Payment transaction ID (after confirmation) */
  paymentId?: string;
  /** Expiration time for reserved (unpaid) bookings */
  reservedUntil?: string;
  /** Primary guest's first name */
  guestFirstName: string;
  /** Primary guest's last name */
  guestLastName: string;
  /** Primary guest's email */
  guestEmail: string;
  /** Primary guest's phone */
  guestPhone?: string;
  /** Special requests or notes */
  specialRequests?: string;
  /** Booking creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Hotel name (joined from hotels table) */
  hotelName?: string;
  /** Hotel address (joined) */
  hotelAddress?: string;
  /** Hotel city (joined) */
  hotelCity?: string;
  /** Hotel images (joined) */
  hotelImages?: string[];
  /** Room type name (joined from room_types table) */
  roomTypeName?: string;
}

/**
 * Represents a guest review for a hotel stay.
 * Reviews are linked to completed bookings.
 */
export interface Review {
  /** Unique review identifier (UUID) */
  id: string;
  /** Associated booking ID */
  bookingId: string;
  /** Author's user ID */
  userId: string;
  /** Reviewed hotel ID */
  hotelId: string;
  /** Rating score (1-5) */
  rating: number;
  /** Optional review title */
  title?: string;
  /** Optional review body text */
  content?: string;
  /** Review submission timestamp */
  createdAt: string;
  /** Author's first name (joined) */
  authorFirstName?: string;
  /** Author's last name (joined) */
  authorLastName?: string;
}

/**
 * Aggregated review statistics for a hotel.
 * Used for displaying rating summaries.
 */
export interface ReviewStats {
  /** Total number of reviews */
  totalReviews: number;
  /** Average rating across all reviews */
  avgRating: number;
  /** Distribution of ratings by score */
  distribution: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
}

/**
 * Availability and pricing data for a single day.
 * Used in the availability calendar component.
 */
export interface AvailabilityDay {
  /** Date string (YYYY-MM-DD) */
  date: string;
  /** Number of rooms available on this date */
  available: number;
  /** Total rooms of this type */
  total: number;
  /** Number of rooms booked on this date */
  booked: number;
  /** Price for this date (may include dynamic pricing) */
  price: number;
}

/**
 * Search parameters for hotel queries.
 * All fields are optional to support flexible filtering.
 */
export interface SearchParams {
  /** City to search in */
  city?: string;
  /** Country filter */
  country?: string;
  /** Check-in date (YYYY-MM-DD) */
  checkIn?: string;
  /** Check-out date (YYYY-MM-DD) */
  checkOut?: string;
  /** Number of guests */
  guests?: number;
  /** Number of rooms needed */
  rooms?: number;
  /** Minimum star rating filter */
  minStars?: number;
  /** Maximum price per night filter */
  maxPrice?: number;
  /** Minimum price per night filter */
  minPrice?: number;
  /** Required amenities filter */
  amenities?: string[];
  /** Sort order for results */
  sortBy?: 'relevance' | 'price_asc' | 'price_desc' | 'rating' | 'stars';
  /** Page number for pagination (1-indexed) */
  page?: number;
  /** Results per page */
  limit?: number;
}

/**
 * Paginated search results from the hotels search endpoint.
 */
export interface SearchResult {
  /** Array of matching hotels */
  hotels: Hotel[];
  /** Total number of matching hotels */
  total: number;
  /** Current page number */
  page: number;
  /** Results per page */
  limit: number;
  /** Total number of pages */
  totalPages: number;
}

/**
 * Pricing breakdown for a date range.
 * Shows per-night pricing including any dynamic overrides.
 */
export interface PricingInfo {
  /** Base price per night (before overrides) */
  basePrice: number;
  /** Per-night prices for the date range */
  prices: { date: string; price: number }[];
  /** Total price for all nights */
  totalPrice: number;
}
