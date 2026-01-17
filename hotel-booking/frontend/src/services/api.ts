import type { AuthResponse, User, Hotel, RoomType, Booking, Review, ReviewStats, SearchResult, SearchParams, AvailabilityDay, PricingInfo } from '@/types';

/** Base URL for all API endpoints */
const API_BASE = '/api/v1';

/**
 * Centralized API service for communicating with the hotel booking backend.
 * Handles authentication tokens, request formatting, and error handling.
 * All HTTP requests flow through the private `request` method which adds
 * authorization headers and parses JSON responses.
 */
class ApiService {
  /** JWT token for authenticated requests */
  private token: string | null = null;

  /**
   * Sets the authentication token for subsequent API requests.
   * Called after login/register to persist auth state.
   * @param token - JWT token or null to clear authentication
   */
  setToken(token: string | null) {
    this.token = token;
  }

  /**
   * Generic HTTP request handler that adds auth headers and parses responses.
   * All public API methods delegate to this for consistent error handling.
   * @param endpoint - API endpoint path (appended to API_BASE)
   * @param options - Fetch options (method, body, headers, etc.)
   * @returns Parsed JSON response of type T
   * @throws Error if response is not ok, with message from server or default
   */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  // ============================================
  // Authentication Endpoints
  // ============================================

