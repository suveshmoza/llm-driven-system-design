import { create } from 'zustand';
import { Location, FareEstimate, Ride, Driver, RideStatus } from '../types';
import api from '../services/api';
import wsService from '../services/websocket';

/**
 * Ride state interface for the Zustand store.
 * Manages the complete ride booking flow from location selection to completion.
 */
interface RideState {
  /** Rider's current GPS location */
  currentLocation: Location | null;
  /** Selected pickup location */
  pickup: Location | null;
  /** Selected dropoff location */
  dropoff: Location | null;

  /** Fare estimates for all available vehicle types */
  estimates: FareEstimate[];
  /** Currently selected vehicle type (economy, comfort, premium, xl) */
  selectedVehicleType: string;

  /** Active ride object with all details */
  currentRide: Ride | null;
  /** Current status of the active ride */
  rideStatus: RideStatus | null;

  /** Array of nearby available drivers for map display */
  nearbyDrivers: Array<{ id: string; lat: number; lng: number; vehicleType: string }>;

  /** Whether an API operation is in progress */
  isLoading: boolean;
  /** Error message from the last failed operation */
  error: string | null;

  /**
   * Update rider's current GPS location.
   * @param location - Current location coordinates
   */
  setCurrentLocation: (location: Location) => void;

  /**
   * Set pickup location for the ride.
   * Clears any existing estimates.
   * @param location - Pickup location or null to clear
   */
  setPickup: (location: Location | null) => void;

  /**
   * Set dropoff location for the ride.
   * Clears any existing estimates.
   * @param location - Dropoff location or null to clear
   */
  setDropoff: (location: Location | null) => void;

  /**
   * Select vehicle type for the ride.
   * @param type - Vehicle type (economy, comfort, premium, xl)
   */
  setSelectedVehicleType: (type: string) => void;

  /** Fetch fare estimates for all vehicle types based on current pickup/dropoff */
  fetchEstimates: () => Promise<void>;

  /** Request a ride with current pickup, dropoff, and vehicle type */
  requestRide: () => Promise<void>;

  /**
   * Cancel the current ride request.
   * @param reason - Optional cancellation reason for analytics
   */
  cancelRide: (reason?: string) => Promise<void>;

  /**
   * Rate the driver after ride completion.
   * @param rating - Star rating from 1 to 5
   */
  rateRide: (rating: number) => Promise<void>;

  /**
   * Fetch current status of a ride.
   * @param rideId - Unique ride identifier
   */
  fetchRideStatus: (rideId: string) => Promise<void>;

  /** Fetch available drivers near the current location for map display */
  fetchNearbyDrivers: () => Promise<void>;

  /**
   * Handle driver matched event from WebSocket.
   * Updates ride with assigned driver information.
   * @param driver - Matched driver details
   */
  handleRideMatched: (driver: Driver) => void;

  /** Handle driver arrived event - driver is at pickup location */
  handleDriverArrived: () => void;

  /** Handle ride started event - rider has been picked up */
  handleRideStarted: () => void;

  /**
   * Handle ride completed event.
   * Updates ride with final fare information.
   * @param fare - Final fare details
   */
  handleRideCompleted: (fare: unknown) => void;

  /**
   * Handle ride cancelled event (by driver or system).
   * @param reason - Optional cancellation reason
   */
  handleRideCancelled: (reason?: string) => void;

  /** Clear current ride state and start fresh */
  clearRide: () => void;

  /** Clear error message */
  clearError: () => void;
}

/**
 * Zustand store for rider-side ride management.
 * Handles the complete ride lifecycle from booking to completion.
 *
 * Key features:
 * - Real-time updates via WebSocket for ride status changes
 * - Fare estimation with surge pricing support
 * - Multiple vehicle type selection
 * - Nearby driver visualization
 *
 * WebSocket events handled:
 * - ride_matched: Driver assigned to the ride
 * - driver_arrived: Driver at pickup location
 * - ride_started: Rider picked up, trip in progress
 * - ride_completed: Trip finished, fare calculated
 * - ride_cancelled: Ride cancelled by driver or system
 * - no_drivers_available: No drivers in the area
 *
 * @example
 * ```tsx
 * const { pickup, dropoff, setPickup, setDropoff, fetchEstimates, requestRide } = useRideStore();
 *
 * // Set locations
 * setPickup({ lat: 37.7749, lng: -122.4194, address: '123 Main St' });
 * setDropoff({ lat: 37.7849, lng: -122.4094, address: '456 Oak Ave' });
 *
 * // Get fare estimates
 * await fetchEstimates();
 *
 * // Request ride
 * await requestRide();
 * ```
 */
