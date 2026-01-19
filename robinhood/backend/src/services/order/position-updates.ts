import { PoolClient } from 'pg';
import type { Position } from './types.js';

/**
 * Updates or creates a position after a buy order fill.
 * Calculates new average cost basis when adding to existing position.
 * @param client - Database client within transaction
 * @param userId - ID of the position owner
 * @param symbol - Stock ticker symbol
 * @param quantity - Number of shares purchased
 * @param price - Purchase price per share
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
 * Decreases quantity and reserved shares; removes position if fully sold.
 * @param client - Database client within transaction
 * @param userId - ID of the position owner
 * @param symbol - Stock ticker symbol
 * @param quantity - Number of shares sold
 * @param _price - Sale price per share (unused, for signature consistency)
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
