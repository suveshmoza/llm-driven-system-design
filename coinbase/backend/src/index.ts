import http from 'http';
import { app } from './app.js';
import { config } from './config/index.js';
import { wsManager } from './websocket.js';
import { marketService } from './services/marketService.js';
import { logger } from './services/logger.js';

const server = http.createServer(app);

// Initialize WebSocket
wsManager.initialize(server);

// Price broadcasting on the main server (for WebSocket clients)
const BROADCAST_INTERVAL = 2000;

setInterval(() => {
  const symbols = marketService.getAllSymbols();
  for (const symbol of symbols) {
    const priceData = marketService.simulatePriceTick(symbol);
    if (priceData) {
      // Broadcast to ticker subscribers
      wsManager.broadcast(`ticker:${symbol}`, {
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
    }
  }

  // Broadcast all prices summary
  const allPrices: Record<string, unknown> = {};
  const prices = marketService.getAllPrices();
  for (const [symbol, data] of prices) {
    allPrices[symbol] = data;
  }
  wsManager.broadcastToAll({
    type: 'prices',
    data: allPrices,
    timestamp: Date.now(),
  });
}, BROADCAST_INTERVAL);

server.listen(config.port, () => {
  logger.info(`Coinbase API server running on port ${config.port}`);
  logger.info(`WebSocket server running on ws://localhost:${config.port}/ws`);
  logger.info(`Health check: http://localhost:${config.port}/api/v1/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  server.close(() => {
    process.exit(0);
  });
});
