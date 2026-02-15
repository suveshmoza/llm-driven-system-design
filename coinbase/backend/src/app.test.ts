import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock services before importing app
vi.mock('./services/db.js', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn(),
      release: vi.fn(),
    }),
  },
}));

vi.mock('./services/redis.js', () => {
  const mockRedis = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    on: vi.fn(),
    status: 'ready',
  };
  return { redis: mockRedis };
});

vi.mock('./services/kafka.js', () => ({
  getProducer: vi.fn(),
  getConsumer: vi.fn(),
  publishMessage: vi.fn().mockResolvedValue(undefined),
  disconnectKafka: vi.fn(),
  kafka: {},
}));

vi.mock('./services/metrics.js', () => ({
  httpRequestDuration: {
    startTimer: vi.fn().mockReturnValue(vi.fn()),
  },
  orderCounter: { inc: vi.fn() },
  tradeCounter: { inc: vi.fn() },
  activeWebsocketConnections: { inc: vi.fn(), dec: vi.fn() },
  orderBookDepth: { set: vi.fn() },
  register: {
    contentType: 'text/plain',
    metrics: vi.fn().mockResolvedValue(''),
  },
}));

vi.mock('./services/rateLimiter.js', () => ({
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  orderLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { app } from './app.js';
import { pool } from './services/db.js';

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };

describe('Coinbase API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.uptime).toBeDefined();
    });
  });

  describe('GET /api/v1/markets/pairs', () => {
    it('should return trading pairs with prices', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: '123',
            symbol: 'BTC-USD',
            baseCurrency: 'BTC',
            quoteCurrency: 'USD',
            pricePrecision: 2,
            quantityPrecision: 8,
            minOrderSize: '0.00000001',
            maxOrderSize: '1000000',
            isActive: true,
          },
        ],
      });

      const res = await request(app).get('/api/v1/markets/pairs');

      expect(res.status).toBe(200);
      expect(res.body.pairs).toBeDefined();
      expect(Array.isArray(res.body.pairs)).toBe(true);
    });
  });

  describe('GET /api/v1/markets/currencies', () => {
    it('should return currencies', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'BTC',
            name: 'Bitcoin',
            symbol: '₿',
            decimals: 8,
            isFiat: false,
            isActive: true,
          },
          {
            id: 'USD',
            name: 'US Dollar',
            symbol: '$',
            decimals: 2,
            isFiat: true,
            isActive: true,
          },
        ],
      });

      const res = await request(app).get('/api/v1/markets/currencies');

      expect(res.status).toBe(200);
      expect(res.body.currencies).toBeDefined();
      expect(res.body.currencies.length).toBe(2);
    });
  });

  describe('GET /api/v1/markets/:symbol/price', () => {
    it('should return price data for a valid symbol', async () => {
      const res = await request(app).get('/api/v1/markets/BTC-USD/price');

      expect(res.status).toBe(200);
      expect(res.body.symbol).toBe('BTC-USD');
      expect(res.body.price).toBeDefined();
    });

    it('should return 404 for invalid symbol', async () => {
      const res = await request(app).get('/api/v1/markets/INVALID-USD/price');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/markets/:symbol/orderbook', () => {
    it('should return order book depth', async () => {
      const res = await request(app).get('/api/v1/markets/BTC-USD/orderbook');

      expect(res.status).toBe(200);
      expect(res.body.symbol).toBe('BTC-USD');
      expect(res.body.bids).toBeDefined();
      expect(res.body.asks).toBeDefined();
    });
  });

  describe('POST /api/v1/auth/register', () => {
    it('should reject registration without required fields', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('should reject short password', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        username: 'testuser',
        email: 'test@example.com',
        password: 'short',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('8 characters');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should reject login without credentials', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({});

      expect(res.status).toBe(400);
    });

    it('should reject invalid credentials', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app).post('/api/v1/auth/login').send({
        username: 'nonexistent',
        password: 'password123',
      });

      expect(res.status).toBe(401);
    });
  });

  describe('Protected routes', () => {
    it('should reject unauthenticated access to orders', async () => {
      const res = await request(app).get('/api/v1/orders');
      expect(res.status).toBe(401);
    });

    it('should reject unauthenticated access to portfolio', async () => {
      const res = await request(app).get('/api/v1/portfolio');
      expect(res.status).toBe(401);
    });

    it('should reject unauthenticated access to wallets', async () => {
      const res = await request(app).get('/api/v1/wallets');
      expect(res.status).toBe(401);
    });

    it('should reject unauthenticated access to transactions', async () => {
      const res = await request(app).get('/api/v1/transactions');
      expect(res.status).toBe(401);
    });
  });

  describe('404 handler', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await request(app).get('/api/v1/unknown');
      expect(res.status).toBe(404);
    });
  });
});
