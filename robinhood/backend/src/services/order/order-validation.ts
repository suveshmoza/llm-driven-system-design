import { PoolClient } from 'pg';
import { quoteService } from '../quoteService.js';
import type { PlaceOrderRequest } from './types.js';

/**
 * Validates an order before placement.
 * Checks symbol validity, quantity, required prices for order type,
 * and sufficient funds (buy) or shares (sell).
 * Uses FOR UPDATE locks to prevent race conditions.
 * @param client - Database client within transaction
 * @param userId - ID of the user placing the order
 * @param request - Order details to validate
 * @throws Error with descriptive message if validation fails
 */
export async function validateOrder(
  client: PoolClient,
  userId: string,
  request: PlaceOrderRequest
): Promise<void> {
  // Check if symbol exists
  const quote = quoteService.getQuote(request.symbol);
  if (!quote) {
    throw new Error(`Invalid symbol: ${request.symbol}`);
  }

  // Validate quantity
  if (request.quantity <= 0) {
    throw new Error('Quantity must be positive');
  }

  // For limit orders, validate limit price
  if ((request.order_type === 'limit' || request.order_type === 'stop_limit') && !request.limit_price) {
    throw new Error('Limit price required for limit orders');
  }

  // For stop orders, validate stop price
  if ((request.order_type === 'stop' || request.order_type === 'stop_limit') && !request.stop_price) {
    throw new Error('Stop price required for stop orders');
  }

  if (request.side === 'buy') {
    await validateBuyOrder(client, userId, request, quote.ask);
  } else {
    await validateSellOrder(client, userId, request);
  }
}

/**
 * Validates a buy order by checking sufficient buying power.
 * @param client - Database client within transaction
 * @param userId - ID of the user placing the order
 * @param request - Order details to validate
 * @param askPrice - Current ask price for the symbol
 * @throws Error if user not found or insufficient buying power
 */
async function validateBuyOrder(
  client: PoolClient,
  userId: string,
  request: PlaceOrderRequest,
  askPrice: number
): Promise<void> {
  const userResult = await client.query(
    'SELECT buying_power FROM users WHERE id = $1 FOR UPDATE',
    [userId]
  );

  if (userResult.rows.length === 0) {
    throw new Error('User not found');
  }

  const buyingPower = parseFloat(userResult.rows[0].buying_power);
  const estimatedCost = request.quantity * (request.limit_price || askPrice);

  if (buyingPower < estimatedCost) {
    throw new Error(
      `Insufficient buying power. Required: $${estimatedCost.toFixed(2)}, Available: $${buyingPower.toFixed(2)}`
    );
  }
}

/**
 * Validates a sell order by checking available shares.
 * @param client - Database client within transaction
 * @param userId - ID of the user placing the order
 * @param request - Order details to validate
 * @throws Error if no position or insufficient shares
 */
async function validateSellOrder(
  client: PoolClient,
  userId: string,
  request: PlaceOrderRequest
): Promise<void> {
  const positionResult = await client.query(
    'SELECT quantity, reserved_quantity FROM positions WHERE user_id = $1 AND symbol = $2 FOR UPDATE',
    [userId, request.symbol.toUpperCase()]
  );

  if (positionResult.rows.length === 0) {
    throw new Error(`No position in ${request.symbol}`);
  }

  const position = positionResult.rows[0];
  const availableShares = parseFloat(position.quantity) - parseFloat(position.reserved_quantity);

  if (availableShares < request.quantity) {
    throw new Error(`Insufficient shares. Required: ${request.quantity}, Available: ${availableShares}`);
  }
}
