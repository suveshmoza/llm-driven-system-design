import { pool } from '../database.js';
import { redis } from '../redis.js';
import { quoteService } from './quoteService.js';
import type { Watchlist, WatchlistItem, PriceAlert, Quote } from '../types/index.js';

/**
 * Watchlist with items enriched with current quote data.
 */
export interface WatchlistWithItems extends Watchlist {
  items: Array<WatchlistItem & { quote?: Quote }>;
}

/**
 * Service for managing user watchlists.
 * Allows users to create lists of stocks to track,
 * with each item enriched with real-time quote data.
 */
export class WatchlistService {
  /**
   * Gets all watchlists for a user with enriched quote data.
   * @param userId - ID of the watchlist owner
   * @returns Promise resolving to array of watchlists with items and quotes
   */
  async getWatchlists(userId: string): Promise<WatchlistWithItems[]> {
    const watchlistsResult = await pool.query<Watchlist>(
      'SELECT * FROM watchlists WHERE user_id = $1 ORDER BY created_at',
      [userId]
    );

    const watchlists: WatchlistWithItems[] = [];

    for (const watchlist of watchlistsResult.rows) {
      const itemsResult = await pool.query<WatchlistItem>(
        'SELECT * FROM watchlist_items WHERE watchlist_id = $1 ORDER BY created_at',
        [watchlist.id]
      );

      const items = itemsResult.rows.map((item) => ({
        ...item,
        quote: quoteService.getQuote(item.symbol) || undefined,
      }));

      watchlists.push({ ...watchlist, items });
    }

    return watchlists;
  }

  /**
   * Creates a new watchlist for a user.
   * @param userId - ID of the watchlist owner
   * @param name - Display name for the watchlist
   * @returns Promise resolving to the created watchlist
   */
  async createWatchlist(userId: string, name: string): Promise<Watchlist> {
    const result = await pool.query<Watchlist>(
      'INSERT INTO watchlists (user_id, name) VALUES ($1, $2) RETURNING *',
      [userId, name]
    );
    return result.rows[0];
  }

  /**
   * Deletes a watchlist and all its items.
   * @param userId - ID of the watchlist owner (for authorization)
   * @param watchlistId - ID of the watchlist to delete
   * @throws Error if watchlist not found or not owned by user
   */
  async deleteWatchlist(userId: string, watchlistId: string): Promise<void> {
    const result = await pool.query(
      'DELETE FROM watchlists WHERE id = $1 AND user_id = $2',
      [watchlistId, userId]
    );

    if (result.rowCount === 0) {
      throw new Error('Watchlist not found');
    }
  }

  /**
   * Adds a stock symbol to a watchlist.
   * @param userId - ID of the watchlist owner (for authorization)
   * @param watchlistId - ID of the target watchlist
   * @param symbol - Stock ticker symbol to add
   * @returns Promise resolving to the created watchlist item
   * @throws Error if watchlist not found or symbol invalid
   */
  async addToWatchlist(
    userId: string,
    watchlistId: string,
    symbol: string
  ): Promise<WatchlistItem> {
    // Verify watchlist belongs to user
    const watchlistResult = await pool.query(
      'SELECT id FROM watchlists WHERE id = $1 AND user_id = $2',
      [watchlistId, userId]
    );

    if (watchlistResult.rows.length === 0) {
      throw new Error('Watchlist not found');
    }

    // Verify symbol is valid
    const quote = quoteService.getQuote(symbol);
    if (!quote) {
      throw new Error(`Invalid symbol: ${symbol}`);
    }

    const result = await pool.query<WatchlistItem>(
      'INSERT INTO watchlist_items (watchlist_id, symbol) VALUES ($1, $2) RETURNING *',
      [watchlistId, symbol.toUpperCase()]
    );

    return result.rows[0];
  }

  /**
   * Removes a stock symbol from a watchlist.
   * @param userId - ID of the watchlist owner (for authorization)
   * @param watchlistId - ID of the target watchlist
   * @param symbol - Stock ticker symbol to remove
   * @throws Error if watchlist not found
   */
  async removeFromWatchlist(
    userId: string,
    watchlistId: string,
    symbol: string
  ): Promise<void> {
    // Verify watchlist belongs to user
    const watchlistResult = await pool.query(
      'SELECT id FROM watchlists WHERE id = $1 AND user_id = $2',
      [watchlistId, userId]
    );

    if (watchlistResult.rows.length === 0) {
      throw new Error('Watchlist not found');
    }

    await pool.query(
      'DELETE FROM watchlist_items WHERE watchlist_id = $1 AND symbol = $2',
      [watchlistId, symbol.toUpperCase()]
    );
  }
}

/**
 * Service for managing user price alerts.
 * Allows users to set alerts that trigger when stock prices
 * cross specified thresholds. Triggered alerts are stored in Redis
 * for real-time notification delivery.
 */
