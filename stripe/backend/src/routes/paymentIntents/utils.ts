/**
 * Utility functions for payment intents
 */

import type { PaymentIntentRow, PaymentIntentResponse } from './types.js';

/**
 * Format payment intent row from database for API response
 */
export function formatPaymentIntent(row: PaymentIntentRow): PaymentIntentResponse {
  const response: PaymentIntentResponse = {
    id: row.id,
    object: 'payment_intent',
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    customer: row.customer_id,
    payment_method: row.payment_method_id,
    capture_method: row.capture_method,
    description: row.description,
    metadata: row.metadata || {},
    created: Math.floor(new Date(row.created_at).getTime() / 1000),
    livemode: false,
  };

  if (row.decline_code) {
    response.last_payment_error = {
      decline_code: row.decline_code,
      message: row.error_message,
    };
  }

  return response;
}

/**
 * Get human-readable decline message for a decline code
 */
export function getDeclineMessage(declineCode: string): string {
  const messages: Record<string, string> = {
    insufficient_funds: 'The card has insufficient funds to complete the purchase.',
    card_declined: 'The card was declined.',
    expired_card: 'The card has expired.',
    incorrect_cvc: "The card's security code is incorrect.",
    processing_error: 'An error occurred while processing the card.',
    fraudulent: 'The payment was declined due to suspected fraud.',
  };

  return messages[declineCode] || 'The card was declined.';
}

/**
 * Valid currencies supported by the platform
 */
export const VALID_CURRENCIES = ['usd', 'eur', 'gbp', 'cad', 'aud'];

/**
 * Statuses that allow cancellation
 */
export const CANCELABLE_STATUSES = [
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'requires_capture',
];

/**
 * Statuses that allow updates
 */
export const UPDATABLE_STATUSES = ['requires_payment_method', 'requires_confirmation'];

/**
 * Statuses that allow confirmation
 */
export const CONFIRMABLE_STATUSES = ['requires_payment_method', 'requires_confirmation'];
