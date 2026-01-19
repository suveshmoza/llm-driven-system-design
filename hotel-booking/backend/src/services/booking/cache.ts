/**
 * Availability Cache Management
 *
 * Handles cache invalidation for availability data.
 */

import redis from '../../models/redis.js';
import { logger } from '../../shared/index.js';

/**
 * @description Time-to-live for availability cache entries in seconds.
 * Set to 5 minutes to balance freshness with database load reduction.
 */
export const AVAILABILITY_CACHE_TTL = 300; // 5 minutes

/**
 * @description Invalidates availability cache entries for a given hotel, room type, and date range.
 * This function should be called whenever a booking state changes (creation, confirmation,
 * cancellation, or expiration) to ensure users see accurate availability information.
 *
 * The function invalidates:
 * - Monthly calendar cache entries for all months in the date range
 * - Specific availability check cache for the exact date range
 *
 * @param {string} hotelId - The unique identifier of the hotel
 * @param {string} roomTypeId - The unique identifier of the room type
 * @param {string} checkIn - Check-in date in ISO format (YYYY-MM-DD)
 * @param {string} checkOut - Check-out date in ISO format (YYYY-MM-DD)
 * @returns {Promise<void>} Resolves when all cache keys have been deleted
 *
 * @example
 * // Invalidate cache after a booking is created
 * await invalidateAvailabilityCache(
 *   'hotel-123',
 *   'room-type-456',
 *   '2024-03-15',
 *   '2024-03-20'
 * );
 */
export async function invalidateAvailabilityCache(
  hotelId: string,
  roomTypeId: string,
  checkIn: string,
  checkOut: string
): Promise<void> {
  const start = new Date(checkIn);
  const end = new Date(checkOut);

  const months = new Set<string>();
  for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
    months.add(`${d.getFullYear()}-${d.getMonth() + 1}`);
  }

  const keysToDelete: string[] = [];
  for (const monthKey of months) {
    keysToDelete.push(`availability:${hotelId}:${roomTypeId}:${monthKey}`);
  }

  // Also invalidate the specific check availability cache
  keysToDelete.push(`availability:check:${hotelId}:${roomTypeId}:${checkIn}:${checkOut}`);

  // Delete all cache keys
  if (keysToDelete.length > 0) {
    await redis.del(...keysToDelete);
    logger.debug({ keysDeleted: keysToDelete.length }, 'Invalidated availability cache');
  }
}
