/**
 * Order module types and constants.
 * Re-exports relevant types from main types module and defines module-specific constants.
 *
 * @module services/order/types
 */

// Re-export types from main types module
export type {
  Order,
  OrderWithDetails,
  OrderItem,
  CreateOrderInput,
  OrderStatus,
  DriverOffer,
  Location,
  Merchant,
} from '../../types/index.js';

// Module constants

/** Time in seconds before a driver offer expires and is offered to the next driver. */
export const OFFER_EXPIRY_SECONDS = 30;

/** Maximum number of drivers to try before cancelling an order for lack of driver. */
export const MAX_OFFER_ATTEMPTS = 5;

/** Circuit breaker timeout for driver matching (3 minutes to allow multiple offers). */
export const DRIVER_MATCHING_TIMEOUT_MS = 180000;

/** Error threshold percentage for circuit breaker to open. */
export const CIRCUIT_BREAKER_ERROR_THRESHOLD = 50;

/** Minimum requests before circuit breaker evaluates error threshold. */
export const CIRCUIT_BREAKER_VOLUME_THRESHOLD = 3;

/** Time in milliseconds before circuit breaker transitions from open to half-open. */
export const CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 30000;
