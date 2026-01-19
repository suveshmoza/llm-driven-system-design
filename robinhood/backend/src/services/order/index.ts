import { pool } from '../../database.js';
import { quoteService } from '../quoteService.js';
import { logger } from '../../shared/logger.js';
import { auditLogger } from '../../shared/audit.js';
import { idempotencyService } from '../../shared/idempotency.js';
import { publishOrder, isProducerConnected } from '../../shared/kafka.js';
import {
  ordersPlacedTotal,
  ordersRejectedTotal,
  orderExecutionDurationMs,
} from '../../shared/metrics.js';

import { validateOrder } from './order-validation.js';
import { executeOrderImmediately, fillOrder } from './execution.js';
import { cancelOrder } from './order-cancellation.js';
import { getOrders, getOrder, getExecutions } from './order-queries.js';
import { LimitOrderMatcher } from './limit-orders.js';

import type {
  PlaceOrderRequest,
  OrderResult,
  OrderContext,
  Order,
  Execution,
} from './types.js';

// Re-export types for consumers
export type { PlaceOrderRequest, OrderResult, OrderContext } from './types.js';

/**
 * Service for managing stock orders.
 * Handles order placement, validation, execution, and cancellation.
 * Implements fund/share reservation to ensure transaction integrity.
 * Includes a background limit order matcher for non-market orders.
 *
 * Enhanced with:
 * - Idempotency to prevent duplicate trades
 * - Audit logging for SEC compliance
 * - Prometheus metrics for monitoring
 * - Kafka event publishing for distributed processing
 */
export class OrderService {
  private limitOrderMatcher = new LimitOrderMatcher();

