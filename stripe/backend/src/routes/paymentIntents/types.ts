/**
 * Shared types and interfaces for payment intents
 */

export interface PaymentIntentRow {
  id: string;
  merchant_id: string;
  customer_id: string | null;
  amount: number;
  currency: string;
  status: string;
  payment_method_id: string | null | undefined;
  capture_method: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  idempotency_key: string | null;
  auth_code: string | null | undefined;
  decline_code: string | null;
  error_message: string | null;
  created_at: Date;
}

export interface PaymentMethodRow {
  id: string;
  card_token: string;
  card_last4: string;
  card_brand: string;
  card_exp_month: number;
  card_exp_year: number;
}

export interface PaymentIntentResponse {
  id: string;
  object: 'payment_intent';
  amount: number;
  currency: string;
  status: string;
  customer: string | null;
  payment_method: string | null;
  capture_method: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created: number;
  livemode: boolean;
  last_payment_error?: {
    decline_code: string;
    message: string | null;
  };
  risk_assessment?: {
    risk_score: number;
    risk_level: string;
    decision: string;
  };
  next_action?: {
    type: string;
    redirect_url: string;
  };
}

export interface CreatePaymentIntentBody {
  amount?: number;
  currency?: string;
  customer?: string;
  payment_method?: string;
  capture_method?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface ConfirmPaymentIntentBody {
  payment_method?: string;
}

export interface CapturePaymentIntentBody {
  amount_to_capture?: number;
}

export interface CancelPaymentIntentBody {
  cancellation_reason?: string;
}

export interface UpdatePaymentIntentBody {
  amount?: number;
  currency?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface DatabaseError extends Error {
  code?: string;
  constraint?: string;
}

export interface CardNetworkError extends Error {
  name: string;
}
