import { useState, useEffect, useCallback } from 'react';
import { driverAPI } from '../services/api';

/**
 * Geolocation state interface.
 * Tracks the driver's current position and tracking status.
 */
interface GeolocationState {
  /** Current latitude, null if not yet obtained */
  lat: number | null;
  /** Current longitude, null if not yet obtained */
  lon: number | null;
  /** Error message if geolocation failed */
  error: string | null;
  /** Whether location tracking is currently active */
  isTracking: boolean;
}

/**
 * React hook for managing driver GPS location tracking.
 * Provides real-time location updates to the server for accurate ETA calculations.
 *
 * This hook uses the browser's Geolocation API to track the driver's position
 * and periodically sends updates to the server. It handles geolocation errors
 * gracefully and provides controls to start/stop tracking.
 *
 * @param autoTrack - Whether to start tracking automatically on mount (default: false)
 * @param intervalMs - Interval between location updates in milliseconds (default: 10000)
 * @returns Object containing location state and control functions
 *
 * @example
 * ```tsx
 * const { lat, lon, isTracking, startTracking, stopTracking } = useDriverLocation(true, 5000);
 * // Location will be tracked and sent to server every 5 seconds
 * ```
 */
export function useDriverLocation(autoTrack = false, intervalMs = 10000) {
  const [state, setState] = useState<GeolocationState>({
    lat: null,
    lon: null,
    error: null,
    isTracking: false,
  });

  /**
   * Fetches the current position and sends it to the server.
   * Uses high accuracy mode for better precision.
   */
  const updateLocation = useCallback(async () => {
    if (!navigator.geolocation) {
      setState((s) => ({ ...s, error: 'Geolocation not supported' }));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setState((s) => ({ ...s, lat: latitude, lon: longitude, error: null }));

        // Send to server
        try {
          await driverAPI.updateLocation(latitude, longitude);
        } catch (err) {
          console.error('Failed to update location:', err);
        }
      },
      (error) => {
        setState((s) => ({ ...s, error: error.message }));
      },
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0,
      }
    );
  }, []);

  /**
   * Starts periodic location tracking.
   * Immediately fetches the current location and sets up the interval.
   */
  const startTracking = useCallback(() => {
    setState((s) => ({ ...s, isTracking: true }));
    updateLocation();
  }, [updateLocation]);

  /**
   * Stops location tracking.
   * The interval will be cleared by the useEffect cleanup.
   */
  const stopTracking = useCallback(() => {
    setState((s) => ({ ...s, isTracking: false }));
  }, []);

  useEffect(() => {
    if (autoTrack) {
      startTracking();
    }
  }, [autoTrack, startTracking]);

  useEffect(() => {
    if (!state.isTracking) return;

    const interval = setInterval(updateLocation, intervalMs);
    return () => clearInterval(interval);
  }, [state.isTracking, updateLocation, intervalMs]);

  return {
    ...state,
    startTracking,
    stopTracking,
    updateLocation,
  };
}
