import { pool } from '../database.js';
import { quoteService } from './quoteService.js';
import type { Position, User } from '../types/index.js';

/**
 * Represents a single stock holding with calculated metrics.
 * Enriches raw position data with current prices and P&L calculations.
 */
export interface PortfolioHolding {
  symbol: string;
  name: string;
  quantity: number;
  avgCostBasis: number;
  currentPrice: number;
  marketValue: number;
  gainLoss: number;
  gainLossPercent: number;
  dayChange: number;
  dayChangePercent: number;
}

/**
 * Aggregated portfolio view with all holdings and summary metrics.
 * Provides a complete snapshot of a user's investment position.
 */
export interface PortfolioSummary {
  totalValue: number;
  totalCost: number;
  totalGainLoss: number;
  totalGainLossPercent: number;
  dayChange: number;
  dayChangePercent: number;
  buyingPower: number;
  holdings: PortfolioHolding[];
}

/**
 * Service for portfolio management and calculations.
 * Combines position data with real-time quotes to provide
 * comprehensive portfolio views with P&L metrics.
 */
export class PortfolioService {
  /**
   * Gets a complete portfolio summary for a user.
   * Calculates total value, gains/losses, and day changes
   * by combining positions with current market prices.
   * @param userId - ID of the portfolio owner
   * @returns Promise resolving to portfolio summary with holdings
   * @throws Error if user is not found
   */
  async getPortfolio(userId: string): Promise<PortfolioSummary> {
    // Get user buying power
    const userResult = await pool.query<User>(
      'SELECT buying_power FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const buyingPower = parseFloat(userResult.rows[0].buying_power.toString());

    // Get positions
    const positionsResult = await pool.query<Position>(
      'SELECT * FROM positions WHERE user_id = $1 ORDER BY symbol',
      [userId]
    );

    const holdings: PortfolioHolding[] = [];
    let totalValue = 0;
    let totalCost = 0;
    let dayChange = 0;

    for (const position of positionsResult.rows) {
      const quote = quoteService.getQuote(position.symbol);
      const stockInfo = quoteService.getStockInfo(position.symbol);

      if (!quote) continue;

      const quantity = parseFloat(position.quantity.toString());
      const avgCostBasis = parseFloat(position.avg_cost_basis.toString());
      const currentPrice = quote.last;
      const marketValue = quantity * currentPrice;
      const costBasis = quantity * avgCostBasis;
      const gainLoss = marketValue - costBasis;
      const gainLossPercent = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0;
      const positionDayChange = quantity * quote.change;

      holdings.push({
        symbol: position.symbol,
        name: stockInfo?.name || position.symbol,
        quantity,
        avgCostBasis,
        currentPrice,
        marketValue,
        gainLoss,
        gainLossPercent,
        dayChange: positionDayChange,
        dayChangePercent: quote.changePercent,
      });

      totalValue += marketValue;
      totalCost += costBasis;
      dayChange += positionDayChange;
    }

    const totalGainLoss = totalValue - totalCost;
    const totalGainLossPercent = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;
    const dayChangePercent = (totalValue - dayChange) > 0
      ? (dayChange / (totalValue - dayChange)) * 100
      : 0;

    return {
      totalValue,
      totalCost,
      totalGainLoss,
      totalGainLossPercent,
      dayChange,
      dayChangePercent,
      buyingPower,
      holdings,
    };
  }

  /**
   * Gets a specific position for a user and symbol.
   * @param userId - ID of the position owner
   * @param symbol - Stock ticker symbol (case-insensitive)
   * @returns Promise resolving to position or null if not found
   */
  async getPosition(userId: string, symbol: string): Promise<Position | null> {
    const result = await pool.query<Position>(
      'SELECT * FROM positions WHERE user_id = $1 AND symbol = $2',
      [userId, symbol.toUpperCase()]
    );
    return result.rows[0] || null;
  }

  /**
   * Gets all positions for a user.
   * @param userId - ID of the position owner
   * @returns Promise resolving to array of positions sorted by symbol
   */
  async getPositions(userId: string): Promise<Position[]> {
    const result = await pool.query<Position>(
      'SELECT * FROM positions WHERE user_id = $1 ORDER BY symbol',
      [userId]
    );
    return result.rows;
  }
}

/**
 * Singleton instance of the PortfolioService.
 * Handles portfolio calculations and position queries.
 */
export const portfolioService = new PortfolioService();