export class PriceAlertService {
  private checkInterval: NodeJS.Timeout | null = null;

  /**
   * Gets all price alerts for a user.
   * @param userId - ID of the alert owner
   * @returns Promise resolving to array of alerts, newest first
   */
  async getAlerts(userId: string): Promise<PriceAlert[]> {
    const result = await pool.query<PriceAlert>(
      'SELECT * FROM price_alerts WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return result.rows;
  }

  /**
   * Creates a new price alert for a user.
   * @param userId - ID of the alert owner
   * @param symbol - Stock ticker symbol to monitor
   * @param targetPrice - Price threshold to trigger alert
   * @param condition - Trigger when price goes 'above' or 'below' target
   * @returns Promise resolving to the created alert
   * @throws Error if symbol is invalid
   */
  async createAlert(
    userId: string,
    symbol: string,
    targetPrice: number,
    condition: 'above' | 'below'
  ): Promise<PriceAlert> {
    // Verify symbol is valid
    const quote = quoteService.getQuote(symbol);
    if (!quote) {
      throw new Error(`Invalid symbol: ${symbol}`);
    }

    const result = await pool.query<PriceAlert>(
      `INSERT INTO price_alerts (user_id, symbol, target_price, condition)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [userId, symbol.toUpperCase(), targetPrice, condition]
    );

    return result.rows[0];
  }

  /**
   * Deletes a price alert.
   * @param userId - ID of the alert owner (for authorization)
   * @param alertId - ID of the alert to delete
   * @throws Error if alert not found or not owned by user
   */
  async deleteAlert(userId: string, alertId: string): Promise<void> {
    const result = await pool.query(
      'DELETE FROM price_alerts WHERE id = $1 AND user_id = $2',
      [alertId, userId]
    );

    if (result.rowCount === 0) {
      throw new Error('Alert not found');
    }
  }

  /**
   * Starts the background alert checker.
   * Periodically monitors all untriggered alerts against current prices
   * and stores triggered alerts in Redis for notification.
   */
  startAlertChecker(): void {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(async () => {
      await this.checkAlerts();
    }, 5000);

    console.log('Price alert checker started');
  }

  /**
   * Stops the background alert checker.
   */
  stopAlertChecker(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Checks all untriggered alerts against current prices.
   * Triggers alerts when conditions are met and stores them in Redis.
   */
  private async checkAlerts(): Promise<void> {
    try {
      const alertsResult = await pool.query<PriceAlert>(
        'SELECT * FROM price_alerts WHERE triggered = false'
      );

      for (const alert of alertsResult.rows) {
        const quote = quoteService.getQuote(alert.symbol);
        if (!quote) continue;

        let triggered = false;

        if (alert.condition === 'above' && quote.last >= alert.target_price) {
          triggered = true;
        } else if (alert.condition === 'below' && quote.last <= alert.target_price) {
          triggered = true;
        }

        if (triggered) {
          await pool.query(
            'UPDATE price_alerts SET triggered = true, triggered_at = NOW() WHERE id = $1',
            [alert.id]
          );

          // Store triggered alert in Redis for real-time notification
          await redis.lpush(
            `alerts:${alert.user_id}`,
            JSON.stringify({
              id: alert.id,
              symbol: alert.symbol,
              targetPrice: alert.target_price,
              condition: alert.condition,
              currentPrice: quote.last,
              triggeredAt: new Date().toISOString(),
            })
          );

          // Keep only last 100 alerts per user
          await redis.ltrim(`alerts:${alert.user_id}`, 0, 99);

          console.log(
            `Alert triggered: ${alert.symbol} ${alert.condition} $${alert.target_price} (current: $${quote.last})`
          );
        }
      }
    } catch (error) {
      console.error('Error checking alerts:', error);
    }
  }

  /**
   * Gets triggered alerts for a user from Redis.
   * @param userId - ID of the alert owner
   * @returns Promise resolving to array of triggered alert details
   */
  async getTriggeredAlerts(userId: string): Promise<unknown[]> {
    const alerts = await redis.lrange(`alerts:${userId}`, 0, -1);
    return alerts.map((a) => JSON.parse(a));
  }

  /**
   * Clears all triggered alerts for a user from Redis.
   * @param userId - ID of the alert owner
   */
  async clearTriggeredAlerts(userId: string): Promise<void> {
    await redis.del(`alerts:${userId}`);
  }
}

/**
 * Singleton instance of the WatchlistService.
 * Manages user watchlists for tracking stocks.
 */
export const watchlistService = new WatchlistService();

/**
 * Singleton instance of the PriceAlertService.
 * Manages user price alerts and background monitoring.
 */
export const priceAlertService = new PriceAlertService();
