import { create } from 'zustand';
import { Location, Ride, RideOffer, EarningsData } from '../types';
import api from '../services/api';
import wsService from '../services/websocket';

/**
 * Driver state interface for the Zustand store.
 * Manages driver availability, active rides, and earnings tracking.
 */
interface DriverState {
  /** Whether driver is currently online and visible to the system */
  isOnline: boolean;
  /** Whether driver is available for new ride offers (not on active trip) */
  isAvailable: boolean;
  /** Driver's current GPS location */
  currentLocation: Location | null;

  /** Currently active ride assignment */
  currentRide: Ride | null;
  /** Pending ride offer awaiting acceptance/decline */
  rideOffer: RideOffer | null;
  /** Timestamp when the current offer expires (for countdown display) */
  offerExpiresAt: number | null;

  /** Earnings summary for the selected time period */
  earnings: EarningsData | null;

  /** Whether an API operation is in progress */
  isLoading: boolean;
  /** Error message from the last failed operation */
  error: string | null;

  /**
   * Update driver's current GPS location.
   * @param location - Current location coordinates
   */
  setCurrentLocation: (location: Location) => void;

  /** Set driver status to online and available for ride offers */
  goOnline: () => Promise<void>;

  /** Set driver status to offline and stop receiving ride offers */
  goOffline: () => Promise<void>;

  /**
   * Send location update to server.
   * Called periodically while online for real-time tracking.
   * @param lat - Current latitude
   * @param lng - Current longitude
   */
  updateLocation: (lat: number, lng: number) => Promise<void>;

  /** Fetch current driver status from server */
  fetchStatus: () => Promise<void>;

  /** Accept the pending ride offer */
  acceptRide: () => Promise<void>;

  /** Decline the pending ride offer */
  declineRide: () => void;

  /** Signal arrival at the pickup location */
  arrivedAtPickup: () => Promise<void>;

  /** Start the ride after picking up the rider */
  startRide: () => Promise<void>;

  /** Complete the ride at the dropoff location */
  completeRide: () => Promise<void>;

  /**
   * Fetch earnings summary for a time period.
   * @param period - Time period: 'today', 'week', or 'month'
   */
  fetchEarnings: (period?: string) => Promise<void>;

  /** Clear error message */
  clearError: () => void;
}

/**
 * Zustand store for driver-side state management.
 * Handles driver availability, ride acceptance, and trip progression.
 *
 * Key features:
 * - Online/offline status management
 * - Real-time ride offers via WebSocket with countdown timer
 * - Trip lifecycle management (accept -> arrived -> start -> complete)
 * - Earnings tracking by time period
 *
 * WebSocket events handled:
 * - ride_offer: New ride request matching driver's location/vehicle
 * - ride_cancelled: Rider cancelled the ride
 *
 * The driver flow:
 * 1. Go online at current location
 * 2. Receive ride_offer via WebSocket
 * 3. Accept or decline within time limit
 * 4. If accepted: navigate to pickup -> mark arrived -> start trip -> complete
 * 5. Driver becomes available again after completion
 *
 * @example
 * ```tsx
 * const { isOnline, goOnline, goOffline, rideOffer, acceptRide, declineRide } = useDriverStore();
 *
 * // Toggle online status
 * if (isOnline) {
 *   await goOffline();
 * } else {
 *   await goOnline();
 * }
 *
 * // Handle ride offer
 * if (rideOffer) {
 *   await acceptRide();
 *   // or
 *   declineRide();
 * }
 * ```
 */
