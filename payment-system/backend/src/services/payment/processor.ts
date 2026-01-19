/**
 * Payment processor integration module.
 * Handles communication with external payment processors (Stripe, Adyen, etc.)
 * with circuit breaker protection for resilience.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  logger,
  processorCircuitBreaker,
} from '../../shared/index.js';
import type { CreatePaymentRequest } from './types.js';

/**
 * Result of a processor authorization attempt.
 */
export interface ProcessorAuthResult {
  success: boolean;
  processorRef?: string;
  declineReason?: string;
}

/**
 * Authorizes payment with external processor using circuit breaker protection.
 *
 * WHY CIRCUIT BREAKER: Payment processors can experience outages.
 * Without protection:
 * - All requests queue up waiting for timeouts
 * - Connection pools exhaust
 * - Cascading failures affect the entire system
 *
 * With circuit breaker:
 * - Fail fast after threshold (5 consecutive failures)
 * - System remains responsive for other operations
 * - Automatic recovery when processor comes back
 *
 * @param amount - Transaction amount in cents
 * @param paymentMethod - Payment method details
 * @returns Authorization result with success flag and processor reference
 */
export async function authorizeWithProcessor(
  amount: number,
  paymentMethod: CreatePaymentRequest['payment_method']
): Promise<ProcessorAuthResult> {
  try {
    const success = await processorCircuitBreaker.policy.execute(async () => {
      return simulateProcessorAuth(amount, paymentMethod);
    });

    if (success) {
      return {
        success: true,
        processorRef: `proc_${uuidv4().slice(0, 8)}`,
      };
    }

    return {
      success: false,
      declineReason: 'Processor declined',
    };
  } catch (error) {
    logger.error(
      { error, amount },
      'Payment processor authorization failed (circuit breaker may be open)'
    );
    return {
      success: false,
      declineReason: 'Processor unavailable',
    };
  }
}

/**
 * Simulates payment processor authorization.
 * In production, this would call real payment processors (Stripe, Adyen, etc.).
 * Returns false for test decline card numbers or high-risk amounts.
 *
 * @param amount - Transaction amount in cents
 * @param paymentMethod - Payment method details for simulation logic
 * @returns True if authorization succeeds, false if declined
 */
async function simulateProcessorAuth(
  amount: number,
  paymentMethod: CreatePaymentRequest['payment_method']
): Promise<boolean> {
  // Simulate some processing time
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Simulate decline for test card numbers or high amounts
  if (paymentMethod.last_four === '0000') {
    return false; // Test decline
  }

  if (amount > 1000000) {
    // Over $10,000 has higher decline rate
    return Math.random() > 0.3;
  }

  // 95% success rate for normal transactions
  return Math.random() > 0.05;
}

/**
 * Captures authorized funds with the processor.
 * In production, this would call the processor's capture API.
 *
 * @param processorRef - Reference from the authorization
 * @param amount - Amount to capture in cents
 * @returns True if capture succeeds
 */
export async function captureWithProcessor(
  processorRef: string,
  amount: number
): Promise<boolean> {
  // Simulate some processing time
  await new Promise((resolve) => setTimeout(resolve, 50));

  // In production, call processor API
  // For now, always succeed if we have a valid processor ref
  return processorRef.startsWith('proc_');
}

/**
 * Voids an authorization with the processor.
 * In production, this would call the processor's void/cancel API.
 *
 * @param processorRef - Reference from the authorization
 * @returns True if void succeeds
 */
export async function voidWithProcessor(processorRef: string): Promise<boolean> {
  // Simulate some processing time
  await new Promise((resolve) => setTimeout(resolve, 50));

  // In production, call processor API
  return processorRef.startsWith('proc_');
}

/**
 * Initiates a refund with the processor.
 * In production, this would call the processor's refund API.
 *
 * @param processorRef - Reference from the original authorization
 * @param amount - Amount to refund in cents
 * @returns Refund processor reference if successful
 */
export async function refundWithProcessor(
  processorRef: string,
  amount: number
): Promise<{ success: boolean; refundRef?: string }> {
  // Simulate some processing time
  await new Promise((resolve) => setTimeout(resolve, 100));

  // In production, call processor API
  if (processorRef.startsWith('proc_')) {
    return {
      success: true,
      refundRef: `ref_${uuidv4().slice(0, 8)}`,
    };
  }

  return { success: false };
}
