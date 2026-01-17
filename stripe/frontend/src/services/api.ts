/**
 * API Service for Stripe Clone
 *
 * This module provides a centralized API client for communicating with the
 * Stripe-like payment processing backend. It handles authentication via
 * merchant API keys and provides typed methods for all payment operations.
 *
 * @module services/api
 */

import { useMerchantStore } from '@/stores/merchantStore';
import type {
  PaymentIntent,
  Customer,
  PaymentMethod,
  Charge,
  Refund,
  Balance,
  BalanceSummary,
  BalanceTransaction,
  WebhookEvent,
  WebhookEndpoint,
  Merchant,
  ListResponse,
  ApiError,
} from '@/types';

/** Base URL for all API endpoints */
const API_BASE = '/v1';

/**
 * Generic fetch wrapper for API requests.
 * Handles authentication by injecting the merchant API key from the store,
 * and provides consistent error handling across all API calls.
 *
 * @template T - The expected response type
 * @param endpoint - The API endpoint path (will be prefixed with API_BASE)
 * @param options - Standard fetch options (method, body, headers, etc.)
 * @returns Promise resolving to the typed response data
 * @throws Error if the API returns a non-OK response
 */
async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const apiKey = useMerchantStore.getState().apiKey;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (apiKey) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json();

  if (!response.ok) {
    const error = data as ApiError;
    throw new Error(error.error?.message || 'An error occurred');
  }

  return data as T;
}

// ============================================================================
// Payment Intents API
// ============================================================================

/**
 * Retrieves a paginated list of payment intents for the authenticated merchant.
 * Payment intents track the lifecycle of a payment from creation to completion.
 *
 * @param params - Query parameters for filtering and pagination
 * @param params.limit - Maximum number of results to return
 * @param params.offset - Number of results to skip for pagination
 * @param params.status - Filter by payment intent status (e.g., 'succeeded', 'failed')
 * @returns Paginated list of payment intents
 */
export async function listPaymentIntents(
  params: { limit?: number; offset?: number; status?: string } = {}
): Promise<ListResponse<PaymentIntent>> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', params.limit.toString());
  if (params.offset) query.set('offset', params.offset.toString());
  if (params.status) query.set('status', params.status);

  return fetchApi<ListResponse<PaymentIntent>>(
    `/payment_intents?${query.toString()}`
  );
}

/**
 * Retrieves a single payment intent by its ID.
 * Use this to get detailed information about a specific payment.
 *
 * @param id - The payment intent ID (prefixed with 'pi_')
 * @returns The payment intent object with full details
 */
export async function getPaymentIntent(id: string): Promise<PaymentIntent> {
  return fetchApi<PaymentIntent>(`/payment_intents/${id}`);
}

/**
 * Creates a new payment intent to initiate a payment flow.
 * This is the first step in collecting a payment - the intent must then
 * be confirmed with a payment method to complete the transaction.
 *
 * @param data - Payment intent creation parameters
 * @param data.amount - Amount in smallest currency unit (e.g., cents for USD)
 * @param data.currency - Three-letter ISO currency code (defaults to 'usd')
 * @param data.customer - Optional customer ID to associate with this payment
 * @param data.payment_method - Optional payment method ID for immediate use
 * @param data.capture_method - 'automatic' to charge immediately, 'manual' for auth-only
 * @param data.description - Optional description for the payment
 * @param data.metadata - Optional key-value pairs for storing additional data
 * @returns The newly created payment intent
 */
export async function createPaymentIntent(data: {
  amount: number;
  currency?: string;
  customer?: string;
  payment_method?: string;
  capture_method?: 'automatic' | 'manual';
  description?: string;
  metadata?: Record<string, string>;
}): Promise<PaymentIntent> {
  return fetchApi<PaymentIntent>('/payment_intents', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Confirms a payment intent with a payment method.
 * This triggers the actual payment processing and card network authorization.
 *
 * @param id - The payment intent ID to confirm
 * @param paymentMethodId - The payment method ID to charge
 * @returns The updated payment intent with new status
 */
export async function confirmPaymentIntent(
  id: string,
  paymentMethodId: string
): Promise<PaymentIntent> {
  return fetchApi<PaymentIntent>(`/payment_intents/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ payment_method: paymentMethodId }),
  });
}

/**
 * Captures funds from an authorized payment intent.
 * Only applicable when capture_method was set to 'manual' during creation.
 *
 * @param id - The payment intent ID with status 'requires_capture'
 * @param amountToCapture - Optional partial amount to capture (must be <= authorized amount)
 * @returns The updated payment intent with 'succeeded' status
 */
export async function capturePaymentIntent(
  id: string,
  amountToCapture?: number
): Promise<PaymentIntent> {
  return fetchApi<PaymentIntent>(`/payment_intents/${id}/capture`, {
    method: 'POST',
    body: JSON.stringify({ amount_to_capture: amountToCapture }),
  });
}

/**
 * Cancels a payment intent that has not yet been captured.
 * Releases any authorized funds back to the customer.
 *
 * @param id - The payment intent ID to cancel
 * @param reason - Optional cancellation reason for tracking purposes
 * @returns The updated payment intent with 'canceled' status
 */
export async function cancelPaymentIntent(
  id: string,
  reason?: string
): Promise<PaymentIntent> {
  return fetchApi<PaymentIntent>(`/payment_intents/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ cancellation_reason: reason }),
  });
}

