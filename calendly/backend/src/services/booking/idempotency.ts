/**
 * Idempotency handling helpers for booking operations.
 * Extracts idempotency logic to keep create.ts under 200 lines.
 */

import { type Booking, type CreateBookingResult } from './types.js';
import { idempotencyService, IdempotencyService } from '../../shared/idempotency.js';
import { logger } from '../../shared/logger.js';

const bookingLogger = logger.child({ module: 'booking-idempotency' });

/**
 * Checks if a booking request has already been processed (idempotent).
 * @param meetingTypeId - Meeting type ID
 * @param startTime - Start time
 * @param inviteeEmail - Invitee email
 * @param providedKey - Optional client-provided idempotency key
 * @returns Cached result if found, null otherwise, plus the effective key
 */
export async function checkBookingIdempotency(
  meetingTypeId: string,
  startTime: string,
  inviteeEmail: string,
  providedKey?: string
): Promise<{ cached: CreateBookingResult | null; effectiveKey: string }> {
  const effectiveKey =
    providedKey ||
    IdempotencyService.generateBookingKey(meetingTypeId, startTime, inviteeEmail);

  const existingResult = await idempotencyService.checkIdempotency(effectiveKey);
  if (existingResult.found && existingResult.result) {
    bookingLogger.info('Returning cached booking result (idempotent)');
    return {
      cached: {
        booking: existingResult.result as Booking,
        cached: true,
      },
      effectiveKey,
    };
  }

  return { cached: null, effectiveKey };
}

/**
 * Attempts to acquire an idempotency lock for a booking request.
 * If lock cannot be acquired, waits briefly and checks for cached result.
 * @param effectiveKey - The idempotency key
 * @returns true if lock acquired, cached result if another request finished
 * @throws Error if request is still being processed
 */
export async function acquireBookingLock(
  effectiveKey: string
): Promise<{ lockAcquired: true } | { lockAcquired: false; cached: CreateBookingResult }> {
  const lockAcquired = await idempotencyService.acquireLock(effectiveKey);

  if (!lockAcquired) {
    bookingLogger.warn('Could not acquire idempotency lock, another request is processing');
    // Wait briefly and check for result again
    await new Promise((resolve) => setTimeout(resolve, 100));
    const retryResult = await idempotencyService.checkIdempotency(effectiveKey);
    if (retryResult.found && retryResult.result) {
      return {
        lockAcquired: false,
        cached: {
          booking: retryResult.result as Booking,
          cached: true,
        },
      };
    }
    throw new Error('Request is being processed. Please wait and try again.');
  }

  return { lockAcquired: true };
}

/**
 * Stores the booking result for idempotency and releases the lock.
 * @param effectiveKey - The idempotency key
 * @param booking - The created booking
 */
export async function storeBookingResult(
  effectiveKey: string,
  booking: Booking
): Promise<void> {
  await idempotencyService.storeResult(effectiveKey, booking, 201);
}

/**
 * Releases the idempotency lock.
 * @param effectiveKey - The idempotency key
 */
export async function releaseBookingLock(effectiveKey: string): Promise<void> {
  await idempotencyService.releaseLock(effectiveKey);
}
