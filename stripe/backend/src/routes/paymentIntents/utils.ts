/**
 * Utility functions for payment intents
 * @module paymentIntents/utils
 */

import type { PaymentIntentRow, PaymentIntentResponse } from './types.js';

/**
 * @description Transforms a database payment intent row into an API response format
 * @param {PaymentIntentRow} row - The database row to format
 * @returns {PaymentIntentResponse} Formatted payment intent for API response
 * @example
 * const dbRow = await query('SELECT * FROM payment_intents WHERE id = $1', [id]);
 * const response = formatPaymentIntent(dbRow.rows[0]);
 */
export function formatPaymentIntent(row: PaymentIntentRow): PaymentIntentResponse {
  const response: PaymentIntentResponse = {
    id: row.id,
    object: 'payment_intent',
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    customer: row.customer_id,
    payment_method: row.payment_method_id ?? null,
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
 * @description Returns a human-readable error message for a given decline code
 * @param {string} declineCode - The machine-readable decline code from the card network
 * @returns {string} A user-friendly message explaining the decline reason
 * @example
 * const message = getDeclineMessage('insufficient_funds');
 * // Returns: 'The card has insufficient funds to complete the purchase.'
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
 * @description List of valid ISO 4217 currency codes supported by the platform
 * @constant {string[]}
 */
export const VALID_CURRENCIES = ['usd', 'eur', 'gbp', 'cad', 'aud'];

/**
 * @description Payment intent statuses that allow cancellation
 * @constant {string[]}
 */
export const CANCELABLE_STATUSES = [
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'requires_capture',
];

/**
 * @description Payment intent statuses that allow updates to amount, currency, description, or metadata
 * @constant {string[]}
 */
export const UPDATABLE_STATUSES = ['requires_payment_method', 'requires_confirmation'];

/**
 * @description Payment intent statuses that allow confirmation
 * @constant {string[]}
 */
export const CONFIRMABLE_STATUSES = ['requires_payment_method', 'requires_confirmation'];