// ============================================================================
// Customers API
// ============================================================================

/**
 * Retrieves a paginated list of customers for the authenticated merchant.
 * Customers store payment methods and can be associated with multiple payments.
 *
 * @param params - Query parameters for filtering and pagination
 * @param params.limit - Maximum number of results to return
 * @param params.offset - Number of results to skip for pagination
 * @param params.email - Filter customers by email address
 * @returns Paginated list of customer objects
 */
export async function listCustomers(
  params: { limit?: number; offset?: number; email?: string } = {}
): Promise<ListResponse<Customer>> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', params.limit.toString());
  if (params.offset) query.set('offset', params.offset.toString());
  if (params.email) query.set('email', params.email);

  return fetchApi<ListResponse<Customer>>(`/customers?${query.toString()}`);
}

/**
 * Retrieves a single customer by their ID.
 *
 * @param id - The customer ID (prefixed with 'cus_')
 * @returns The customer object with full details
 */
export async function getCustomer(id: string): Promise<Customer> {
  return fetchApi<Customer>(`/customers/${id}`);
}

/**
 * Creates a new customer record.
 * Customers are useful for storing payment methods for recurring payments
 * and tracking payment history.
 *
 * @param data - Customer creation parameters
 * @param data.email - Customer's email address
 * @param data.name - Customer's full name
 * @param data.phone - Customer's phone number
 * @param data.metadata - Optional key-value pairs for additional data
 * @returns The newly created customer object (includes generated ID)
 */
