import { PoolClient } from 'pg';
import { quoteService } from '../quoteService.js';
import type { PlaceOrderRequest } from './types.js';

/**
 * Validates an order before placement.
 *
 * @description Performs comprehensive validation of an order request including:
 * - Symbol validity (must exist in the quote service)
 * - Quantity validation (must be positive)
 * - Required prices for order type (limit/stop prices as needed)
 * - Sufficient funds for buy orders
 * - Sufficient shares for sell orders
 *
 * Uses FOR UPDATE locks to prevent race conditions during concurrent order placement.
 *
 * @param client - PostgreSQL database client within an active transaction
 * @param userId - Unique identifier of the user placing the order
 * @param request - Order details to validate including symbol, side, type, and quantity
 * @returns Promise that resolves if validation passes
 * @throws {Error} 'Invalid symbol: {symbol}' - If the symbol is not found in the quote service
 * @throws {Error} 'Quantity must be positive' - If quantity is zero or negative
 * @throws {Error} 'Limit price required for limit orders' - If limit/stop_limit order lacks limit_price
 * @throws {Error} 'Stop price required for stop orders' - If stop/stop_limit order lacks stop_price
 * @throws {Error} 'User not found' - If the user ID does not exist in the database
 * @throws {Error} 'Insufficient buying power' - If user lacks funds for a buy order
 * @throws {Error} 'No position in {symbol}' - If user has no shares to sell
 * @throws {Error} 'Insufficient shares' - If user lacks enough shares for the sell quantity
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
 * Validates a buy order by checking the user has sufficient buying power.
 *
 * @description Retrieves the user's current buying power from the database
 * (with a FOR UPDATE lock to prevent race conditions) and verifies they have
 * enough funds to cover the estimated cost of the order. The estimated cost
 * is calculated as quantity multiplied by either the limit price (if specified)
 * or the current ask price.
 *
 * @param client - PostgreSQL database client within an active transaction
 * @param userId - Unique identifier of the user placing the order
 * @param request - Order details including quantity and optional limit price
 * @param askPrice - Current ask price for the symbol from the quote service
 * @returns Promise that resolves if user has sufficient buying power
 * @throws {Error} 'User not found' - If the user ID does not exist in the database
 * @throws {Error} 'Insufficient buying power. Required: ${X}, Available: ${Y}' -
 *   If user's buying power is less than the estimated order cost
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
 * Validates a sell order by checking the user has sufficient available shares.
 *
 * @description Retrieves the user's position in the specified symbol from the database
 * (with a FOR UPDATE lock to prevent race conditions) and verifies they have enough
 * available shares to cover the sell quantity. Available shares are calculated as
 * total quantity minus reserved quantity (shares already committed to pending sell orders).
 *
 * @param client - PostgreSQL database client within an active transaction
 * @param userId - Unique identifier of the user placing the order
 * @param request - Order details including symbol and quantity to sell
 * @returns Promise that resolves if user has sufficient available shares
 * @throws {Error} 'No position in {symbol}' - If user has no position in the specified symbol
 * @throws {Error} 'Insufficient shares. Required: {X}, Available: {Y}' -
 *   If user's available shares are less than the requested sell quantity
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
