import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock shared modules before importing app
vi.mock('./services/db.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock('./services/redis.js', () => {
  const mockRedis = {
    on: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    disconnect: vi.fn(),
  };
  return { redis: mockRedis };
});

vi.mock('./services/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

vi.mock('./services/metrics.js', () => ({
  httpRequestDuration: { observe: vi.fn(), startTimer: vi.fn(() => vi.fn()) },
  activeMeetings: { inc: vi.fn(), dec: vi.fn(), set: vi.fn() },
  activeParticipants: { inc: vi.fn(), dec: vi.fn(), set: vi.fn() },
  wsConnections: { inc: vi.fn(), dec: vi.fn(), set: vi.fn() },
  metricsRegistry: {
    metrics: vi.fn().mockResolvedValue(''),
    contentType: 'text/plain',
  },
}));

vi.mock('./services/circuitBreaker.js', () => ({
  createCircuitBreaker: vi.fn((fn: unknown) => ({
    fire: fn,
    on: vi.fn(),
  })),
}));

vi.mock('./services/rateLimiter.js', () => ({
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('connect-redis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      get: vi.fn(),
      set: vi.fn(),
      destroy: vi.fn(),
      touch: vi.fn(),
    })),
  };
});

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2a$10$hashedpassword'),
    compare: vi.fn().mockResolvedValue(true),
  },
}));

import request from 'supertest';
import { app } from './app.js';
import { pool } from './services/db.js';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

describe('Zoom Backend API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // check existing
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'user-1',
              username: 'testuser',
              email: 'test@example.com',
              display_name: 'Test User',
              created_at: new Date().toISOString(),
            },
          ],
        }); // insert

      const res = await request(app).post('/api/auth/register').send({
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
        displayName: 'Test User',
      });

      expect(res.status).toBe(201);
      expect(res.body.user.username).toBe('testuser');
    });

    it('should return 400 when fields are missing', async () => {
      const res = await request(app).post('/api/auth/register').send({
        username: 'testuser',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('should return 409 when user already exists', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing' }] });

      const res = await request(app).post('/api/auth/register').send({
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
      });

      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should return 400 when fields are missing', async () => {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).toBe(400);
    });

    it('should return 401 for invalid credentials', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app).post('/api/auth/login').send({
        username: 'nonexistent',
        password: 'wrong',
      });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return 401 when not authenticated', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/meetings', () => {
    it('should return 401 when not authenticated', async () => {
      const res = await request(app).get('/api/meetings');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/meetings', () => {
    it('should return 401 when not authenticated', async () => {
      const res = await request(app).post('/api/meetings').send({
        title: 'Test Meeting',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/meetings/code/:code', () => {
    it('should return 401 when not authenticated', async () => {
      const res = await request(app).get('/api/meetings/code/abc-defg-hij');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/metrics', () => {
    it('should return metrics', async () => {
      const res = await request(app).get('/api/metrics');
      expect(res.status).toBe(200);
    });
  });
});
