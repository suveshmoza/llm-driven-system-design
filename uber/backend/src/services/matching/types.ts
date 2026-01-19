import type { WebSocket } from 'ws';
import type {
  VehicleType,
  FareEstimate,
  Ride,
  RideStatus,
  DriverInfo,
  DriverLocation,
} from '../../types/index.js';

// WebSocket message type
export interface WSMessage {
  type: string;
  [key: string]: unknown;
}

// Ride request result
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

// Accept ride result
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

// Complete ride result
export interface CompleteRideResult {
  success: boolean;
  error?: string;
  fare?: FareEstimate;
}

// Cancel ride result
export interface CancelRideResult {
  success: boolean;
  error?: string;
}

// Database row types
export interface RiderRow {
  name: string;
  rating: string;
}

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

// Redis keys
export const PENDING_REQUESTS_KEY = 'rides:pending';
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
