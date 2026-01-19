/**
 * Shared types and interfaces for payment intents
 * @module paymentIntents/types
 */

/**
 * @description Database row representation of a payment intent
 * @interface PaymentIntentRow
 */
export interface PaymentIntentRow {
  id: string;
  /** @description Merchant ID that owns this payment intent */
  merchant_id: string;
  /** @description Optional customer ID associated with this payment */
  customer_id: string | null;
  /** @description Payment amount in the smallest currency unit (e.g., cents) */
  amount: number;
  /** @description Three-letter ISO currency code in lowercase */
  currency: string;
  /** @description Current status of the payment intent */
  status: string;
  /** @description ID of the payment method used for this payment */
  payment_method_id: string | null | undefined;
  /** @description How the payment should be captured: 'automatic' or 'manual' */
  capture_method: string;
  /** @description Optional description for the payment */
  description: string | null;
  /** @description Key-value metadata attached to the payment intent */
  metadata: Record<string, unknown> | null;
  /** @description Unique key for idempotent request handling */
  idempotency_key: string | null;
  /** @description Authorization code from the card network */
  auth_code: string | null | undefined;
  /** @description Decline code if the payment was declined */
  decline_code: string | null;
  /** @description Human-readable error message if payment failed */
  error_message: string | null;
  /** @description Timestamp when the payment intent was created */
  created_at: Date;
}

/**
 * @description Database row representation of a payment method
 * @interface PaymentMethodRow
 */
export interface PaymentMethodRow {
  /** @description Unique payment method identifier */
  id: string;
  /** @description Tokenized card identifier for secure processing */
  card_token: string;
  /** @description Last 4 digits of the card number */
  card_last4: string;
  /** @description Card brand (e.g., 'visa', 'mastercard') */
  card_brand: string;
  /** @description Card expiration month (1-12) */
  card_exp_month: number;
  /** @description Card expiration year (4-digit) */
  card_exp_year: number;
}

/**
 * @description API response format for a payment intent
 * @interface PaymentIntentResponse
 */
export interface PaymentIntentResponse {
  /** @description Unique payment intent identifier */
  id: string;
  /** @description Object type, always 'payment_intent' */
  object: 'payment_intent';
  /** @description Payment amount in the smallest currency unit */
  amount: number;
  /** @description Three-letter ISO currency code */
  currency: string;
  /** @description Current status of the payment intent */
  status: string;
  /** @description Customer ID if associated */
  customer: string | null;
  /** @description Payment method ID if attached */
  payment_method: string | null;
  /** @description Capture method: 'automatic' or 'manual' */
  capture_method: string;
  /** @description Optional payment description */
  description: string | null;
  /** @description Key-value metadata */
  metadata: Record<string, unknown>;
  /** @description Unix timestamp when the payment intent was created */
  created: number;
  /** @description Whether this is a live mode payment (always false in dev) */
  livemode: boolean;
  /** @description Last payment error details, if any */
  last_payment_error?: {
    /** @description Machine-readable decline code */
    decline_code: string;
    /** @description Human-readable error message */
    message: string | null;
  };
  /** @description Fraud risk assessment results */
  risk_assessment?: {
    /** @description Numeric risk score (0-100) */
    risk_score: number;
    /** @description Risk level: 'low', 'medium', 'high' */
    risk_level: string;
    /** @description Decision: 'allow', 'review', 'block' */
    decision: string;
  };
  /** @description Next action required from the client */
  next_action?: {
    /** @description Type of action required */
    type: string;
    /** @description URL to redirect the customer to */
    redirect_url: string;
  };
}

/**
 * @description Request body for creating a payment intent
 * @interface CreatePaymentIntentBody
 */
export interface CreatePaymentIntentBody {
  /** @description Payment amount in cents (required) */
  amount?: number;
  /** @description Three-letter ISO currency code (default: 'usd') */
  currency?: string;
  /** @description Customer ID to associate with this payment */
  customer?: string;
  /** @description Payment method ID to use for this payment */
  payment_method?: string;
  /** @description How to capture: 'automatic' or 'manual' (default: 'automatic') */
  capture_method?: string;
  /** @description Description for the payment */
  description?: string;
  /** @description Key-value metadata to attach */
  metadata?: Record<string, unknown>;
}

/**
 * @description Request body for confirming a payment intent
 * @interface ConfirmPaymentIntentBody
 */
export interface ConfirmPaymentIntentBody {
  /** @description Payment method ID to use for confirmation */
  payment_method?: string;
}

/**
 * @description Request body for capturing a payment intent
 * @interface CapturePaymentIntentBody
 */
export interface CapturePaymentIntentBody {
  /** @description Amount to capture in cents (default: full authorized amount) */
  amount_to_capture?: number;
}

/**
 * @description Request body for canceling a payment intent
 * @interface CancelPaymentIntentBody
 */
export interface CancelPaymentIntentBody {
  /** @description Reason for cancellation */
  cancellation_reason?: string;
}

/**
 * @description Request body for updating a payment intent
 * @interface UpdatePaymentIntentBody
 */
export interface UpdatePaymentIntentBody {
  /** @description New payment amount in cents */
  amount?: number;
  /** @description New currency code */
  currency?: string;
  /** @description New description */
  description?: string;
  /** @description Updated metadata (replaces existing) */
  metadata?: Record<string, unknown>;
}

/**
 * @description Extended Error interface for database errors with PostgreSQL error codes
 * @interface DatabaseError
 * @extends Error
 */
export interface DatabaseError extends Error {
  /** @description PostgreSQL error code (e.g., '23505' for unique violation) */
  code?: string;
  /** @description Name of the constraint that was violated */
  constraint?: string;
}

/**
 * @description Extended Error interface for card network errors
 * @interface CardNetworkError
 * @extends Error
 */
export interface CardNetworkError extends Error {
  /** @description Error name (e.g., 'CardNetworkUnavailableError') */
  name: string;
}
