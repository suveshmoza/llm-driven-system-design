/**
 * Availability Cache Management
 *
 * Handles cache invalidation for availability data.
 */

import redis from '../../models/redis.js';
import { logger } from '../../shared/index.js';

export const AVAILABILITY_CACHE_TTL = 300; // 5 minutes

/**
 * Invalidate availability cache for affected date range
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
