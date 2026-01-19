import { pool } from '../../database.js';
import { quoteService } from '../quoteService.js';
import { logger } from '../../shared/logger.js';
import { auditLogger } from '../../shared/audit.js';
import { publishOrder, isProducerConnected } from '../../shared/kafka.js';
import { ordersCancelledTotal } from '../../shared/metrics.js';
import type { Order, OrderContext } from './types.js';

/**
 * Cancels a pending, submitted, or partially filled order.
 * Releases reserved funds (buy) or shares (sell) back to the user.
 * @param userId - ID of the order owner
 * @param orderId - ID of the order to cancel
 * @param context - Optional context for tracing
 * @returns Promise resolving to the cancelled order
 * @throws Error if order not found or cannot be cancelled
 */
export async function cancelOrder(
  userId: string,
  orderId: string,
  context: OrderContext = {}
): Promise<Order> {
  const client = await pool.connect();
  const cancelLogger = logger.child({
    userId,
    orderId,
    requestId: context.requestId,
  });

  try {
    await client.query('BEGIN');

    const orderResult = await client.query<Order>(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [orderId, userId]
    );

    if (orderResult.rows.length === 0) {
      throw new Error('Order not found');
    }

    const order = orderResult.rows[0];

    if (!['pending', 'submitted', 'partial'].includes(order.status)) {
      throw new Error(`Cannot cancel order with status: ${order.status}`);
    }

    // Release reserved funds/shares
    const remainingQty = order.quantity - parseFloat(String(order.filled_quantity));

    if (order.side === 'buy') {
      const quote = quoteService.getQuote(order.symbol);
      const reservedAmount = remainingQty * (order.limit_price || quote?.ask || 0);

      await client.query(
        `UPDATE users SET buying_power = buying_power + $1, updated_at = NOW()
         WHERE id = $2`,
        [reservedAmount, userId]
      );
    } else {
      await client.query(
        `UPDATE positions SET reserved_quantity = reserved_quantity - $1, updated_at = NOW()
         WHERE user_id = $2 AND symbol = $3`,
        [remainingQty, userId, order.symbol]
      );
    }

    // Update order status
    await client.query(
      `UPDATE orders SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [orderId]
    );

    await client.query('COMMIT');

    // Track metrics
    ordersCancelledTotal.inc();

    // Audit log the cancellation
    await auditLogger.logOrderCancelled(userId, orderId, {
      symbol: order.symbol,
      side: order.side,
      orderType: order.order_type,
      originalQuantity: order.quantity,
      filledQuantity: order.filled_quantity,
      remainingQuantity: remainingQty,
    }, { requestId: context.requestId });

    cancelLogger.info('Order cancelled successfully');

    const updatedResult = await pool.query<Order>(
      'SELECT * FROM orders WHERE id = $1',
      [orderId]
    );

    const cancelledOrder = updatedResult.rows[0];

    // Publish order cancelled event to Kafka
    if (isProducerConnected()) {
      await publishOrder(cancelledOrder, 'cancelled', {
        remainingQuantity: remainingQty,
        requestId: context.requestId,
      });
    }

    return cancelledOrder;
  } catch (error) {
    await client.query('ROLLBACK');
    cancelLogger.error({ error }, 'Order cancellation failed');
    throw error;
  } finally {
    client.release();
  }
}
