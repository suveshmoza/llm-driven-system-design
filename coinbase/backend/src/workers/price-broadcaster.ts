import { marketService } from '../services/marketService.js';
import { pool } from '../services/db.js';
import { publishMessage } from '../services/kafka.js';
import { logger } from '../services/logger.js';

const TICK_INTERVAL = 2000; // 2 seconds
const CANDLE_INTERVAL = 60000; // 1 minute

let lastCandleTime = new Date();
lastCandleTime.setSeconds(0, 0);

/** Simulates price ticks for all symbols and publishes updates to Kafka. */
async function broadcastPrices(): Promise<void> {
  const symbols = marketService.getAllSymbols();

  for (const symbol of symbols) {
    const priceData = marketService.simulatePriceTick(symbol);
    if (!priceData) continue;

    // Publish price update to Kafka
    try {
      await publishMessage('price-updates', symbol, {
        type: 'ticker',
        symbol,
        price: priceData.price,
        change24h: priceData.change24h,
        changePercent24h: priceData.changePercent24h,
        volume24h: priceData.volume24h,
        high24h: priceData.high24h,
        low24h: priceData.low24h,
        timestamp: Date.now(),
      });
    } catch (_err) {
      // Kafka may not be available, continue
    }
  }
}

/** Stores completed 1-minute candles to the database if a new minute has started. */
async function storeCandlesIfNeeded(): Promise<void> {
  const now = new Date();
  now.setSeconds(0, 0);

  if (now.getTime() <= lastCandleTime.getTime()) return;

  const symbols = marketService.getAllSymbols();

  for (const symbol of symbols) {
    const candle = marketService.getCompletedCandle(symbol);
    if (!candle) continue;

    try {
      await pool.query(
        `INSERT INTO price_candles (symbol, interval, open_time, open, high, low, close, volume)
         VALUES ($1, '1m', $2, $3, $4, $5, $6, $7)
         ON CONFLICT (symbol, interval, open_time)
         DO UPDATE SET high = GREATEST(price_candles.high, $4),
                       low = LEAST(price_candles.low, $5),
                       close = $6,
                       volume = price_candles.volume + $7`,
        [
          symbol,
          candle.openTime.toISOString(),
          candle.open.toString(),
          candle.high.toString(),
          candle.low.toString(),
          candle.close.toString(),
          candle.volume.toString(),
        ]
      );
    } catch (error) {
      logger.error({ error, symbol }, 'Failed to store candle');
    }
  }

  lastCandleTime = now;
}

async function run(): Promise<void> {
  logger.info('Price broadcaster worker started');

  // Price tick every 2 seconds
  setInterval(async () => {
    try {
      await broadcastPrices();
    } catch (error) {
      logger.error({ error }, 'Error broadcasting prices');
    }
  }, TICK_INTERVAL);

  // Store candles every minute
  setInterval(async () => {
    try {
      await storeCandlesIfNeeded();
    } catch (error) {
      logger.error({ error }, 'Error storing candles');
    }
  }, CANDLE_INTERVAL);
}

run().catch((error) => {
  logger.error({ error }, 'Price broadcaster failed to start');
  process.exit(1);
});
