import type { WebSocket } from 'ws';
import type {
  VehicleType,
  FareEstimate,
  Ride,
  RideStatus,
  DriverInfo,
  DriverLocation,
} from '../../types/index.js';

/**
 * @description WebSocket message structure for real-time communication between server and clients.
 * All WebSocket messages must have a type field to identify the message purpose.
 * @property {string} type - The message type identifier (e.g., 'ride_offer', 'ride_matched', 'driver_arrived')
 */
export interface WSMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * @description Result returned after a rider requests a new ride.
 * Contains all necessary information for the rider to track their pending ride request.
 * @property {string} rideId - Unique identifier for the created ride
 * @property {string} status - Current status of the ride (typically 'requested' for new rides)
 * @property {FareEstimate} fareEstimate - Estimated fare details including surge pricing
 * @property {number} pickupLat - Latitude of the pickup location
 * @property {number} pickupLng - Longitude of the pickup location
 * @property {number} dropoffLat - Latitude of the dropoff location
 * @property {number} dropoffLng - Longitude of the dropoff location
 * @property {VehicleType} vehicleType - Type of vehicle requested (economy, comfort, premium)
 */
export interface RideRequestResult {
  rideId: string;
  status: string;
  fareEstimate: FareEstimate;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  vehicleType: VehicleType;
}

/**
 * @description Result returned when a driver attempts to accept a ride offer.
 * Contains success status and ride details if accepted, or error message if failed.
 * @property {boolean} success - Whether the ride was successfully accepted
 * @property {string} [error] - Error message if acceptance failed (ride taken, expired, etc.)
 * @property {Object} [ride] - Ride details provided on successful acceptance
 * @property {string} ride.id - Unique ride identifier
 * @property {string} ride.status - Updated ride status
 * @property {Object} ride.pickup - Pickup location coordinates
 * @property {Object} ride.dropoff - Dropoff location coordinates
 * @property {string} ride.riderId - ID of the rider who requested the ride
 */
export interface AcceptRideResult {
  success: boolean;
  error?: string;
  ride?: {
    id: string;
    status: string;
    pickup: { lat: number; lng: number };
    dropoff: { lat: number; lng: number };
    riderId: string;
  };
}

/**
 * @description Result returned when a driver completes a ride.
 * Contains the final fare calculation if successful.
 * @property {boolean} success - Whether the ride was successfully completed
 * @property {string} [error] - Error message if completion failed
 * @property {FareEstimate} [fare] - Final calculated fare including distance, time, and surge
 */
export interface CompleteRideResult {
  success: boolean;
  error?: string;
  fare?: FareEstimate;
}

/**
 * @description Result returned when a ride is cancelled by rider, driver, or system.
 * @property {boolean} success - Whether the cancellation was successful
 * @property {string} [error] - Error message if cancellation failed
 */
export interface CancelRideResult {
  success: boolean;
  error?: string;
}

/**
 * @description Database row representation of a rider's basic information.
 * Used when fetching rider details for ride offers to drivers.
 * @property {string} name - Display name of the rider
 * @property {string} rating - Rider's average rating (stored as string for precision)
 */
export interface RiderRow {
  name: string;
  rating: string;
}

/**
 * @description Database row representation of a driver with vehicle information.
 * Used when fetching driver details after a ride is matched.
 * @property {string} id - Unique driver/user ID
 * @property {string} name - Display name of the driver
 * @property {string} rating - Driver's average rating (stored as string for precision)
 * @property {VehicleType} vehicle_type - Type of vehicle (economy, comfort, premium)
 * @property {string} vehicle_make - Vehicle manufacturer (e.g., Toyota, Honda)
 * @property {string} vehicle_model - Vehicle model name (e.g., Camry, Civic)
 * @property {string} vehicle_color - Color of the vehicle
 * @property {string} license_plate - Vehicle license plate number
 */
export interface DriverQueryRow {
  id: string;
  name: string;
  rating: string;
  vehicle_type: VehicleType;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_color: string;
  license_plate: string;
}

