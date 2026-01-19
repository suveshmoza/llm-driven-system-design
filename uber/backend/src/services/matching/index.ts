import type { WebSocket } from 'ws';
import { query } from '../../utils/db.js';
import redis from '../../utils/redis.js';
import pricingService from '../pricingService.js';
import config from '../../config/index.js';
import { publishToQueue, publishToExchange, consumeQueue, QUEUES, EXCHANGES } from '../../utils/queue.js';
import { createLogger } from '../../utils/logger.js';
import { metrics } from '../../utils/metrics.js';
import { withRetry } from '../../utils/circuitBreaker.js';
import type {
  VehicleType,
  RideRow,
  MatchingRequest,
} from '../../types/index.js';

// Import types
import type {
  WSMessage,
  RideRequestResult,
  AcceptRideResult,
  CompleteRideResult,
  CancelRideResult,
  Ride,
} from './types.js';
import { PENDING_REQUESTS_KEY, RIDE_PREFIX } from './types.js';

// Import modules
import { scoreDrivers } from './scoring.js';
import { findDriver, processMatchingRequest, setOfferRideToDriver, setHandleNoDriversFound } from './driver-finder.js';
import { offerRideToDriver, acceptRide, setSendToUser as setAllocationSendToUser, setMatchingTimers as setAllocationTimers } from './allocation.js';
import {
  driverArrived,
  startRide,
  completeRide,
  cancelRide,
  handleNoDriversFound,
  setSendToUser as setLifecycleSendToUser,
  setMatchingTimers as setLifecycleTimers,
} from './ride-lifecycle.js';
import { getRideStatus } from './ride-status.js';

const logger = createLogger('matching-service');

/**
 * MatchingService class that orchestrates all matching-related operations.
 * Maintains the same public API as the original monolithic implementation.
 */
class MatchingService {
  private wsClients: Map<string, WebSocket> = new Map();
  private matchingTimers: Map<string, number> = new Map();

  constructor() {
    // Wire up dependencies between modules
    setOfferRideToDriver(this.offerRideToDriver.bind(this));
    setHandleNoDriversFound(this.handleNoDriversFound.bind(this));
    setAllocationSendToUser(this.sendToUser.bind(this));
    setAllocationTimers(this.matchingTimers);
    setLifecycleSendToUser(this.sendToUser.bind(this));
    setLifecycleTimers(this.matchingTimers);
  }

  // Register WebSocket connection for real-time updates
  registerClient(userId: string, ws: WebSocket): void {
    this.wsClients.set(userId, ws);
    logger.debug({ userId }, 'WebSocket client registered');
  }

  // Unregister WebSocket connection
  unregisterClient(userId: string): void {
    this.wsClients.delete(userId);
    logger.debug({ userId }, 'WebSocket client unregistered');
  }

