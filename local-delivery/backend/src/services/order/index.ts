/**
 * Order service module.
 * Re-exports all order-related functionality from submodules.
 *
 * @module services/order
 */

// Types and constants
export type {
  Order,
  OrderWithDetails,
  OrderItem,
  CreateOrderInput,
  OrderStatus,
  DriverOffer,
  Location,
  Merchant,
} from './types.js';

export {
  OFFER_EXPIRY_SECONDS,
  MAX_OFFER_ATTEMPTS,
  DRIVER_MATCHING_TIMEOUT_MS,
  CIRCUIT_BREAKER_ERROR_THRESHOLD,
  CIRCUIT_BREAKER_VOLUME_THRESHOLD,
  CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
} from './types.js';

// Order creation
export { createOrder } from './create.js';

// Order tracking and queries
export {
  getOrderById,
  getOrderWithDetails,
  getCustomerOrders,
  getDriverOrders,
  getOrderStats,
  getRecentOrders,
} from './tracking.js';

// Status updates
export { updateOrderStatus } from './status.js';

// Delivery completion
export { completeDelivery } from './delivery.js';

// Driver assignment and offers
export {
  assignDriverToOrder,
  createDriverOffer,
  acceptDriverOffer,
  rejectDriverOffer,
  getPendingOfferForDriver,
  expireOldOffers,
} from './assignment.js';

// Driver matching with circuit breaker
export {
  startDriverMatching,
  startDriverMatchingWithCircuitBreaker,
  getDriverMatchingCircuitBreakerStatus,
} from './matching.js';