/**
 * @description Complete database row for a ride with optional joined driver information.
 * Used for fetching full ride details including driver and vehicle information.
 * String types for numeric fields are due to PostgreSQL returning DECIMAL/NUMERIC as strings.
 * @property {string} id - Unique ride identifier (UUID)
 * @property {string} rider_id - ID of the rider who requested the ride
 * @property {string | null} driver_id - ID of the assigned driver (null if not yet matched)
 * @property {RideStatus} status - Current ride status
 * @property {string} pickup_lat - Pickup latitude (string due to DECIMAL precision)
 * @property {string} pickup_lng - Pickup longitude (string due to DECIMAL precision)
 * @property {string | null} pickup_address - Human-readable pickup address
 * @property {string} dropoff_lat - Dropoff latitude (string due to DECIMAL precision)
 * @property {string} dropoff_lng - Dropoff longitude (string due to DECIMAL precision)
 * @property {string | null} dropoff_address - Human-readable dropoff address
 * @property {VehicleType} vehicle_type - Requested vehicle type
 * @property {number} estimated_fare_cents - Estimated fare in cents
 * @property {number | null} final_fare_cents - Final fare in cents (set on completion)
 * @property {string} surge_multiplier - Surge pricing multiplier applied
 * @property {number} distance_meters - Ride distance in meters
 * @property {number | null} duration_seconds - Ride duration in seconds (set on completion)
 * @property {number | null} driver_rating - Rating given to driver by rider
 * @property {number | null} rider_rating - Rating given to rider by driver
 * @property {Date} requested_at - Timestamp when ride was requested
 * @property {Date | null} matched_at - Timestamp when driver was matched
 * @property {Date | null} driver_arrived_at - Timestamp when driver arrived at pickup
 * @property {Date | null} picked_up_at - Timestamp when rider was picked up
 * @property {Date | null} completed_at - Timestamp when ride was completed
 * @property {Date | null} cancelled_at - Timestamp when ride was cancelled
 * @property {string | null} cancelled_by - User ID of who cancelled the ride
 * @property {string | null} cancellation_reason - Reason for cancellation
 * @property {string} [driver_name] - Driver's display name (from JOIN)
 * @property {string} [current_lat] - Driver's current latitude (from JOIN)
 * @property {string} [current_lng] - Driver's current longitude (from JOIN)
 * @property {string} [vehicle_make] - Vehicle manufacturer (from JOIN)
 * @property {string} [vehicle_model] - Vehicle model (from JOIN)
 * @property {string} [vehicle_color] - Vehicle color (from JOIN)
 * @property {string} [license_plate] - Vehicle license plate (from JOIN)
 */
export interface RideWithDriverRow {
  id: string;
  rider_id: string;
  driver_id: string | null;
  status: RideStatus;
  pickup_lat: string;
  pickup_lng: string;
  pickup_address: string | null;
  dropoff_lat: string;
  dropoff_lng: string;
  dropoff_address: string | null;
  vehicle_type: VehicleType;
  estimated_fare_cents: number;
  final_fare_cents: number | null;
  surge_multiplier: string;
  distance_meters: number;
  duration_seconds: number | null;
  driver_rating: number | null;
  rider_rating: number | null;
  requested_at: Date;
  matched_at: Date | null;
  driver_arrived_at: Date | null;
  picked_up_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  driver_name?: string;
  current_lat?: string;
  current_lng?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_color?: string;
  license_plate?: string;
}

/**
 * @description Redis key for the sorted set containing pending ride requests.
 * Rides are scored by their request timestamp for FIFO processing.
 */
export const PENDING_REQUESTS_KEY = 'rides:pending';

/**
 * @description Redis key prefix for individual ride hash data.
 * Full key format: 'ride:{rideId}' (e.g., 'ride:abc-123-def')
 */
export const RIDE_PREFIX = 'ride:';

// Re-export types that are used across modules
export type {
  VehicleType,
  FareEstimate,
  Ride,
  RideStatus,
  DriverInfo,
  DriverLocation,
  WebSocket,
};
