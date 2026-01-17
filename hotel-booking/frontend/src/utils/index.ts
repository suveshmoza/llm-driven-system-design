import { format, parseISO, differenceInDays, addDays } from 'date-fns';

/**
 * Formats a date into a human-readable string.
 * Handles both Date objects and ISO date strings.
 * @param date - Date object or ISO date string to format
 * @param formatStr - date-fns format string (default: 'MMM d, yyyy')
 * @returns Formatted date string (e.g., "Jan 15, 2024")
 */
export function formatDate(date: string | Date, formatStr = 'MMM d, yyyy'): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, formatStr);
}

/**
 * Formats a check-in/check-out date range for display.
 * Shows abbreviated format for compact display in booking cards.
 * @param checkIn - Check-in date
 * @param checkOut - Check-out date
 * @returns Formatted range (e.g., "Jan 15 - Jan 18, 2024")
 */
export function formatDateRange(checkIn: string | Date, checkOut: string | Date): string {
  return `${formatDate(checkIn, 'MMM d')} - ${formatDate(checkOut, 'MMM d, yyyy')}`;
}

/**
 * Calculates the number of nights between two dates.
 * Essential for pricing calculations and booking summaries.
 * @param checkIn - Check-in date
 * @param checkOut - Check-out date
 * @returns Number of nights (difference in days)
 */
export function getNights(checkIn: string | Date, checkOut: string | Date): number {
  const start = typeof checkIn === 'string' ? parseISO(checkIn) : checkIn;
  const end = typeof checkOut === 'string' ? parseISO(checkOut) : checkOut;
  return differenceInDays(end, start);
}

/**
 * Formats a monetary amount with currency symbol.
 * Uses Intl.NumberFormat for proper locale handling.
 * @param amount - Numeric amount to format
 * @param currency - ISO currency code (default: 'USD')
 * @returns Formatted currency string (e.g., "$150")
 */
export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Converts a Date object to an ISO date string (YYYY-MM-DD).
 * Used for API requests and form field values.
 * @param date - Date object to convert
 * @returns ISO date string
 */
export function getDateString(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Gets today's date as an ISO date string.
 * @returns Today's date in YYYY-MM-DD format
 */
export function getTodayString(): string {
  return getDateString(new Date());
}

/**
 * Gets tomorrow's date as an ISO date string.
 * @returns Tomorrow's date in YYYY-MM-DD format
 */
export function getTomorrowString(): string {
  return getDateString(addDays(new Date(), 1));
}

/**
 * Gets the default check-in date (tomorrow) for new searches.
 * Users typically search for future stays, not same-day.
 * @returns Default check-in date in YYYY-MM-DD format
 */
export function getDefaultCheckIn(): string {
  return getDateString(addDays(new Date(), 1));
}

/**
 * Gets the default check-out date (day after tomorrow) for new searches.
 * Provides a minimum one-night stay as the default.
 * @returns Default check-out date in YYYY-MM-DD format
 */
export function getDefaultCheckOut(): string {
  return getDateString(addDays(new Date(), 2));
}

/**
 * Generates a visual star rating string.
 * Uses filled and empty star characters for display.
 * @param rating - Star rating (1-5)
 * @returns String of star characters (e.g., "★★★☆☆")
 */
export function generateStars(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

/**
 * Mapping of internal amenity codes to display labels.
 * Provides human-readable names for hotel and room amenities.
 */
const amenityLabels: Record<string, string> = {
  wifi: 'Free WiFi',
  pool: 'Swimming Pool',
  gym: 'Fitness Center',
  spa: 'Spa & Wellness',
  restaurant: 'Restaurant',
  bar: 'Bar',
  room_service: 'Room Service',
  parking: 'Parking',
  concierge: 'Concierge',
  beach_access: 'Beach Access',
  water_sports: 'Water Sports',
  ski_access: 'Ski Access',
  fireplace: 'Fireplace',
  hot_tub: 'Hot Tub',
  ski_storage: 'Ski Storage',
  art_gallery: 'Art Gallery',
  rooftop_terrace: 'Rooftop Terrace',
  garden: 'Garden',
  library: 'Library',
  tv: 'TV',
  minibar: 'Minibar',
  safe: 'In-room Safe',
  bathtub: 'Bathtub',
  living_room: 'Living Room',
  dining_room: 'Dining Room',
  butler_service: 'Butler Service',
  balcony: 'Balcony',
  kitchen: 'Kitchen',
  private_pool: 'Private Pool',
  artwork: 'Original Artwork',
  sitting_area: 'Sitting Area',
};

/**
 * Converts an amenity code to a display-friendly label.
 * Falls back to title-casing the code if no mapping exists.
 * @param amenity - Internal amenity code (e.g., "room_service")
 * @returns Display label (e.g., "Room Service")
 */
export function getAmenityLabel(amenity: string): string {
  return amenityLabels[amenity] || amenity.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Maps booking status to Tailwind CSS classes for visual styling.
 * Provides consistent color coding across the application.
 * @param status - Booking status string
 * @returns Tailwind CSS class string for background and text color
 */
export function getStatusColor(status: string): string {
  switch (status) {
    case 'confirmed':
      return 'bg-green-100 text-green-800';
    case 'reserved':
      return 'bg-yellow-100 text-yellow-800';
    case 'completed':
      return 'bg-blue-100 text-blue-800';
    case 'cancelled':
      return 'bg-red-100 text-red-800';
    case 'expired':
      return 'bg-gray-100 text-gray-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

/**
 * Capitalizes a booking status for display.
 * @param status - Lowercase status string
 * @returns Capitalized status (e.g., "Confirmed")
 */
export function getStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
