import type { Order, Execution } from '../../types/index.js';

/**
 * Request payload for placing a new order.
 *
 * @description Contains all the information needed to place a stock order,
 * including the symbol, direction (buy/sell), order type, quantity, and
 * optional price constraints for limit and stop orders.
 *
 * @property symbol - Stock ticker symbol (e.g., 'AAPL', 'GOOGL')
 * @property side - Order direction: 'buy' to purchase shares, 'sell' to sell shares
 * @property order_type - Type of order determining execution behavior:
 *   - 'market': Execute immediately at current market price
 *   - 'limit': Execute only at specified limit price or better
 *   - 'stop': Trigger market order when stop price is reached
 *   - 'stop_limit': Trigger limit order when stop price is reached
 * @property quantity - Number of shares to buy or sell (must be positive)
 * @property limit_price - Maximum price for buy or minimum price for sell (required for limit/stop_limit orders)
 * @property stop_price - Trigger price for stop orders (required for stop/stop_limit orders)
 * @property time_in_force - How long the order remains active:
 *   - 'day': Valid until end of trading day (default)
 *   - 'gtc': Good-til-cancelled, remains active until filled or cancelled
 *   - 'ioc': Immediate-or-cancel, fill immediately or cancel unfilled portion
 *   - 'fok': Fill-or-kill, fill entirely immediately or cancel completely
 */
export interface PlaceOrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  order_type: 'market' | 'limit' | 'stop' | 'stop_limit';
  quantity: number;
  limit_price?: number;
  stop_price?: number;
  time_in_force?: 'day' | 'gtc' | 'ioc' | 'fok';
}

/**
 * Result returned after placing or executing an order.
 *
 * @description Contains the order details, optional execution information,
 * a human-readable message, and an idempotency flag.
 *
 * @property order - The full order record including current status and fill information
 * @property execution - Execution details if the order was filled (partially or fully)
 * @property message - Human-readable status message (e.g., 'Order filled at $150.00')
 * @property idempotent - True if this result was returned from the idempotency cache
 *   rather than creating a new order (indicates duplicate request was detected)
 */
export interface OrderResult {
  order: Order;
  execution?: Execution;
  message: string;
  /** Indicates if this result was returned from idempotency cache */
  idempotent?: boolean;
}

/**
 * Context for order placement including idempotency and tracing.
 *
 * @description Provides additional metadata for order placement operations,
 * including support for idempotency to prevent duplicate orders and
 * request tracing for debugging and audit purposes.
 *
 * @property idempotencyKey - Unique key to prevent duplicate orders. If the same
 *   idempotency key is used for multiple requests, only the first order is placed
 *   and subsequent requests return the cached result. Use a UUID or similar.
 * @property requestId - Unique identifier for request tracing across services and logs
 * @property ipAddress - Client IP address for audit logging and fraud detection
 * @property userAgent - Client user agent string for audit logging
 */
export interface OrderContext {
  /** Idempotency key to prevent duplicate orders */
  idempotencyKey?: string;
  /** Request ID for tracing */
  requestId?: string;
  /** Client IP address */
  ipAddress?: string;
  /** Client user agent */
  userAgent?: string;
}

/**
 * Re-export types from the main types module for convenience.
 *
 * @description These types are re-exported to allow consumers of the order
 * service to import all order-related types from a single location.
 */
export type { Order, Execution, Position } from '../../types/index.js';