export const useDriverStore = create<DriverState>((set, get) => {
  // Set up WebSocket handlers for real-time ride offers
  wsService.on('ride_offer', (msg) => {
    const offer = msg as RideOffer;
    set({
      rideOffer: offer,
      offerExpiresAt: Date.now() + offer.expiresIn * 1000,
    });
  });

  wsService.on('ride_cancelled', () => {
    set({
      currentRide: null,
      isAvailable: true,
    });
  });

  return {
    isOnline: false,
    isAvailable: false,
    currentLocation: null,
    currentRide: null,
    rideOffer: null,
    offerExpiresAt: null,
    earnings: null,
    isLoading: false,
    error: null,

    setCurrentLocation: (location) => set({ currentLocation: location }),

    goOnline: async () => {
      const { currentLocation } = get();
      if (!currentLocation) {
        set({ error: 'Location required to go online' });
        return;
      }

      set({ isLoading: true, error: null });
      try {
        await api.driver.goOnline(currentLocation.lat, currentLocation.lng);
        set({ isOnline: true, isAvailable: true, isLoading: false });
      } catch (error) {
        set({ error: (error as Error).message, isLoading: false });
      }
    },

    goOffline: async () => {
      set({ isLoading: true, error: null });
      try {
        await api.driver.goOffline();
        set({ isOnline: false, isAvailable: false, isLoading: false });
      } catch (error) {
        set({ error: (error as Error).message, isLoading: false });
      }
    },

    updateLocation: async (lat, lng) => {
      const location = { lat, lng };
      set({ currentLocation: location });

      // Send via WebSocket for real-time updates (low latency)
      wsService.sendLocationUpdate(lat, lng);

      // Also send via API for persistence (more reliable)
      try {
        await api.driver.updateLocation(lat, lng);
      } catch {
        // Silently fail location updates - not critical
      }
    },

    fetchStatus: async () => {
      try {
        const status = (await api.driver.status()) as {
          status: string;
          location: Location | null;
          activeRide: Ride | null;
        };

        set({
          isOnline: status.status !== 'offline',
          isAvailable: status.status === 'available',
          currentLocation: status.location,
          currentRide: status.activeRide,
        });
      } catch (error) {
        set({ error: (error as Error).message });
      }
    },

    acceptRide: async () => {
      const { rideOffer } = get();
      if (!rideOffer) return;

      set({ isLoading: true, error: null });
      try {
        const result = (await api.driver.acceptRide(rideOffer.rideId)) as { ride: Ride };
        set({
          currentRide: result.ride,
          rideOffer: null,
          offerExpiresAt: null,
          isAvailable: false,
          isLoading: false,
        });
      } catch (error) {
        set({ error: (error as Error).message, isLoading: false });
      }
    },

    declineRide: () => {
      const { rideOffer } = get();
      if (rideOffer) {
        // Notify server of decline (fire and forget)
        api.driver.declineRide(rideOffer.rideId).catch(console.error);
      }
      set({ rideOffer: null, offerExpiresAt: null });
    },

    arrivedAtPickup: async () => {
      const { currentRide } = get();
      if (!currentRide) return;

      set({ isLoading: true, error: null });
      try {
        await api.driver.arrivedAtPickup(currentRide.id);
        set((state) => ({
          currentRide: state.currentRide ? { ...state.currentRide, status: 'driver_arrived' } : null,
          isLoading: false,
        }));
      } catch (error) {
        set({ error: (error as Error).message, isLoading: false });
      }
    },

    startRide: async () => {
      const { currentRide } = get();
      if (!currentRide) return;

      set({ isLoading: true, error: null });
      try {
        await api.driver.startRide(currentRide.id);
        set((state) => ({
          currentRide: state.currentRide ? { ...state.currentRide, status: 'picked_up' } : null,
          isLoading: false,
        }));
      } catch (error) {
        set({ error: (error as Error).message, isLoading: false });
      }
    },

    completeRide: async () => {
      const { currentRide } = get();
      if (!currentRide) return;

      set({ isLoading: true, error: null });
      try {
        await api.driver.completeRide(currentRide.id);
        set({
          currentRide: null,
          isAvailable: true,
          isLoading: false,
        });
      } catch (error) {
        set({ error: (error as Error).message, isLoading: false });
      }
    },

    fetchEarnings: async (period = 'today') => {
      set({ isLoading: true, error: null });
      try {
        const earnings = (await api.driver.earnings(period)) as EarningsData;
        set({ earnings, isLoading: false });
      } catch (error) {
        set({ error: (error as Error).message, isLoading: false });
      }
    },

    clearError: () => set({ error: null }),
  };
});
