/**
 * Driver assignment module.
 * Handles driver offers, acceptance/rejection, and assignment.
 *
 * @module services/order/assignment
 */
import { queryOne, execute } from '../../utils/db.js';
import { addDriverOrder, publisher } from '../../utils/redis.js';
import { updateDriverStatus } from '../driverService.js';
import { updateOrderStatus } from './status.js';
import type { Order, DriverOffer } from './types.js';
import { OFFER_EXPIRY_SECONDS } from './types.js';

/**
 * Assigns a driver to an order and updates all related state.
 * Updates order status, adds to driver's active orders in Redis,
 * and sets driver status to busy.
 *
 * @param orderId - The order's UUID
 * @param driverId - The assigned driver's UUID
 * @returns Updated order or null if not found
 */
export async function assignDriverToOrder(
  orderId: string,
  driverId: string
): Promise<Order | null> {
  const order = await updateOrderStatus(orderId, 'driver_assigned', {
    driver_id: driverId,
  });

  if (order) {
    // Add order to driver's active orders in Redis
    await addDriverOrder(driverId, orderId);

    // Update driver status to busy if they have orders
    await updateDriverStatus(driverId, 'busy');
  }

  return order;
}

/**
 * Creates a delivery offer for a specific driver.
 * The offer has a 30-second expiry after which it moves to the next driver.
 * Publishes the offer via Redis for real-time driver notification.
 *
 * @param orderId - The order needing a driver
 * @param driverId - The driver receiving the offer
 * @returns Created offer record
 * @throws Error if offer creation fails
 */
export async function createDriverOffer(
  orderId: string,
  driverId: string
): Promise<DriverOffer> {
  const expiresAt = new Date();
  expiresAt.setSeconds(expiresAt.getSeconds() + OFFER_EXPIRY_SECONDS);

  const offer = await queryOne<DriverOffer>(
    `INSERT INTO driver_offers (order_id, driver_id, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [orderId, driverId, expiresAt]
  );

  if (!offer) {
    throw new Error('Failed to create driver offer');
  }

  // Publish offer to driver
  await publisher.publish(
    `driver:${driverId}:offers`,
    JSON.stringify({
      type: 'new_offer',
      offer_id: offer.id,
      order_id: orderId,
      expires_in: OFFER_EXPIRY_SECONDS,
    })
  );

  return offer;
}

/**
 * Processes a driver's acceptance of a delivery offer.
 * Validates the offer is still valid (not expired, not already responded),
 * then assigns the driver to the order.
 *
 * @param offerId - The offer's UUID
 * @param driverId - The accepting driver's UUID (for verification)
 * @returns Assigned order or null if offer invalid/expired
 */
export async function acceptDriverOffer(
  offerId: string,
  driverId: string
): Promise<Order | null> {
  // Update offer status
  const offer = await queryOne<DriverOffer>(
    `UPDATE driver_offers
     SET status = 'accepted', responded_at = NOW()
     WHERE id = $1 AND driver_id = $2 AND status = 'pending' AND expires_at > NOW()
     RETURNING *`,
    [offerId, driverId]
  );

  if (!offer) {
    return null; // Offer expired, already responded, or doesn't belong to driver
  }

  // Assign driver to order
  return assignDriverToOrder(offer.order_id, driverId);
}

/**
 * Processes a driver's rejection of a delivery offer.
 * Marks the offer as rejected so the system can try the next driver.
 *
 * @param offerId - The offer's UUID
 * @param driverId - The rejecting driver's UUID (for verification)
 * @returns True if rejection recorded, false if offer not found
 */
export async function rejectDriverOffer(
  offerId: string,
  driverId: string
): Promise<boolean> {
  const count = await execute(
    `UPDATE driver_offers
     SET status = 'rejected', responded_at = NOW()
     WHERE id = $1 AND driver_id = $2 AND status = 'pending'`,
    [offerId, driverId]
  );

  return count > 0;
}

/**
 * Retrieves the current pending offer for a driver, if any.
 * Used to check if driver has an active offer to display.
 *
 * @param driverId - The driver's UUID
 * @returns Pending offer or null if none
 */
export async function getPendingOfferForDriver(
  driverId: string
): Promise<DriverOffer | null> {
  return queryOne<DriverOffer>(
    `SELECT * FROM driver_offers
     WHERE driver_id = $1 AND status = 'pending' AND expires_at > NOW()
     ORDER BY offered_at DESC
     LIMIT 1`,
    [driverId]
  );
}

/**
 * Marks all expired offers as expired status.
 * Should be called periodically to clean up stale offers.
 *
 * @returns Number of offers marked as expired
 */
export async function expireOldOffers(): Promise<number> {
  return execute(
    `UPDATE driver_offers
     SET status = 'expired'
     WHERE status = 'pending' AND expires_at < NOW()`
  );
}
