import type { VehicleType, RideRow, MatchingRequest } from '../../types/index.js';
import redis from '../../utils/redis.js';
import locationService from '../locationService.js';
import config from '../../config/index.js';
import { publishToQueue, QUEUES } from '../../utils/queue.js';
import { createLogger } from '../../utils/logger.js';
import { scoreDrivers } from './scoring.js';
import { RIDE_PREFIX } from './types.js';

const logger = createLogger('driver-finder');

// Forward declaration for circular dependency resolution
type OfferRideToDriverFn = (
  rideId: string,
  driverId: string,
  pickupLat: number,
  pickupLng: number
) => Promise<boolean>;

type HandleNoDriversFoundFn = (rideId: string) => Promise<void>;

let offerRideToDriverFn: OfferRideToDriverFn;
let handleNoDriversFoundFn: HandleNoDriversFoundFn;

/**
 * Set the offer ride to driver function (to avoid circular dependencies)
 */
export function setOfferRideToDriver(fn: OfferRideToDriverFn): void {
  offerRideToDriverFn = fn;
}

/**
 * Set the no drivers found handler function (to avoid circular dependencies)
 */
export function setHandleNoDriversFound(fn: HandleNoDriversFoundFn): void {
  handleNoDriversFoundFn = fn;
}

/**
 * Find a driver for the ride.
 * Expands search radius with each attempt.
 * Requeues if no drivers found or all decline.
 */
export async function findDriver(
  rideId: string,
  pickupLat: number,
  pickupLng: number,
  vehicleType: VehicleType,
  attempt: number = 1
): Promise<void> {
  const maxAttempts = 3;
  const radiusMultiplier = attempt; // Expand radius with each attempt

  const radiusKm = Math.min(
    config.matching.searchRadiusKm * radiusMultiplier,
    config.matching.maxSearchRadiusKm
  );

  logger.debug({ rideId, attempt, radiusKm }, 'Searching for nearby drivers');

  // Find nearby drivers
  let drivers = await locationService.findNearbyDrivers(pickupLat, pickupLng, radiusKm);

  // Filter by vehicle type if specified
  if (vehicleType !== 'economy') {
    drivers = drivers.filter((d) => d.vehicleType === vehicleType);
  }

  if (drivers.length === 0) {
    if (attempt < maxAttempts) {
      // Requeue with incremented attempt after delay
      setTimeout(async () => {
        await publishToQueue(QUEUES.MATCHING_REQUESTS, {
          requestId: `${rideId}-attempt-${attempt + 1}`,
          rideId,
          pickupLocation: { lat: pickupLat, lng: pickupLng },
          dropoffLocation: { lat: 0, lng: 0 }, // Will be ignored in retry
          vehicleType,
          attempt: attempt + 1,
        });
      }, 5000);
      return;
    }

    // No drivers found after all attempts
    await handleNoDriversFoundFn(rideId);
    return;
  }

  // Score and rank drivers
  const scoredDrivers = scoreDrivers(drivers, pickupLat, pickupLng);

  // Try to match with best driver
  for (const driver of scoredDrivers) {
    const matched = await offerRideToDriverFn(rideId, driver.id, pickupLat, pickupLng);
    if (matched) {
      return; // Successfully matched
    }
  }

  // All drivers declined, retry
  if (attempt < maxAttempts) {
    setTimeout(async () => {
      await publishToQueue(QUEUES.MATCHING_REQUESTS, {
        requestId: `${rideId}-attempt-${attempt + 1}`,
        rideId,
        pickupLocation: { lat: pickupLat, lng: pickupLng },
        dropoffLocation: { lat: 0, lng: 0 },
        vehicleType,
        attempt: attempt + 1,
      });
    }, 5000);
  } else {
    await handleNoDriversFoundFn(rideId);
  }
}

/**
 * Process matching request from queue.
 * Checks if ride is still pending before attempting to find a driver.
 */
export async function processMatchingRequest(message: MatchingRequest): Promise<void> {
  const { rideId, pickupLocation, vehicleType, attempt } = message;

  logger.debug({ rideId, attempt }, 'Processing matching request from queue');

  // Check if ride is still pending
  const rideData = await redis.hgetall(`${RIDE_PREFIX}${rideId}`);
  if (!rideData || rideData.status !== 'requested') {
    logger.info({ rideId }, 'Ride no longer pending, skipping matching');
    return;
  }

  await findDriver(
    rideId,
    pickupLocation.lat,
    pickupLocation.lng,
    vehicleType,
    attempt
  );
}