export const useRideStore = create<RideState>((set, get) => {
  // Set up WebSocket handlers for real-time ride updates
  wsService.on('ride_matched', (msg) => {
    get().handleRideMatched(msg.driver as Driver);
  });

  wsService.on('driver_arrived', () => {
    get().handleDriverArrived();
  });

  wsService.on('ride_started', () => {
    get().handleRideStarted();
  });

  wsService.on('ride_completed', (msg) => {
    get().handleRideCompleted(msg.fare);
  });

  wsService.on('ride_cancelled', (msg) => {
    get().handleRideCancelled(msg.reason as string);
  });

  wsService.on('no_drivers_available', () => {
    set({
      error: 'No drivers available in your area. Please try again later.',
      currentRide: null,
      rideStatus: null,
    });
  });

  return {
    currentLocation: null,
    pickup: null,
    dropoff: null,
    estimates: [],
    selectedVehicleType: 'economy',
    currentRide: null,
    rideStatus: null,
    nearbyDrivers: [],
    isLoading: false,
    error: null,

    setCurrentLocation: (location) => set({ currentLocation: location }),

    setPickup: (location) => {
      set({ pickup: location, estimates: [] });
    },

    setDropoff: (location) => {
      set({ dropoff: location, estimates: [] });
    },

    setSelectedVehicleType: (type) => set({ selectedVehicleType: type }),

    fetchEstimates: async () => {
      const { pickup, dropoff } = get();
      if (!pickup || !dropoff) return;

      set({ isLoading: true, error: null });
      try {
        const result = await api.rides.estimate(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
        set({ estimates: result.estimates as FareEstimate[], isLoading: false });
      } catch (error) {
        set({ error: (error as Error).message, isLoading: false });
      }
    },

    requestRide: async () => {
      const { pickup, dropoff, selectedVehicleType } = get();
      if (!pickup || !dropoff) return;

      set({ isLoading: true, error: null });
      try {
        const result = await api.rides.request({
          pickupLat: pickup.lat,
          pickupLng: pickup.lng,
          dropoffLat: dropoff.lat,
          dropoffLng: dropoff.lng,
          vehicleType: selectedVehicleType,
          pickupAddress: pickup.address,
          dropoffAddress: dropoff.address,
        });

        const ride = result as Ride;
        set({
          currentRide: ride,
          rideStatus: 'requested',
          isLoading: false,
        });
      } catch (error) {
        set({ error: (error as Error).message, isLoading: false });
      }
    },

    cancelRide: async (reason) => {
      const { currentRide } = get();
      if (!currentRide) return;

      set({ isLoading: true, error: null });
      try {
        await api.rides.cancel(currentRide.id, reason);
        set({ currentRide: null, rideStatus: null, isLoading: false });
      } catch (error) {
        set({ error: (error as Error).message, isLoading: false });
      }
    },

    rateRide: async (rating) => {
      const { currentRide } = get();
      if (!currentRide) return;

      try {
        await api.rides.rate(currentRide.id, rating);
        set({ currentRide: null, rideStatus: null, pickup: null, dropoff: null });
      } catch (error) {
        set({ error: (error as Error).message });
      }
    },

    fetchRideStatus: async (rideId) => {
      try {
        const ride = (await api.rides.get(rideId)) as Ride;
        set({ currentRide: ride, rideStatus: ride.status });
      } catch (error) {
        set({ error: (error as Error).message });
      }
    },

    fetchNearbyDrivers: async () => {
      const { currentLocation } = get();
      if (!currentLocation) return;

      try {
        const result = await api.rides.nearbyDrivers(currentLocation.lat, currentLocation.lng);
        set({ nearbyDrivers: result.drivers as Array<{ id: string; lat: number; lng: number; vehicleType: string }> });
      } catch {
        // Silently fail for nearby drivers - not critical
      }
    },

    handleRideMatched: (driver) => {
      set((state) => ({
        currentRide: state.currentRide ? { ...state.currentRide, driver } : null,
        rideStatus: 'matched',
      }));
    },

    handleDriverArrived: () => {
      set({ rideStatus: 'driver_arrived' });
    },

    handleRideStarted: () => {
      set({ rideStatus: 'picked_up' });
    },

    handleRideCompleted: (fare) => {
      set((state) => ({
        currentRide: state.currentRide ? { ...state.currentRide, fare: fare as Ride['fare'] } : null,
        rideStatus: 'completed',
      }));
    },

    handleRideCancelled: (reason) => {
      set({
        error: reason ? `Ride cancelled: ${reason}` : 'Ride was cancelled',
        currentRide: null,
        rideStatus: null,
      });
    },

    clearRide: () => {
      set({
        currentRide: null,
        rideStatus: null,
        pickup: null,
        dropoff: null,
        estimates: [],
      });
    },

    clearError: () => set({ error: null }),
  };
});