  /**
   * Registers a new user account.
   * @param data - User registration details including email, password, name, and optional role
   * @returns Auth response with user data and JWT token
   */
  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
    role?: string;
  }): Promise<AuthResponse> {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Authenticates a user with email and password.
   * @param email - User's email address
   * @param password - User's password
   * @returns Auth response with user data and JWT token
   */
  async login(email: string, password: string): Promise<AuthResponse> {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  /**
   * Logs out the current user by invalidating the server-side session.
   */
  async logout(): Promise<void> {
    await this.request('/auth/logout', { method: 'POST' });
  }

  /**
   * Fetches the currently authenticated user's profile.
   * Used to validate tokens and restore auth state on page refresh.
   * @returns Current user data
   */
  async getMe(): Promise<{ user: User }> {
    return this.request('/auth/me');
  }

  // ============================================
  // Hotel Endpoints
  // ============================================

  /**
   * Searches for hotels matching the given criteria.
   * Combines Elasticsearch full-text search with real-time availability checks.
   * @param params - Search filters including city, dates, guests, amenities, price range
   * @returns Paginated list of matching hotels with availability info
   */
  async searchHotels(params: SearchParams): Promise<SearchResult> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        if (Array.isArray(value)) {
          query.set(key, value.join(','));
        } else {
          query.set(key, String(value));
        }
      }
    });
    return this.request(`/hotels/search?${query.toString()}`);
  }

  /**
   * Fetches detailed hotel information including room types.
   * Optionally includes availability and pricing for specific dates.
   * @param hotelId - Hotel UUID
   * @param checkIn - Optional check-in date for availability lookup
   * @param checkOut - Optional check-out date for availability lookup
   * @param guests - Optional guest count for capacity filtering
   * @returns Hotel with nested room types and optional availability data
   */
  async getHotel(hotelId: string, checkIn?: string, checkOut?: string, guests?: number): Promise<Hotel> {
    const query = new URLSearchParams();
    if (checkIn) query.set('checkIn', checkIn);
    if (checkOut) query.set('checkOut', checkOut);
    if (guests) query.set('guests', String(guests));
    const queryString = query.toString();
    return this.request(`/hotels/${hotelId}${queryString ? `?${queryString}` : ''}`);
  }

  /**
   * Creates a new hotel (admin only).
   * @param data - Hotel details including name, address, amenities, policies
   * @returns Created hotel with generated ID
   */
  async createHotel(data: Partial<Hotel>): Promise<Hotel> {
    return this.request('/hotels', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Updates an existing hotel's details (admin only).
   * @param hotelId - Hotel UUID to update
   * @param data - Partial hotel data to merge
   * @returns Updated hotel
   */
  async updateHotel(hotelId: string, data: Partial<Hotel>): Promise<Hotel> {
    return this.request(`/hotels/${hotelId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Deletes a hotel (admin only).
   * @param hotelId - Hotel UUID to delete
   */
  async deleteHotel(hotelId: string): Promise<void> {
    await this.request(`/hotels/${hotelId}`, { method: 'DELETE' });
  }

  /**
   * Fetches all hotels owned by the current user.
   * Used for the hotel admin dashboard.
   * @returns Array of hotels belonging to the authenticated user
   */
  async getMyHotels(): Promise<Hotel[]> {
    return this.request('/hotels/admin/my-hotels');
  }

  // ============================================
  // Room Type Endpoints
  // ============================================

  /**
   * Fetches all room types for a hotel.
   * @param hotelId - Hotel UUID
   * @returns Array of room types with pricing and capacity info
   */
  async getRoomTypes(hotelId: string): Promise<RoomType[]> {
    return this.request(`/hotels/${hotelId}/rooms`);
  }

  /**
   * Creates a new room type for a hotel (admin only).
   * @param hotelId - Hotel UUID
   * @param data - Room type details including capacity, price, amenities
   * @returns Created room type with generated ID
   */
  async createRoomType(hotelId: string, data: Partial<RoomType>): Promise<RoomType> {
    return this.request(`/hotels/${hotelId}/rooms`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Updates an existing room type (admin only).
   * @param roomTypeId - Room type UUID
   * @param data - Partial room type data to merge
   * @returns Updated room type
   */
  async updateRoomType(roomTypeId: string, data: Partial<RoomType>): Promise<RoomType> {
    return this.request(`/hotels/rooms/${roomTypeId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Deletes a room type (admin only).
   * @param roomTypeId - Room type UUID
   */
  async deleteRoomType(roomTypeId: string): Promise<void> {
    await this.request(`/hotels/rooms/${roomTypeId}`, { method: 'DELETE' });
  }

  /**
   * Sets a price override for a specific date (dynamic pricing).
   * Enables hotels to charge different rates for peak seasons or events.
   * @param roomTypeId - Room type UUID
   * @param date - Date string in YYYY-MM-DD format
   * @param price - Override price for that date
   */
  async setPriceOverride(roomTypeId: string, date: string, price: number): Promise<void> {
    await this.request(`/hotels/rooms/${roomTypeId}/pricing`, {
      method: 'POST',
      body: JSON.stringify({ date, price }),
    });
  }

  /**
   * Fetches pricing breakdown for a date range.
   * Returns per-night prices accounting for any overrides.
   * @param roomTypeId - Room type UUID
   * @param checkIn - Check-in date (YYYY-MM-DD)
   * @param checkOut - Check-out date (YYYY-MM-DD)
   * @returns Pricing info with per-night breakdown and total
   */
  async getPricing(roomTypeId: string, checkIn: string, checkOut: string): Promise<PricingInfo> {
    return this.request(`/hotels/rooms/${roomTypeId}/pricing?checkIn=${checkIn}&checkOut=${checkOut}`);
  }

  // ============================================
  // Review Endpoints
  // ============================================

  /**
   * Fetches paginated reviews for a hotel.
   * @param hotelId - Hotel UUID
   * @param page - Page number (1-indexed)
   * @param limit - Reviews per page
   * @returns Paginated review list with metadata
   */
  async getReviews(hotelId: string, page = 1, limit = 10): Promise<{ reviews: Review[]; total: number; page: number; limit: number; totalPages: number }> {
    return this.request(`/hotels/${hotelId}/reviews?page=${page}&limit=${limit}`);
  }

  /**
   * Fetches aggregated review statistics for a hotel.
   * @param hotelId - Hotel UUID
   * @returns Average rating and rating distribution
   */
  async getReviewStats(hotelId: string): Promise<ReviewStats> {
    return this.request(`/hotels/${hotelId}/reviews/stats`);
  }

  // ============================================
  // Booking Endpoints
  // ============================================

  /**
   * Checks room availability for a specific date range.
   * Used before booking to verify rooms are available.
   * @param hotelId - Hotel UUID
   * @param roomTypeId - Room type UUID
   * @param checkIn - Check-in date (YYYY-MM-DD)
   * @param checkOut - Check-out date (YYYY-MM-DD)
   * @param rooms - Number of rooms requested
   * @returns Availability status and room counts
   */
  async checkAvailability(hotelId: string, roomTypeId: string, checkIn: string, checkOut: string, rooms = 1): Promise<{
    available: boolean;
    availableRooms: number;
    totalRooms: number;
    requestedRooms: number;
  }> {
    return this.request(`/bookings/availability?hotelId=${hotelId}&roomTypeId=${roomTypeId}&checkIn=${checkIn}&checkOut=${checkOut}&rooms=${rooms}`);
  }

  /**
   * Fetches availability calendar for a room type.
   * Shows per-day availability and pricing for date selection UI.
   * @param hotelId - Hotel UUID
   * @param roomTypeId - Room type UUID
   * @param year - Calendar year
   * @param month - Calendar month (1-12)
   * @returns Array of daily availability with prices
   */
  async getAvailabilityCalendar(hotelId: string, roomTypeId: string, year: number, month: number): Promise<AvailabilityDay[]> {
    return this.request(`/bookings/availability/calendar?hotelId=${hotelId}&roomTypeId=${roomTypeId}&year=${year}&month=${month}`);
  }

  /**
   * Creates a new booking reservation.
   * Booking starts in "reserved" status with a 15-minute hold.
   * Uses pessimistic locking to prevent double-booking.
   * @param data - Booking details including dates, room type, guest info
   * @returns Created booking with reservation details
   */
  async createBooking(data: {
    hotelId: string;
    roomTypeId: string;
    checkIn: string;
    checkOut: string;
    roomCount: number;
    guestCount: number;
    guestFirstName: string;
    guestLastName: string;
    guestEmail: string;
    guestPhone?: string;
    specialRequests?: string;
  }): Promise<Booking> {
    return this.request('/bookings', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Confirms a reserved booking after payment.
   * Transitions booking from "reserved" to "confirmed" status.
   * @param bookingId - Booking UUID
   * @param paymentId - Optional payment transaction ID
   * @returns Updated booking with confirmed status
   */
  async confirmBooking(bookingId: string, paymentId?: string): Promise<Booking> {
    return this.request(`/bookings/${bookingId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ paymentId }),
    });
  }

  /**
   * Cancels a booking.
   * Releases held inventory back to available pool.
   * @param bookingId - Booking UUID
   * @returns Updated booking with cancelled status
   */
  async cancelBooking(bookingId: string): Promise<Booking> {
    return this.request(`/bookings/${bookingId}/cancel`, {
      method: 'POST',
    });
  }

  /**
   * Fetches detailed information for a specific booking.
   * @param bookingId - Booking UUID
   * @returns Booking with hotel and room type details
   */
  async getBooking(bookingId: string): Promise<Booking> {
    return this.request(`/bookings/${bookingId}`);
  }

  /**
   * Fetches all bookings for the current user.
   * @param status - Optional status filter (reserved, confirmed, cancelled, etc.)
   * @returns Array of user's bookings
   */
  async getMyBookings(status?: string): Promise<Booking[]> {
    const query = status ? `?status=${status}` : '';
    return this.request(`/bookings${query}`);
  }

  /**
   * Fetches all bookings for a hotel (admin only).
   * Used for hotel management dashboard.
   * @param hotelId - Hotel UUID
   * @param status - Optional status filter
   * @param startDate - Optional start date filter
   * @param endDate - Optional end date filter
   * @returns Array of hotel's bookings
   */
  async getHotelBookings(hotelId: string, status?: string, startDate?: string, endDate?: string): Promise<Booking[]> {
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (startDate) query.set('startDate', startDate);
    if (endDate) query.set('endDate', endDate);
    const queryString = query.toString();
    return this.request(`/bookings/hotel/${hotelId}${queryString ? `?${queryString}` : ''}`);
  }

  /**
   * Submits a review for a completed booking.
   * Users can only review after checkout.
   * @param bookingId - Booking UUID
   * @param data - Review content including rating and optional text
   * @returns Created review
   */
  async submitReview(bookingId: string, data: { rating: number; title?: string; content?: string }): Promise<Review> {
    return this.request(`/bookings/${bookingId}/review`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
}

/** Singleton API service instance for use across the application */
export const api = new ApiService();
