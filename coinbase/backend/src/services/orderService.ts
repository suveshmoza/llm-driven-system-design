import { pool } from './db.js';
import { orderBookManager, OrderBookEntry, MatchResult } from './orderBook.js';
import { marketService } from './marketService.js';
import * as walletService from './walletService.js';
import { checkIdempotencyKey, setIdempotencyKey } from './idempotency.js';
import { publishMessage } from './kafka.js';
import { config } from '../config/index.js';
import { orderCounter, tradeCounter } from './metrics.js';

interface PlaceOrderParams {
  tradingPairId: string;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit' | 'stop';
  quantity: string;
  price?: string;
  stopPrice?: string;
  idempotencyKey?: string;
}

interface OrderResult {
  id: string;
  status: string;
  filledQuantity: string;
  avgFillPrice: string | null;
}

export async function placeOrder(
  userId: string,
  params: PlaceOrderParams
): Promise<OrderResult> {
  const { tradingPairId, side, orderType, quantity, price, stopPrice, idempotencyKey } =
    params;

  // Check idempotency
  if (idempotencyKey) {
    const existing = await checkIdempotencyKey(idempotencyKey);
    if (existing.exists && existing.response) {
      return JSON.parse(existing.response);
    }
  }

  // Get trading pair info
  const pairResult = await pool.query(
    `SELECT id, symbol, base_currency_id, quote_currency_id, min_order_size, max_order_size,
            price_precision, quantity_precision, is_active
     FROM trading_pairs WHERE id = $1`,
    [tradingPairId]
  );

  if (pairResult.rows.length === 0) {
    throw new Error('Trading pair not found');
  }

  const pair = pairResult.rows[0];
  if (!pair.is_active) {
    throw new Error('Trading pair is not active');
  }

  const qty = parseFloat(quantity);
  if (qty < parseFloat(pair.min_order_size) || qty > parseFloat(pair.max_order_size)) {
    throw new Error(
      `Order size must be between ${pair.min_order_size} and ${pair.max_order_size}`
    );
  }

  // Determine execution price
  let executionPrice: number;
  if (orderType === 'market') {
    const marketPrice = marketService.getCurrentPrice(pair.symbol);
    if (!marketPrice) throw new Error('Market price not available');
    executionPrice = marketPrice;
  } else if (orderType === 'limit' && price) {
    executionPrice = parseFloat(price);
  } else if (orderType === 'stop' && stopPrice) {
    executionPrice = parseFloat(stopPrice);
  } else {
    throw new Error('Price required for limit/stop orders');
  }

  // Reserve funds
  if (side === 'buy') {
    const quoteAmount = (qty * executionPrice).toString();
    const reserved = await walletService.reserveBalance(
      userId,
      pair.quote_currency_id,
      quoteAmount
    );
    if (!reserved) {
      throw new Error('Insufficient balance');
    }
  } else {
    const reserved = await walletService.reserveBalance(
      userId,
      pair.base_currency_id,
      quantity
    );
    if (!reserved) {
      throw new Error('Insufficient balance');
    }
  }

  // Insert order
  const orderResult = await pool.query(
    `INSERT INTO orders (user_id, trading_pair_id, side, order_type, quantity, price, stop_price, idempotency_key, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, status`,
    [
      userId,
      tradingPairId,
      side,
      orderType,
      quantity,
      orderType === 'limit' ? price : null,
      orderType === 'stop' ? stopPrice : null,
      idempotencyKey || null,
      orderType === 'market' ? 'open' : 'open',
    ]
  );

  const orderId = orderResult.rows[0].id;

  orderCounter.inc({ side, type: orderType, status: 'placed' });

  // Add to order book for limit orders
  if (orderType === 'limit' && price) {
    const entry: OrderBookEntry = {
      orderId,
      userId,
      price: parseFloat(price),
      quantity: qty,
      remainingQuantity: qty,
      side,
      timestamp: Date.now(),
    };

    const book = orderBookManager.getBook(pair.symbol);
    book.addOrder(entry);

    // Try matching
    const matches = book.matchOrders();
    if (matches.length > 0) {
      await processMatches(matches, tradingPairId, pair.symbol, pair);
    }
  } else if (orderType === 'market') {
    // Market orders match against limit orders in the book
    const book = orderBookManager.getBook(pair.symbol);

    // Add as aggressive order and match
    const entry: OrderBookEntry = {
      orderId,
      userId,
      price: side === 'buy' ? executionPrice * 1.1 : executionPrice * 0.9, // aggressive price
      quantity: qty,
      remainingQuantity: qty,
      side,
      timestamp: Date.now(),
    };
    book.addOrder(entry);

    const matches = book.matchOrders();
    if (matches.length > 0) {
      await processMatches(matches, tradingPairId, pair.symbol, pair);
    } else {
      // No matches in book, simulate fill at market price for market orders
      await simulateMarketFill(orderId, userId, side, qty, executionPrice, pair);
    }
  }

  // Get final order state
  const finalOrder = await pool.query(
    `SELECT id, status, filled_quantity::text AS "filledQuantity",
            avg_fill_price::text AS "avgFillPrice"
     FROM orders WHERE id = $1`,
    [orderId]
  );

  const result: OrderResult = {
    id: finalOrder.rows[0].id,
    status: finalOrder.rows[0].status,
    filledQuantity: finalOrder.rows[0].filledQuantity,
    avgFillPrice: finalOrder.rows[0].avgFillPrice,
  };

  // Store idempotency result
  if (idempotencyKey) {
    await setIdempotencyKey(idempotencyKey, result as unknown as Record<string, unknown>);
  }

  return result;
}