  /**
   * Places a new order for a user with idempotency support.
   * If an idempotency key is provided and a matching order exists,
   * returns the cached result instead of placing a duplicate order.
   *
   * @param userId - ID of the user placing the order
   * @param request - Order details including symbol, side, type, and quantity
   * @param context - Optional context including idempotency key and request tracing
   * @returns Promise resolving to order result with execution details
   * @throws Error if validation fails (insufficient funds, invalid symbol, etc.)
   */
  async placeOrder(
    userId: string,
    request: PlaceOrderRequest,
    context: OrderContext = {}
  ): Promise<OrderResult> {
    const orderLogger = logger.child({
      userId,
      symbol: request.symbol,
      side: request.side,
      orderType: request.order_type,
      quantity: request.quantity,
      requestId: context.requestId,
    });

    const startTime = Date.now();

    // Check idempotency if key provided
    if (context.idempotencyKey) {
      const existing = await idempotencyService.check<OrderResult>(context.idempotencyKey, userId);

      if (existing) {
        if (existing.status === 'completed' && existing.result) {
          orderLogger.info({ idempotencyKey: context.idempotencyKey }, 'Returning cached order result (idempotent)');
          return { ...existing.result, idempotent: true };
        }

        if (existing.status === 'pending') {
          // Another request is in progress - wait or return error
          orderLogger.warn({ idempotencyKey: context.idempotencyKey }, 'Order placement already in progress');
          throw new Error('Order placement already in progress. Please wait and retry.');
        }

        // If failed, allow retry
      }

      // Acquire idempotency lock
      const locked = await idempotencyService.start(context.idempotencyKey, userId);
      if (!locked) {
        throw new Error('Order placement already in progress. Please wait and retry.');
      }
    }

    const client = await pool.connect();
    let orderId: string | undefined;

    try {
      await client.query('BEGIN');

      // Validate the order
      await validateOrder(client, userId, request);

      // Create the order
      const orderResult = await client.query<Order>(
        `INSERT INTO orders (user_id, symbol, side, order_type, quantity, limit_price, stop_price, time_in_force, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
         RETURNING *`,
        [
          userId,
          request.symbol.toUpperCase(),
          request.side,
          request.order_type,
          request.quantity,
          request.limit_price || null,
          request.stop_price || null,
          request.time_in_force || 'day',
        ]
      );

      const order = orderResult.rows[0];
      orderId = order.id;

      // Reserve funds or shares
      if (request.side === 'buy') {
        const quote = quoteService.getQuote(request.symbol);
        const estimatedCost = request.quantity * (request.limit_price || quote?.ask || 0);

        await client.query(
          `UPDATE users SET buying_power = buying_power - $1, updated_at = NOW()
           WHERE id = $2`,
          [estimatedCost, userId]
        );
      } else {
        // Reserve shares for sell
        await client.query(
          `UPDATE positions SET reserved_quantity = reserved_quantity + $1, updated_at = NOW()
           WHERE user_id = $2 AND symbol = $3`,
          [request.quantity, userId, request.symbol.toUpperCase()]
        );
      }

      await client.query('COMMIT');

      // Track metrics
      ordersPlacedTotal.inc({ side: request.side, order_type: request.order_type });

      // Audit log the order placement
      await auditLogger.logOrderPlaced(userId, order.id, {
        symbol: request.symbol.toUpperCase(),
        side: request.side,
        orderType: request.order_type,
        quantity: request.quantity,
        limitPrice: request.limit_price,
        stopPrice: request.stop_price,
        timeInForce: request.time_in_force || 'day',
      }, {
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        idempotencyKey: context.idempotencyKey,
      });

      // Publish order event to Kafka
      if (isProducerConnected()) {
        await publishOrder(order, 'placed', {
          requestId: context.requestId,
          idempotencyKey: context.idempotencyKey,
        });
      }

      orderLogger.info({ orderId: order.id }, 'Order placed successfully');

      let result: OrderResult;

      // For market orders, execute immediately (simulation)
      if (request.order_type === 'market') {
        result = await executeOrderImmediately(order, context);
      } else {
        result = { order, message: 'Order placed successfully' };
      }

      // Track execution duration for market orders
      const duration = Date.now() - startTime;
      orderExecutionDurationMs.observe({ order_type: request.order_type }, duration);

      // Cache result for idempotency
      if (context.idempotencyKey) {
        await idempotencyService.complete(context.idempotencyKey, userId, result);
      }

      return result;
    } catch (error) {
      await client.query('ROLLBACK');

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      orderLogger.error({ error: errorMessage }, 'Order placement failed');

      // Track rejection metrics
      ordersRejectedTotal.inc({ reason: errorMessage.substring(0, 50) });

      // Audit log the rejection if we got far enough to have an order ID
      if (orderId) {
        await auditLogger.logOrderRejected(userId, orderId, errorMessage, {
          symbol: request.symbol.toUpperCase(),
          side: request.side,
          orderType: request.order_type,
          quantity: request.quantity,
        }, {
          requestId: context.requestId,
          idempotencyKey: context.idempotencyKey,
        });
      }

      // Mark idempotency as failed
      if (context.idempotencyKey) {
        await idempotencyService.fail(context.idempotencyKey, userId, errorMessage);
      }

      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Fills an order (or partial order) at the specified price.
   * Delegates to the execution module.
   */
  async fillOrder(
    order: Order,
    price: number,
    quantity: number,
    context: OrderContext = {}
  ): Promise<OrderResult> {
    return fillOrder(order, price, quantity, context);
  }

  /**
   * Cancels a pending, submitted, or partially filled order.
   * Delegates to the cancellation module.
   */
  async cancelOrder(
    userId: string,
    orderId: string,
    context: OrderContext = {}
  ): Promise<Order> {
    return cancelOrder(userId, orderId, context);
  }

  /**
   * Retrieves all orders for a user, optionally filtered by status.
   */
  async getOrders(userId: string, status?: string): Promise<Order[]> {
    return getOrders(userId, status);
  }

  /**
   * Retrieves a specific order for a user.
   */
  async getOrder(userId: string, orderId: string): Promise<Order | null> {
    return getOrder(userId, orderId);
  }

  /**
   * Retrieves all executions for an order.
   */
  async getExecutions(orderId: string): Promise<Execution[]> {
    return getExecutions(orderId);
  }

  /**
   * Starts the background limit order matcher.
   */
  startLimitOrderMatcher(): void {
    this.limitOrderMatcher.start();
  }

  /**
   * Stops the background limit order matcher.
   */
  stopLimitOrderMatcher(): void {
    this.limitOrderMatcher.stop();
  }
}

/**
 * Singleton instance of the OrderService.
 * Manages all order operations for the trading platform.
 */
export const orderService = new OrderService();
