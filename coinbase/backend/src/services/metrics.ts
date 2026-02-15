import client from 'prom-client';

/** Prometheus metrics registry for the Coinbase API. */
const register = new client.Registry();

client.collectDefaultMetrics({ register });

/** HTTP request duration histogram by method, route, and status code. */
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

/** Total orders placed counter by side, type, and status. */
export const orderCounter = new client.Counter({
  name: 'orders_total',
  help: 'Total number of orders placed',
  labelNames: ['side', 'type', 'status'],
  registers: [register],
});

/** Total executed trades counter. */
export const tradeCounter = new client.Counter({
  name: 'trades_total',
  help: 'Total number of trades executed',
  registers: [register],
});

/** Gauge tracking current number of active WebSocket connections. */
export const activeWebsocketConnections = new client.Gauge({
  name: 'active_websocket_connections',
  help: 'Number of active WebSocket connections',
  registers: [register],
});

/** Gauge tracking order book depth by symbol and side. */
export const orderBookDepth = new client.Gauge({
  name: 'order_book_depth',
  help: 'Number of orders in the order book',
  labelNames: ['symbol', 'side'],
  registers: [register],
});

export { register };