async function simulateMarketFill(
  orderId: string,
  userId: string,
  side: 'buy' | 'sell',
  quantity: number,
  price: number,
  pair: Record<string, string>
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update order as filled
    await client.query(
      `UPDATE orders SET status = 'filled', filled_quantity = $2, avg_fill_price = $3, updated_at = NOW()
       WHERE id = $1`,
      [orderId, quantity.toString(), price.toString()]
    );

    const fee = quantity * price * config.fees.takerFee;
    const quoteAmount = (quantity * price).toString();
    const baseCurrency = pair.base_currency_id;
    const quoteCurrency = pair.quote_currency_id;

    if (side === 'buy') {
      // Release reserved quote, deduct actual, add base
      await client.query(
        `UPDATE wallets SET balance = balance - $3, reserved_balance = reserved_balance - $3, updated_at = NOW()
         WHERE user_id = $1 AND currency_id = $2`,
        [userId, quoteCurrency, quoteAmount]
      );

      const received = (quantity - fee / price).toString();
      await client.query(
        `INSERT INTO wallets (user_id, currency_id, balance)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, currency_id)
         DO UPDATE SET balance = wallets.balance + $3, updated_at = NOW()`,
        [userId, baseCurrency, received]
      );
    } else {
      // Release reserved base, deduct actual, add quote
      await client.query(
        `UPDATE wallets SET balance = balance - $3, reserved_balance = reserved_balance - $3, updated_at = NOW()
         WHERE user_id = $1 AND currency_id = $2`,
        [userId, baseCurrency, quantity.toString()]
      );

      const received = (quantity * price - fee).toString();
      await client.query(
        `INSERT INTO wallets (user_id, currency_id, balance)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, currency_id)
         DO UPDATE SET balance = wallets.balance + $3, updated_at = NOW()`,
        [userId, quoteCurrency, received]
      );
    }

    // Record transaction
    await client.query(
      `INSERT INTO transactions (user_id, type, currency_id, amount, fee, reference_id, status)
       VALUES ($1, 'trade', $2, $3, $4, $5, 'completed')`,
      [
        userId,
        side === 'buy' ? baseCurrency : quoteCurrency,
        side === 'buy' ? quantity.toString() : quoteAmount,
        fee.toString(),
        orderId,
      ]
    );

    await client.query('COMMIT');

    tradeCounter.inc();

    // Publish trade event
    try {
      await publishMessage('trade-events', pair.symbol || 'unknown', {
        type: 'trade',
        orderId,
        userId,
        side,
        price,
        quantity,
        timestamp: Date.now(),
      });
    } catch (_err) {
      // Non-critical: Kafka may not be available
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function processMatches(
  matches: MatchResult[],
  tradingPairId: string,
  symbol: string,
  pair: Record<string, string>
): Promise<void> {
  for (const match of matches) {
    const buyerFee = match.quantity * match.price * config.fees.takerFee;
    const sellerFee = match.quantity * match.price * config.fees.makerFee;

    // Insert trade record
    const tradeResult = await pool.query(
      `INSERT INTO trades (trading_pair_id, buy_order_id, sell_order_id, price, quantity, buyer_fee, seller_fee)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        tradingPairId,
        match.buyOrderId,
        match.sellOrderId,
        match.price.toString(),
        match.quantity.toString(),
        buyerFee.toString(),
        sellerFee.toString(),
      ]
    );

    const tradeId = tradeResult.rows[0].id;

    // Update order fill status
    await updateOrderFill(match.buyOrderId, match.quantity, match.price);
    await updateOrderFill(match.sellOrderId, match.quantity, match.price);

    // Execute wallet transfers
    await walletService.executeTradeTransfer(
      match.buyUserId,
      match.sellUserId,
      pair.base_currency_id,
      pair.quote_currency_id,
      match.quantity.toString(),
      (match.quantity * match.price).toString(),
      buyerFee.toString(),
      sellerFee.toString(),
      tradeId
    );

    // Update market price
    marketService.updatePriceFromTrade(symbol, match.price, match.quantity * match.price);

    tradeCounter.inc();

    // Publish trade event
    try {
      await publishMessage('trade-events', symbol, {
        type: 'trade',
        tradeId,
        buyOrderId: match.buyOrderId,
        sellOrderId: match.sellOrderId,
        price: match.price,
        quantity: match.quantity,
        timestamp: Date.now(),
      });
    } catch (_err) {
      // Non-critical
    }
  }
}

async function updateOrderFill(
  orderId: string,
  fillQuantity: number,
  fillPrice: number
): Promise<void> {
  await pool.query(
    `UPDATE orders SET
       filled_quantity = filled_quantity + $2,
       avg_fill_price = CASE
         WHEN filled_quantity = 0 THEN $3
         ELSE (avg_fill_price * filled_quantity + $3 * $2) / (filled_quantity + $2)
       END,
       status = CASE
         WHEN filled_quantity + $2 >= quantity THEN 'filled'
         ELSE 'partially_filled'
       END,
       updated_at = NOW()
     WHERE id = $1`,
    [orderId, fillQuantity.toString(), fillPrice.toString()]
  );
}

export async function cancelOrder(userId: string, orderId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get order details
    const orderResult = await client.query(
      `SELECT o.id, o.user_id, o.trading_pair_id, o.side, o.quantity, o.price,
              o.filled_quantity, o.status, tp.symbol, tp.base_currency_id, tp.quote_currency_id
       FROM orders o
       JOIN trading_pairs tp ON tp.id = o.trading_pair_id
       WHERE o.id = $1 AND o.user_id = $2 AND o.status IN ('open', 'partially_filled')`,
      [orderId, userId]
    );

    if (orderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    const order = orderResult.rows[0];

    // Update order status
    await client.query(
      `UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [orderId]
    );

    // Remove from order book
    const book = orderBookManager.getBook(order.symbol);
    book.removeOrder(orderId);

    // Release reserved funds
    const remainingQty = parseFloat(order.quantity) - parseFloat(order.filled_quantity);
    if (order.side === 'buy' && order.price) {
      const releaseAmount = (remainingQty * parseFloat(order.price)).toString();
      await walletService.releaseReserve(userId, order.quote_currency_id, releaseAmount);
    } else if (order.side === 'sell') {
      await walletService.releaseReserve(
        userId,
        order.base_currency_id,
        remainingQty.toString()
      );
    }

    await client.query('COMMIT');

    orderCounter.inc({ side: order.side, type: 'cancel', status: 'cancelled' });

    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getUserOrders(
  userId: string,
  status?: string,
  limit: number = 50
): Promise<Record<string, unknown>[]> {
  let query = `
    SELECT o.id, o.trading_pair_id AS "tradingPairId", tp.symbol,
           o.side, o.order_type AS "orderType",
           o.quantity::text, o.price::text,
           o.filled_quantity::text AS "filledQuantity",
           o.avg_fill_price::text AS "avgFillPrice",
           o.status, o.created_at AS "createdAt"
    FROM orders o
    JOIN trading_pairs tp ON tp.id = o.trading_pair_id
    WHERE o.user_id = $1
  `;

  const queryParams: (string | number)[] = [userId];

  if (status) {
    queryParams.push(status);
    query += ` AND o.status = $${queryParams.length}`;
  }

  queryParams.push(limit);
  query += ` ORDER BY o.created_at DESC LIMIT $${queryParams.length}`;

  const result = await pool.query(query, queryParams);
  return result.rows;
}
