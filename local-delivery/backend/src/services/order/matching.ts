/**
 * Driver matching module.
 * Handles driver matching logic with circuit breaker protection.
 *
 * @module services/order/matching
 */
import { queryOne, execute } from '../../utils/db.js';
import { findBestDriver } from '../driverService.js';
import { createCircuitBreaker } from '../../shared/circuitBreaker.js';
import { matchingLogger } from '../../shared/logger.js';
import {
  driverAssignmentsCounter,
  driverMatchingDurationHistogram,
} from '../../shared/metrics.js';
import { getOrderWithDetails } from './tracking.js';
import { updateOrderStatus } from './status.js';
import { createDriverOffer } from './assignment.js';
import type { DriverOffer, Location } from './types.js';
import {
  OFFER_EXPIRY_SECONDS,
  MAX_OFFER_ATTEMPTS,
  DRIVER_MATCHING_TIMEOUT_MS,
  CIRCUIT_BREAKER_ERROR_THRESHOLD,
  CIRCUIT_BREAKER_VOLUME_THRESHOLD,
  CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
} from './types.js';

/** Waits for driver offer response, polling the database until timeout. */
async function waitForOfferResponse(
  offerId: string,
  timeoutMs: number
): Promise<'accepted' | 'rejected' | 'expired'> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const offer = await queryOne<DriverOffer>(
      `SELECT status FROM driver_offers WHERE id = $1`,
      [offerId]
    );

    if (offer?.status === 'accepted') return 'accepted';
    if (offer?.status === 'rejected') return 'rejected';

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  await execute(
    `UPDATE driver_offers SET status = 'expired' WHERE id = $1 AND status = 'pending'`,
    [offerId]
  );

  return 'expired';
}

/**
 * Initiates driver matching for a new order. Sequentially offers to nearby
 * drivers, waiting for each response. Cancels order if no driver accepts.
 */
export async function startDriverMatching(orderId: string): Promise<boolean> {
  const order = await getOrderWithDetails(orderId);
  if (!order || !order.merchant) return false;

  const merchantLocation: Location = {
    lat: order.merchant.lat,
    lng: order.merchant.lng,
  };

  const excludedDrivers = new Set<string>();
  let attempt = 0;

  while (attempt < MAX_OFFER_ATTEMPTS) {
    const driver = await findBestDriver(merchantLocation, excludedDrivers);

    if (!driver) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      attempt++;
      continue;
    }

    const offer = await createDriverOffer(orderId, driver.id);
    const response = await waitForOfferResponse(offer.id, OFFER_EXPIRY_SECONDS * 1000);

    if (response === 'accepted') return true;

    excludedDrivers.add(driver.id);
    attempt++;
  }

  await updateOrderStatus(orderId, 'cancelled', {
    cancellation_reason: 'No driver available',
  });

  return false;
}

/**
 * Circuit breaker for driver matching service.
 * Fails fast when service is degraded and provides fallback behavior.
 */
const driverMatchingCircuitBreaker = createCircuitBreaker<[string], boolean>(
  'driver-matching',
  async (orderId: string): Promise<boolean> => {
    const startTime = Date.now();

    try {
      const result = await startDriverMatching(orderId);
      const duration = (Date.now() - startTime) / 1000;

      driverMatchingDurationHistogram.observe(duration);

      if (result) {
        driverAssignmentsCounter.inc({ result: 'assigned' });
        matchingLogger.info({ orderId, duration }, 'Driver matching succeeded');
      } else {
        driverAssignmentsCounter.inc({ result: 'no_driver' });
        matchingLogger.warn({ orderId, duration }, 'No driver available for order');
      }

      return result;
    } catch (error) {
      driverAssignmentsCounter.inc({ result: 'error' });
      throw error;
    }
  },
  {
    timeout: DRIVER_MATCHING_TIMEOUT_MS,
    errorThresholdPercentage: CIRCUIT_BREAKER_ERROR_THRESHOLD,
    volumeThreshold: CIRCUIT_BREAKER_VOLUME_THRESHOLD,
    resetTimeout: CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
  }
);

// Fallback: queue order for retry when circuit is open
driverMatchingCircuitBreaker.fallback(async (orderId: string): Promise<boolean> => {
  matchingLogger.warn({ orderId }, 'Circuit breaker open, queueing order for retry');

  await updateOrderStatus(orderId, 'pending', { cancellation_reason: null });
  matchingLogger.error({ orderId }, 'Order queued for retry - circuit breaker open');

  return false;
});

/**
 * Starts driver matching with circuit breaker protection.
 * Preferred entry point for initiating driver matching.
 */
export async function startDriverMatchingWithCircuitBreaker(
  orderId: string
): Promise<boolean> {
  try {
    return await driverMatchingCircuitBreaker.fire(orderId);
  } catch (error) {
    matchingLogger.error(
      { orderId, error: (error as Error).message },
      'Driver matching circuit breaker error'
    );
    return false;
  }
}

/** Gets the current status of the driver matching circuit breaker. */
export function getDriverMatchingCircuitBreakerStatus() {
  return {
    state: driverMatchingCircuitBreaker.opened
      ? 'open'
      : driverMatchingCircuitBreaker.halfOpen
        ? 'halfOpen'
        : 'closed',
    stats: {
      failures: driverMatchingCircuitBreaker.stats.failures,
      successes: driverMatchingCircuitBreaker.stats.successes,
      fallbacks: driverMatchingCircuitBreaker.stats.fallbacks,
      timeouts: driverMatchingCircuitBreaker.stats.timeouts,
    },
  };
}
