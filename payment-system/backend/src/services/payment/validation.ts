/**
 * Payment validation module.
 * Handles fee calculation, idempotency checking, and input validation.
 */

import { redis } from '../../db/connection.js';
import { queryOne } from '../../db/connection.js';
import type { Transaction, FeeConfig, FeeCalculation } from './types.js';

/** Default fee configuration */
const DEFAULT_FEE_CONFIG: FeeConfig = {
  feePercent: parseFloat(process.env.TRANSACTION_FEE_PERCENT || '2.9'),
  feeFixed: parseInt(process.env.TRANSACTION_FEE_FIXED || '30', 10),
};

/**
 * Calculates the platform fee for a given transaction amount.
 * Uses percentage + fixed fee model (e.g., 2.9% + $0.30).
 *
 * @param amount - Transaction amount in cents
 * @param config - Optional fee configuration override
 * @returns Fee calculation with fee amount and net amount
 */
export function calculateFee(
  amount: number,
  config: FeeConfig = DEFAULT_FEE_CONFIG
): FeeCalculation {
  const feeAmount = Math.round(amount * (config.feePercent / 100) + config.feeFixed);
  const netAmount = amount - feeAmount;
  return { feeAmount, netAmount };
}

/**
 * Checks if a payment request has already been processed using its idempotency key.
 * Prevents duplicate charges when clients retry failed network requests.
 * Checks Redis cache first, then falls back to database lookup.
 *
 * @param key - Unique idempotency key provided by the client
 * @returns Existing transaction if found, null if this is a new request
 * @deprecated Use withIdempotency from shared/idempotency.ts instead
 */
export async function checkIdempotency(key: string): Promise<Transaction | null> {
  // First check Redis cache
  const cached = await redis.get(`idempotency:${key}`);
  if (cached) {
    return JSON.parse(cached) as Transaction;
  }

  // Fall back to database
  const existing = await queryOne<Transaction>(
    'SELECT * FROM transactions WHERE idempotency_key = $1',
    [key]
  );

  if (existing) {
    // Cache for future requests (24 hour TTL)
    await redis.setex(`idempotency:${key}`, 86400, JSON.stringify(existing));
  }

  return existing;
}

/**
 * Validates that a transaction can be captured.
 *
 * @param transaction - Transaction to validate
 * @returns Object with isValid flag and optional error message
 */
export function validateForCapture(
  transaction: Transaction | null
): { isValid: boolean; error?: string } {
  if (!transaction) {
    return { isValid: false, error: 'Transaction not found' };
  }

  // Idempotent: already captured is valid
  if (transaction.status === 'captured') {
    return { isValid: true };
  }

  if (transaction.status !== 'authorized') {
    return { isValid: false, error: `Cannot capture transaction in status: ${transaction.status}` };
  }

  return { isValid: true };
}

/**
 * Validates that a transaction can be voided.
 *
 * @param transaction - Transaction to validate
 * @returns Object with isValid flag and optional error message
 */
export function validateForVoid(
  transaction: Transaction | null
): { isValid: boolean; error?: string } {
  if (!transaction) {
    return { isValid: false, error: 'Transaction not found' };
  }

  // Idempotent: already voided is valid
  if (transaction.status === 'voided') {
    return { isValid: true };
  }

  if (transaction.status !== 'authorized') {
    return { isValid: false, error: `Cannot void transaction in status: ${transaction.status}` };
  }

  return { isValid: true };
}

/**
 * Gets the default fee configuration.
 */
export function getDefaultFeeConfig(): FeeConfig {
  return { ...DEFAULT_FEE_CONFIG };
}
