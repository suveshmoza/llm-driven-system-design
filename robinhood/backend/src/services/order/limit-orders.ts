import { pool } from '../../database.js';
import { quoteService } from '../quoteService.js';
import { logger } from '../../shared/logger.js';
import { fillOrder } from './execution.js';
import type { Order } from './types.js';

/**
 * Manages the background limit order matching process.
 * Periodically checks pending limit/stop orders against current prices
 * and executes them when conditions are met.
 */
export class LimitOrderMatcher {
  private executionInterval: NodeJS.Timeout | null = null;

  /**
   * Starts the background limit order matcher.
   * Periodically checks pending limit/stop orders against current prices
   * and executes them when conditions are met.
   */
  start(): void {
    if (this.executionInterval) return;

    this.executionInterval = setInterval(async () => {
      await this.matchLimitOrders();
    }, 2000);

    logger.info('Limit order matcher started');
  }

  /**
   * Stops the background limit order matcher.
   */
  stop(): void {
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
      this.executionInterval = null;
      logger.info('Limit order matcher stopped');
    }
  }

  /**
   * Checks all pending limit/stop orders and executes matching ones.
   * For limit buys, executes when ask <= limit price.
   * For limit sells, executes when bid >= limit price.
   * For stop orders, triggers based on stop price thresholds.
   */
  private async matchLimitOrders(): Promise<void> {
    try {
      // Get all pending/submitted limit orders
      const ordersResult = await pool.query<Order>(
        `SELECT * FROM orders
         WHERE status IN ('pending', 'submitted', 'partial')
         AND order_type IN ('limit', 'stop', 'stop_limit')
         ORDER BY created_at ASC`
      );

      for (const order of ordersResult.rows) {
        const quote = quoteService.getQuote(order.symbol);
        if (!quote) continue;

        const fillInfo = this.checkFillConditions(order, quote.ask, quote.bid);

        if (fillInfo.shouldFill) {
          const remainingQty = order.quantity - parseFloat(String(order.filled_quantity));
          try {
            await fillOrder(order, fillInfo.fillPrice, remainingQty);
            logger.info({ orderId: order.id, fillPrice: fillInfo.fillPrice }, 'Limit order filled');
          } catch (error) {
            logger.error({ orderId: order.id, error }, 'Error filling limit order');
          }
        }
      }
    } catch (error) {
      logger.error({ error }, 'Error matching limit orders');
    }
  }

  /**
   * Determines if an order should be filled based on current prices.
   * @param order - The order to check
   * @param askPrice - Current ask price
   * @param bidPrice - Current bid price
   * @returns Object indicating whether to fill and at what price
   */
  private checkFillConditions(
    order: Order,
    askPrice: number,
    bidPrice: number
  ): { shouldFill: boolean; fillPrice: number } {
    let shouldFill = false;
    let fillPrice = 0;

    if (order.order_type === 'limit') {
      if (order.side === 'buy' && order.limit_price && askPrice <= order.limit_price) {
        shouldFill = true;
        fillPrice = askPrice;
      } else if (order.side === 'sell' && order.limit_price && bidPrice >= order.limit_price) {
        shouldFill = true;
        fillPrice = bidPrice;
      }
    } else if (order.order_type === 'stop') {
      if (order.side === 'buy' && order.stop_price && askPrice >= order.stop_price) {
        shouldFill = true;
        fillPrice = askPrice;
      } else if (order.side === 'sell' && order.stop_price && bidPrice <= order.stop_price) {
        shouldFill = true;
        fillPrice = bidPrice;
      }
    }

    return { shouldFill, fillPrice };
  }
}
