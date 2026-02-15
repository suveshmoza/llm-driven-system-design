import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock services before importing app
vi.mock('./services/db.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn(),
  },
}));

vi.mock('./services/redis.js', () => {
  const mockRedis = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    status: 'ready',
  };
  return {
    redis: mockRedis,
    connectRedis: vi.fn().mockResolvedValue(undefined),
  };
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

vi.mock('./services/metrics.js', () => {
  const mockHistogram = {
    startTimer: vi.fn(() => vi.fn()),
    observe: vi.fn(),
    labels: vi.fn().mockReturnThis(),
  };
  const mockCounter = {
    inc: vi.fn(),
    labels: vi.fn().mockReturnThis(),
  };
  const mockGauge = {
    set: vi.fn(),
    inc: vi.fn(),
    dec: vi.fn(),
    labels: vi.fn().mockReturnThis(),
  };
  return {
    httpRequestDuration: mockHistogram,
    httpRequestTotal: mockCounter,
    queryExecutionDuration: mockHistogram,
    activeApps: mockGauge,
    register: {
      metrics: vi.fn().mockResolvedValue(''),
      contentType: 'text/plain',
    },
  };
});

vi.mock('./services/rateLimiter.js', () => {
  const passthrough = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    apiLimiter: passthrough,
    authLimiter: passthrough,
    queryLimiter: passthrough,
  };
});

vi.mock('./services/queryExecutor.js', () => ({
  executeQuery: vi.fn().mockResolvedValue({
    rows: [{ id: 1, name: 'Test' }],
    fields: [{ name: 'id', dataType: 'integer' }, { name: 'name', dataType: 'text' }],
    rowCount: 1,
  }),
  testConnection: vi.fn().mockResolvedValue({ success: true }),
  cleanupTargetPools: vi.fn(),
}));

import { app } from './app.js';
import { pool } from './services/db.js';

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };

describe('Retool Backend API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
    });

    it('should return 503 when database is down', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Connection refused'));

      const res = await request(app).get('/api/health');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('unhealthy');
    });
  });

  describe('GET /metrics', () => {
    it('should return prometheus metrics', async () => {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/auth/register', () => {
    it('should reject missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'test' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('should reject short username', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'ab', email: 'a@b.com', password: 'password123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('3-30');
    });

    it('should reject short password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'alice', email: 'alice@example.com', password: '123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('6 characters');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should reject missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('should reject invalid credentials', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'nonexistent', password: 'password123' });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Invalid');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return 401 when not authenticated', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/components', () => {
    it('should return component definitions', async () => {
      const res = await request(app).get('/api/components');
      expect(res.status).toBe(200);
      expect(res.body.components).toBeDefined();
      expect(Array.isArray(res.body.components)).toBe(true);
      expect(res.body.components.length).toBeGreaterThan(0);
    });

    it('should return specific component type', async () => {
      const res = await request(app).get('/api/components/table');
      expect(res.status).toBe(200);
      expect(res.body.component.type).toBe('table');
    });

    it('should return 404 for unknown component type', async () => {
      const res = await request(app).get('/api/components/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('Protected routes', () => {
    it('should reject unauthenticated access to apps', async () => {
      const res = await request(app).get('/api/apps');
      expect(res.status).toBe(401);
    });

    it('should reject unauthenticated access to datasources', async () => {
      const res = await request(app).get('/api/datasources');
      expect(res.status).toBe(401);
    });

    it('should reject unauthenticated query execution', async () => {
      const res = await request(app)
        .post('/api/queries/execute')
        .send({ dataSourceId: 'test', queryText: 'SELECT 1' });
      expect(res.status).toBe(401);
    });
  });
});