export async function createCustomer(data: {
  email?: string;
  name?: string;
  phone?: string;
  metadata?: Record<string, string>;
}): Promise<Customer> {
  return fetchApi<Customer>('/customers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Updates an existing customer's information.
 *
 * @param id - The customer ID to update
 * @param data - Fields to update (only provided fields are changed)
 * @param data.email - Updated email address
 * @param data.name - Updated name
 * @param data.phone - Updated phone number
 * @param data.metadata - Updated metadata (replaces existing metadata)
 * @returns The updated customer object
 */
export async function updateCustomer(
  id: string,
  data: {
    email?: string;
    name?: string;
    phone?: string;
    metadata?: Record<string, string>;
  }
): Promise<Customer> {
  return fetchApi<Customer>(`/customers/${id}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Permanently deletes a customer and all associated data.
 * This action cannot be undone.
 *
 * @param id - The customer ID to delete
 * @returns Confirmation object indicating deletion success
 */
export async function deleteCustomer(id: string): Promise<{ deleted: boolean }> {
  return fetchApi<{ deleted: boolean }>(`/customers/${id}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// Payment Methods API
// ============================================================================

/**
 * Retrieves a paginated list of payment methods.
 * Payment methods represent saved card details that can be reused for payments.
 *
 * @param params - Query parameters for filtering and pagination
 * @param params.limit - Maximum number of results to return
 * @param params.offset - Number of results to skip for pagination
 * @param params.customer - Filter by customer ID to get a customer's saved methods
 * @returns Paginated list of payment method objects
 */
export async function listPaymentMethods(
  params: { limit?: number; offset?: number; customer?: string } = {}
): Promise<ListResponse<PaymentMethod>> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', params.limit.toString());
  if (params.offset) query.set('offset', params.offset.toString());
  if (params.customer) query.set('customer', params.customer);

  return fetchApi<ListResponse<PaymentMethod>>(
    `/payment_methods?${query.toString()}`
  );
}

/**
 * Retrieves a single payment method by its ID.
 *
 * @param id - The payment method ID (prefixed with 'pm_')
 * @returns The payment method object with card details
 */
export async function getPaymentMethod(id: string): Promise<PaymentMethod> {
  return fetchApi<PaymentMethod>(`/payment_methods/${id}`);
}

/**
 * Creates a new payment method from card details.
 * In production, card details should be tokenized client-side to maintain PCI compliance.
 * This simulated implementation accepts raw card data for demonstration purposes.
 *
 * @param data - Payment method creation parameters
 * @param data.type - Payment method type (currently only 'card' is supported)
 * @param data.card - Card details including number, expiration, and CVC
 * @param data.card.number - Full card number (will be tokenized)
 * @param data.card.exp_month - Expiration month (1-12)
 * @param data.card.exp_year - Expiration year (4 digits)
 * @param data.card.cvc - Card verification code
 * @param data.customer - Optional customer ID to immediately attach the method to
 * @param data.billing_details - Optional billing information
 * @returns The created payment method with masked card details
 */
export async function createPaymentMethod(data: {
  type: 'card';
  card: {
    number: string;
    exp_month: number;
    exp_year: number;
    cvc: string;
  };
  customer?: string;
  billing_details?: Record<string, unknown>;
}): Promise<PaymentMethod> {
  return fetchApi<PaymentMethod>('/payment_methods', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Attaches a payment method to a customer for future use.
 * Once attached, the payment method can be reused for subsequent payments.
 *
 * @param id - The payment method ID to attach
 * @param customerId - The customer ID to attach the method to
 * @returns The updated payment method with customer reference
 */
export async function attachPaymentMethod(
  id: string,
  customerId: string
): Promise<PaymentMethod> {
  return fetchApi<PaymentMethod>(`/payment_methods/${id}/attach`, {
    method: 'POST',
    body: JSON.stringify({ customer: customerId }),
  });
}

/**
 * Detaches a payment method from its customer.
 * The payment method can no longer be used until reattached.
 *
 * @param id - The payment method ID to detach
 * @returns The updated payment method without customer reference
 */
export async function detachPaymentMethod(id: string): Promise<PaymentMethod> {
  return fetchApi<PaymentMethod>(`/payment_methods/${id}/detach`, {
    method: 'POST',
  });
}

// ============================================================================
// Charges API
// ============================================================================

/**
 * Retrieves a paginated list of charges.
 * Charges represent successful payment transactions that have been captured.
 *
 * @param params - Query parameters for filtering and pagination
 * @param params.limit - Maximum number of results to return
 * @param params.offset - Number of results to skip for pagination
 * @param params.customer - Filter charges by customer ID
 * @returns Paginated list of charge objects
 */
export async function listCharges(
  params: { limit?: number; offset?: number; customer?: string } = {}
): Promise<ListResponse<Charge>> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', params.limit.toString());
  if (params.offset) query.set('offset', params.offset.toString());
  if (params.customer) query.set('customer', params.customer);

  return fetchApi<ListResponse<Charge>>(`/charges?${query.toString()}`);
}

/**
 * Retrieves a single charge by its ID.
 * Includes details like amount, fees, payment method used, and refund status.
 *
 * @param id - The charge ID (prefixed with 'ch_')
 * @returns The charge object with full transaction details
 */
export async function getCharge(id: string): Promise<Charge> {
  return fetchApi<Charge>(`/charges/${id}`);
}

// ============================================================================
// Refunds API
// ============================================================================

/**
 * Retrieves a paginated list of refunds.
 * Refunds represent partial or full returns of captured payment amounts.
 *
 * @param params - Query parameters for filtering and pagination
 * @param params.limit - Maximum number of results to return
 * @param params.offset - Number of results to skip for pagination
 * @param params.payment_intent - Filter refunds by payment intent ID
 * @returns Paginated list of refund objects
 */
export async function listRefunds(
  params: { limit?: number; offset?: number; payment_intent?: string } = {}
): Promise<ListResponse<Refund>> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', params.limit.toString());
  if (params.offset) query.set('offset', params.offset.toString());
  if (params.payment_intent) query.set('payment_intent', params.payment_intent);

  return fetchApi<ListResponse<Refund>>(`/refunds?${query.toString()}`);
}

/**
 * Creates a refund for a payment.
 * Returns funds to the customer's payment method. Can be partial or full amount.
 *
 * @param data - Refund creation parameters
 * @param data.payment_intent - Payment intent ID to refund
 * @param data.charge - Alternatively, the charge ID to refund
 * @param data.amount - Amount to refund in cents (defaults to full amount)
 * @param data.reason - Optional reason for the refund
 * @param data.metadata - Optional key-value pairs for additional data
 * @returns The created refund object
 */
export async function createRefund(data: {
  payment_intent?: string;
  charge?: string;
  amount?: number;
  reason?: string;
  metadata?: Record<string, string>;
}): Promise<Refund> {
  return fetchApi<Refund>('/refunds', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ============================================================================
// Balance API
// ============================================================================

/**
 * Retrieves the current balance for the authenticated merchant.
 * Shows available and pending amounts broken down by currency.
 *
 * @returns Balance object with available and pending amounts
 */
export async function getBalance(): Promise<Balance> {
  return fetchApi<Balance>('/balance');
}

/**
 * Retrieves a summary of the merchant's financial activity.
 * Includes lifetime totals for charges, fees, refunds, and today's activity.
 *
 * @returns Balance summary with aggregated statistics
 */
export async function getBalanceSummary(): Promise<BalanceSummary> {
  return fetchApi<BalanceSummary>('/balance/summary');
}

/**
 * Retrieves a paginated list of balance transactions.
 * Each transaction represents a change to the merchant's balance (charge, refund, fee).
 *
 * @param params - Query parameters for pagination
 * @param params.limit - Maximum number of results to return
 * @param params.offset - Number of results to skip for pagination
 * @returns Paginated list of balance transactions
 */
export async function listBalanceTransactions(
  params: { limit?: number; offset?: number } = {}
): Promise<ListResponse<BalanceTransaction>> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', params.limit.toString());
  if (params.offset) query.set('offset', params.offset.toString());

  return fetchApi<ListResponse<BalanceTransaction>>(
    `/balance/transactions?${query.toString()}`
  );
}

// ============================================================================
// Webhooks API
// ============================================================================

/**
 * Retrieves a paginated list of webhook events for the authenticated merchant.
 * Events are created when significant payment lifecycle changes occur.
 *
 * @param params - Query parameters for pagination
 * @param params.limit - Maximum number of results to return
 * @param params.offset - Number of results to skip for pagination
 * @returns List of webhook events with delivery status
 */
export async function listWebhookEvents(
  params: { limit?: number; offset?: number } = {}
): Promise<{ data: WebhookEvent[] }> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', params.limit.toString());
  if (params.offset) query.set('offset', params.offset.toString());

  return fetchApi<{ data: WebhookEvent[] }>(
    `/webhooks/events?${query.toString()}`
  );
}

/**
 * Retrieves the merchant's configured webhook endpoint.
 * Returns the URL, signing secret, and enabled status.
 *
 * @returns Webhook endpoint configuration
 */
export async function getWebhookEndpoint(): Promise<WebhookEndpoint> {
  return fetchApi<WebhookEndpoint>('/webhooks/endpoints');
}

/**
 * Creates or updates the merchant's webhook endpoint URL.
 * A signing secret is automatically generated for HMAC verification.
 *
 * @param url - The HTTPS URL to receive webhook events
 * @returns Updated webhook endpoint with signing secret
 */
export async function updateWebhookEndpoint(
  url: string
): Promise<WebhookEndpoint> {
  return fetchApi<WebhookEndpoint>('/webhooks/endpoints', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

/**
 * Deletes the merchant's webhook endpoint configuration.
 * No further webhook events will be delivered until a new endpoint is configured.
 *
 * @returns Confirmation of deletion
 */
export async function deleteWebhookEndpoint(): Promise<{ deleted: boolean }> {
  return fetchApi<{ deleted: boolean }>('/webhooks/endpoints', {
    method: 'DELETE',
  });
}

/**
 * Queues a webhook event for redelivery.
 * Use this when the initial delivery failed and you've fixed the endpoint.
 *
 * @param eventId - The webhook event ID to retry
 * @returns Confirmation that the retry has been queued
 */
export async function retryWebhook(eventId: string): Promise<{ queued: boolean }> {
  return fetchApi<{ queued: boolean }>(`/webhooks/events/${eventId}/retry`, {
    method: 'POST',
  });
}

// ============================================================================
// Merchants API
// ============================================================================

/**
 * Creates a new merchant account.
 * Returns the merchant object with a generated API key for authentication.
 *
 * @param data - Merchant registration data
 * @param data.name - Business name for the merchant
 * @param data.email - Contact email for the merchant account
 * @returns Created merchant object including the API key (only shown once)
 */
export async function createMerchant(data: {
  name: string;
  email: string;
}): Promise<Merchant> {
  return fetchApi<Merchant>('/merchants', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Retrieves the currently authenticated merchant's profile.
 * Uses the API key from the store to identify the merchant.
 *
 * @returns The authenticated merchant's profile
 */
export async function getMerchant(): Promise<Merchant> {
  return fetchApi<Merchant>('/merchants/me');
}

/**
 * Retrieves a paginated list of all merchants.
 * Typically used for admin purposes.
 *
 * @param params - Query parameters for pagination
 * @param params.limit - Maximum number of results to return
 * @param params.offset - Number of results to skip for pagination
 * @returns Paginated list of merchant objects
 */
export async function listMerchants(
  params: { limit?: number; offset?: number } = {}
): Promise<ListResponse<Merchant>> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', params.limit.toString());
  if (params.offset) query.set('offset', params.offset.toString());

  return fetchApi<ListResponse<Merchant>>(`/merchants?${query.toString()}`);
}
