import { PoolClient } from 'pg';
import type { Position } from './types.js';

/**
 * Updates or creates a position after a buy order fill.
 *
 * @description Handles position management for buy order executions. If the user
 * already has a position in the symbol, calculates and updates the new average
 * cost basis using the formula: (oldQty * oldCost + newQty * newPrice) / totalQty.
 * If no position exists, creates a new position record with the fill price as the
 * initial cost basis.
 *
 * Uses FOR UPDATE lock to prevent race conditions during concurrent fills.
 *
 * @param client - PostgreSQL database client within an active transaction
 * @param userId - Unique identifier of the position owner
 * @param symbol - Stock ticker symbol (e.g., 'AAPL', 'GOOGL')
 * @param quantity - Number of shares purchased in this fill
 * @param price - Purchase price per share for this fill
 * @returns Promise that resolves when position is updated or created
 */
export async function updatePositionForBuy(
  client: PoolClient,
  userId: string,
  symbol: string,
  quantity: number,
  price: number
): Promise<void> {
  // Check if position exists
  const posResult = await client.query<Position>(
    'SELECT * FROM positions WHERE user_id = $1 AND symbol = $2 FOR UPDATE',
    [userId, symbol]
  );

  if (posResult.rows.length === 0) {
    // Create new position
    await client.query(
      `INSERT INTO positions (user_id, symbol, quantity, avg_cost_basis)
       VALUES ($1, $2, $3, $4)`,
      [userId, symbol, quantity, price]
    );
  } else {
    // Update existing position
    const position = posResult.rows[0];
    const oldQty = parseFloat(String(position.quantity));
    const oldCost = parseFloat(String(position.avg_cost_basis));
    const newQty = oldQty + quantity;
    const newAvgCost = (oldQty * oldCost + quantity * price) / newQty;

    await client.query(
      `UPDATE positions SET quantity = $1, avg_cost_basis = $2, updated_at = NOW()
       WHERE id = $3`,
      [newQty, newAvgCost, position.id]
    );
  }
}

/**
 * Updates a position after a sell order fill.
 *
 * @description Handles position management for sell order executions. Decreases
 * the position quantity and reserved quantity by the sold amount. If the position
 * is fully sold (quantity reaches zero or below), removes the position record
 * entirely from the database.
 *
 * Uses FOR UPDATE lock to prevent race conditions during concurrent fills.
 *
 * @param client - PostgreSQL database client within an active transaction
 * @param userId - Unique identifier of the position owner
 * @param symbol - Stock ticker symbol (e.g., 'AAPL', 'GOOGL')
 * @param quantity - Number of shares sold in this fill
 * @param _price - Sale price per share (unused, included for signature consistency with buy)
 * @returns Promise that resolves when position is updated or removed
 * @throws {Error} 'Position not found' - If user has no position in the specified symbol
 */
export async function updatePositionForSell(
  client: PoolClient,
  userId: string,
  symbol: string,
  quantity: number,
  _price: number
): Promise<void> {
  const posResult = await client.query<Position>(
    'SELECT * FROM positions WHERE user_id = $1 AND symbol = $2 FOR UPDATE',
    [userId, symbol]
  );

  if (posResult.rows.length === 0) {
    throw new Error('Position not found');
  }

  const position = posResult.rows[0];
  const newQty = parseFloat(String(position.quantity)) - quantity;
  const newReserved = Math.max(0, parseFloat(String(position.reserved_quantity)) - quantity);

  if (newQty <= 0) {
    // Remove position entirely
    await client.query('DELETE FROM positions WHERE id = $1', [position.id]);
  } else {
    await client.query(
      `UPDATE positions SET quantity = $1, reserved_quantity = $2, updated_at = NOW()
       WHERE id = $3`,
      [newQty, newReserved, position.id]
    );
  }
}
