/**
 * User profile representing either a rider or driver in the system.
 * Contains authentication info, ratings, and role-specific fields.
 */
export interface User {
  /** Unique user identifier (UUID) */
  id: string;
  /** User's email address for authentication */
  email: string;
  /** Display name shown to other users */
  name: string;
  /** Phone number for driver/rider contact */
  phone?: string;
  /** User role determining available features and UI */
  userType: 'rider' | 'driver';
  /** Average rating from 1-5 stars */
  rating: number;
  /** Total number of ratings received */
  ratingCount?: number;
  /** Vehicle information (drivers only) */
  vehicle?: Vehicle;
  /** Whether driver is available for ride offers (drivers only) */
  isAvailable?: boolean;
  /** Whether driver is currently online (drivers only) */
  isOnline?: boolean;
  /** Total completed rides */
  totalRides?: number;
  /** Lifetime earnings in cents (drivers only) */
  totalEarningsCents?: number;
}

/**
 * Vehicle information for driver registration and ride matching.
 * Displayed to riders when a driver is assigned.
 */
export interface Vehicle {
  /** Vehicle category affecting pricing and matching */
  vehicleType: 'economy' | 'comfort' | 'premium' | 'xl';
  /** Vehicle manufacturer (e.g., Toyota, Honda) */
  vehicleMake: string;
  /** Vehicle model (e.g., Camry, Civic) */
  vehicleModel: string;
  /** Vehicle color for rider identification */
  vehicleColor: string;
  /** License plate number for verification */
  licensePlate: string;
}

/**
 * Geographic coordinates with optional address.
 * Used for pickup/dropoff locations and driver positions.
 */
export interface Location {
  /** Latitude coordinate */
  lat: number;
  /** Longitude coordinate */
  lng: number;
  /** Human-readable address (from geocoding) */
  address?: string;
}

/**
 * Driver information shown to riders during ride matching and progress.
 * Includes vehicle details and real-time location when applicable.
 */
export interface Driver {
  /** Unique driver identifier */
  id: string;
  /** Driver's display name */
  name: string;
  /** Driver's average rating */
  rating: number;
  /** Vehicle category */
  vehicleType: string;
  /** Vehicle manufacturer */
  vehicleMake: string;
  /** Vehicle model */
  vehicleModel: string;
  /** Vehicle color */
  vehicleColor: string;
  /** License plate for identification */
  licensePlate: string;
  /** Current driver location (for map display) */
  location?: Location;
  /** Distance from pickup in kilometers */
  distanceKm?: number;
  /** Estimated time of arrival in minutes */
  eta?: number;
}

/**
 * Fare estimate for a specific vehicle type.
 * Includes breakdown of costs and availability information.
 */
export interface FareEstimate {
  /** Vehicle category for this estimate */
  vehicleType: string;
  /** Base fare component in cents */
  baseFareCents: number;
  /** Distance-based fare component in cents */
  distanceFareCents: number;
  /** Time-based fare component in cents */
  timeFareCents: number;
  /** Multiplier for vehicle type (premium costs more) */
  vehicleMultiplier: number;
  /** Surge pricing multiplier (1.0 = no surge) */
  surgeMultiplier: number;
  /** Total estimated fare in cents */
  totalFareCents: number;
  /** Trip distance in kilometers */
  distanceKm: number;
  /** Trip distance in miles */
  distanceMiles: number;
  /** Estimated trip duration in minutes */
  durationMinutes: number;
  /** Number of available drivers for this vehicle type */
  availableDrivers?: number;
}

/**
 * Complete ride object representing a trip from request to completion.
 * Central data structure for the ride lifecycle.
 */
export interface Ride {
  /** Unique ride identifier (UUID) */
  id: string;
  /** Current ride status */
  status: RideStatus;
  /** Pickup location coordinates and address */
  pickup: Location;
  /** Dropoff location coordinates and address */
  dropoff: Location;
  /** Selected vehicle category */
  vehicleType: string;
  /** Assigned driver (after matching) */
  driver?: Driver;
  /** Rider information (for driver display) */
  rider?: { name: string };
  /** Fare information */
  fare?: {
    /** Estimated fare at request time in cents */
    estimated: number;
    /** Final calculated fare after completion in cents */
    final?: number;
    /** Applied surge multiplier */
    surgeMultiplier: number;
  };
  /** Detailed fare estimate (for display) */
  fareEstimate?: FareEstimate;
  /** ISO timestamp when ride was requested */
  requestedAt?: string;
  /** ISO timestamp when ride was completed */
  completedAt?: string;
}

/**
 * Ride status representing the current stage in the ride lifecycle.
 * Transitions: requested -> matched -> driver_arrived -> picked_up -> completed
 *              (can transition to cancelled from any state before completed)
 */
export type RideStatus =
  | 'requested'      // Ride request created, awaiting driver match
  | 'matched'        // Driver assigned, en route to pickup
  | 'driver_arrived' // Driver at pickup location
  | 'picked_up'      // Rider in vehicle, trip in progress
  | 'completed'      // Trip finished, fare calculated
  | 'cancelled';     // Ride cancelled by rider, driver, or system

/**
 * Surge pricing information for a geographic area.
 * Based on supply/demand ratio in geohash cells.
 */
export interface SurgeInfo {
  /** Price multiplier (1.0 = normal, 2.0 = double price) */
  multiplier: number;
  /** Current ride demand level in the area */
  demand: number;
  /** Current driver supply level in the area */
  supply: number;
  /** Whether surge pricing is currently active */
  isActive: boolean;
  /** Human-readable surge explanation */
  message: string;
}

/**
 * Driver earnings summary for a time period.
 * Used for earnings dashboard display.
 */
export interface EarningsData {
  /** Time period for the summary (today, week, month) */
  period: string;
  /** Total completed rides in the period */
  totalRides: number;
  /** Total earnings in cents */
  totalEarnings: number;
  /** Average fare per ride in cents */
  averageFare: number;
  /** Total distance driven in kilometers */
  totalDistanceKm: number;
  /** Total online hours */
  totalHours: number;
  /** Breakdown by hour for charts */
  hourlyBreakdown: Array<{
    /** ISO timestamp for the hour */
    hour: string;
    /** Rides completed in this hour */
    rides: number;
    /** Earnings in this hour in cents */
    earnings: number;
  }>;
}

/**
 * Generic WebSocket message structure.
 * All real-time messages have a type field and additional payload.
 */
export interface WebSocketMessage {
  /** Message type for routing (e.g., 'ride_offer', 'driver_arrived') */
  type: string;
  /** Additional message-specific fields */
  [key: string]: unknown;
}

/**
 * Ride offer sent to drivers via WebSocket.
 * Includes trip details and a time limit for response.
 */
export interface RideOffer {
  /** Message type identifier */
  type: 'ride_offer';
  /** Ride ID to accept/decline */
  rideId: string;
  /** Rider information for driver decision */
  rider: {
    /** Rider's display name */
    name: string;
    /** Rider's rating */
    rating: number;
  };
  /** Pickup location */
  pickup: Location;
  /** Dropoff location */
  dropoff: Location;
  /** Estimated fare in cents */
  estimatedFare: number;
  /** Trip distance in kilometers */
  distanceKm: number;
  /** ETA to pickup in minutes */
  etaMinutes: number;
  /** Seconds until offer expires */
  expiresIn: number;
}

/**
 * Standard API error response structure.
 */
export interface ApiError {
  /** Error message for display */
  error: string;
}