  // Send message to a user
  sendToUser(userId: string, message: WSMessage): boolean {
    const ws = this.wsClients.get(userId);
    if (ws && ws.readyState === 1) {
      // WebSocket.OPEN
      ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  // Initialize queue consumers for async matching
  async initializeQueues(): Promise<void> {
    try {
      // Start consuming matching requests
      await consumeQueue<MatchingRequest>(
        QUEUES.MATCHING_REQUESTS,
        async (message) => {
          await this.processMatchingRequest(message);
        },
        { maxRetries: 3 }
      );

      logger.info('Matching service queue consumers initialized');
    } catch (error) {
      const err = error as Error;
      logger.error({ error: err.message }, 'Failed to initialize matching queues');
    }
  }

  // Request a ride - now publishes to queue for async processing
  async requestRide(
    riderId: string,
    pickupLat: number,
    pickupLng: number,
    dropoffLat: number,
    dropoffLng: number,
    vehicleType: VehicleType = 'economy',
    pickupAddress: string | null = null,
    dropoffAddress: string | null = null
  ): Promise<RideRequestResult> {
    const startTime = Date.now();

    // Increment demand for surge pricing
    await pricingService.incrementDemand(pickupLat, pickupLng);

    // Get fare estimate
    const fareEstimate = await pricingService.getFareEstimate(
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      vehicleType
    );

    // Track surge pricing metrics
    if (fareEstimate.surgeMultiplier > 1.0) {
      const multiplierRange =
        fareEstimate.surgeMultiplier <= 1.5 ? '1.1-1.5' :
        fareEstimate.surgeMultiplier <= 2.0 ? '1.6-2.0' : '2.1+';
      metrics.surgeEventCounter.inc({ multiplier_range: multiplierRange });
    }

    // Create ride in database with retry
    const result = await withRetry(
      async () => {
        return await query<RideRow>(
          `INSERT INTO rides (
            rider_id, status, pickup_lat, pickup_lng, pickup_address,
            dropoff_lat, dropoff_lng, dropoff_address, vehicle_type,
            estimated_fare_cents, surge_multiplier, distance_meters
          ) VALUES ($1, 'requested', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *`,
          [
            riderId,
            pickupLat,
            pickupLng,
            pickupAddress,
            dropoffLat,
            dropoffLng,
            dropoffAddress,
            vehicleType,
            fareEstimate.totalFareCents,
            fareEstimate.surgeMultiplier,
            Math.round(fareEstimate.distanceKm * 1000),
          ]
        );
      },
      { maxRetries: 2, baseDelay: 100 }
    );

    const ride = result.rows[0];

    // Store in Redis for quick access
    await redis.hset(`${RIDE_PREFIX}${ride.id}`, {
      riderId,
      status: 'requested',
      pickupLat: pickupLat.toString(),
      pickupLng: pickupLng.toString(),
      dropoffLat: dropoffLat.toString(),
      dropoffLng: dropoffLng.toString(),
      vehicleType,
      createdAt: Date.now().toString(),
    });

    // Add to pending requests
    await redis.zadd(PENDING_REQUESTS_KEY, Date.now(), ride.id);

    // Track metrics
    metrics.rideRequestsTotal.inc({ vehicle_type: vehicleType, status: 'requested' });
    metrics.rideStatusGauge.inc({ status: 'requested' });

    // Start matching timer for latency tracking
    this.matchingTimers.set(ride.id, startTime);

    // Publish matching request to queue for async processing
    await publishToQueue(QUEUES.MATCHING_REQUESTS, {
      requestId: ride.id, // Use ride ID as idempotency key
      rideId: ride.id,
      pickupLocation: { lat: pickupLat, lng: pickupLng },
      dropoffLocation: { lat: dropoffLat, lng: dropoffLng },
      vehicleType,
      maxWaitSeconds: config.matching.matchingTimeoutSeconds,
      attempt: 1,
      riderId,
    });

    // Publish ride event to fanout exchange
    await publishToExchange(EXCHANGES.RIDE_EVENTS, '', {
      eventId: `${ride.id}-requested`,
      eventType: 'requested',
      rideId: ride.id,
      timestamp: Date.now(),
      payload: {
        riderId,
        pickupLocation: { lat: pickupLat, lng: pickupLng },
        dropoffLocation: { lat: dropoffLat, lng: dropoffLng },
        vehicleType,
        estimatedFare: fareEstimate.totalFareCents,
        surgeMultiplier: fareEstimate.surgeMultiplier,
      },
    });

    logger.info(
      { rideId: ride.id, riderId, vehicleType, surgeMultiplier: fareEstimate.surgeMultiplier },
      'Ride requested'
    );

    return {
      rideId: ride.id,
      status: 'requested',
      fareEstimate,
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      vehicleType,
    };
  }

  // Process matching request from queue - delegates to driver-finder module
  async processMatchingRequest(message: MatchingRequest): Promise<void> {
    return processMatchingRequest(message);
  }

  // Find a driver for the ride - delegates to driver-finder module
  async findDriver(
    rideId: string,
    pickupLat: number,
    pickupLng: number,
    vehicleType: VehicleType,
    attempt: number = 1
  ): Promise<void> {
    return findDriver(rideId, pickupLat, pickupLng, vehicleType, attempt);
  }

  // Score drivers for ranking - delegates to scoring module
  scoreDrivers = scoreDrivers;

  // Offer ride to a driver - delegates to allocation module
  async offerRideToDriver(
    rideId: string,
    driverId: string,
    pickupLat: number,
    pickupLng: number
  ): Promise<boolean> {
    return offerRideToDriver(rideId, driverId, pickupLat, pickupLng);
  }

  // Driver accepts the ride - delegates to allocation module
  async acceptRide(rideId: string, driverId: string): Promise<AcceptRideResult> {
    return acceptRide(rideId, driverId);
  }

  // Driver arrives at pickup - delegates to ride-lifecycle module
  async driverArrived(rideId: string, driverId: string): Promise<{ success: boolean }> {
    return driverArrived(rideId, driverId);
  }

  // Start the ride (pickup completed) - delegates to ride-lifecycle module
  async startRide(rideId: string, driverId: string): Promise<{ success: boolean }> {
    return startRide(rideId, driverId);
  }

  // Complete the ride - delegates to ride-lifecycle module
  async completeRide(
    rideId: string,
    driverId: string,
    finalDistanceMeters: number | null = null
  ): Promise<CompleteRideResult> {
    return completeRide(rideId, driverId, finalDistanceMeters);
  }

  // Cancel the ride - delegates to ride-lifecycle module
  async cancelRide(
    rideId: string,
    cancelledBy: string,
    reason: string | null = null
  ): Promise<CancelRideResult> {
    return cancelRide(rideId, cancelledBy, reason);
  }

  // Handle no drivers found - delegates to ride-lifecycle module
  async handleNoDriversFound(rideId: string): Promise<void> {
    return handleNoDriversFound(rideId);
  }

  // Get ride status - delegates to ride-lifecycle module
  async getRideStatus(rideId: string): Promise<Ride | null> {
    return getRideStatus(rideId);
  }
}

export default new MatchingService();

// Also export individual functions for direct use if needed
export {
  scoreDrivers,
  findDriver,
  processMatchingRequest,
  offerRideToDriver,
  acceptRide,
  driverArrived,
  startRide,
  completeRide,
  cancelRide,
  handleNoDriversFound,
  getRideStatus,
};

// Export types for consumers
export type {
  WSMessage,
  RideRequestResult,
  AcceptRideResult,
  CompleteRideResult,
  CancelRideResult,
};
