import type { Order, Execution } from '../../types/index.js';

/**
 * Request payload for placing a new order.
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
 */
export type { Order, Execution, Position } from '../../types/index.js';
