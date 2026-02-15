/**
 * Unit tests for the Gmail backend API.
 * Uses vitest with mocked shared modules (db, redis, elasticsearch).
 * @module app.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ============================================
// Mock all shared modules BEFORE importing app
// ============================================

// Mock bcryptjs
vi.mock('bcryptjs', () => {
  const mockModule = {
    hash: vi.fn().mockResolvedValue('$2a$12$mockedhashvalue'),
    compare: vi.fn().mockResolvedValue(true),
    hashSync: vi.fn().mockReturnValue('$2a$12$mockedhashvalue'),
    compareSync: vi.fn().mockReturnValue(true),
    genSalt: vi.fn().mockResolvedValue('$2a$12$salt'),
    genSaltSync: vi.fn().mockReturnValue('$2a$12$salt'),
    getRounds: vi.fn().mockReturnValue(12),
  };
  return {
    ...mockModule,
    default: mockModule,
  };
});

// Mock config
vi.mock('./config/index.js', () => ({
  default: {
    port: 3000,
    nodeEnv: 'test',
    database: {
      host: 'localhost',
      port: 5432,
      database: 'gmail_test',
      user: 'test',
      password: 'test',
    },
    redis: {
      url: 'redis://localhost:6379',
      host: 'localhost',
      port: 6379,
    },
    elasticsearch: {
      node: 'http://localhost:9200',
    },
    session: {
      secret: 'test-secret',
      maxAge: 86400000,
    },
  },
}));

// Mock db service
vi.mock('./services/db.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
  pool: {
    query: vi.fn(),
    end: vi.fn(),
    connect: vi.fn(),
  },
  default: {
    query: vi.fn(),
    end: vi.fn(),
    connect: vi.fn(),
    on: vi.fn(),
  },
}));

// Mock redis service
vi.mock('./services/redis.js', () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue('PONG'),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    call: vi.fn().mockResolvedValue(null),
    on: vi.fn(),
    status: 'ready',
  },
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheDel: vi.fn().mockResolvedValue(undefined),
}));

// Mock elasticsearch service
vi.mock('./services/elasticsearch.js', () => ({
  initializeIndex: vi.fn().mockResolvedValue(undefined),
  indexMessage: vi.fn().mockResolvedValue(undefined),
  searchEmails: vi.fn().mockResolvedValue({ results: [], total: 0 }),
  isElasticsearchConnected: vi.fn().mockResolvedValue(false),
  esClient: {},
  EMAIL_INDEX: 'emails',
  default: {},
}));

// Mock logger service
vi.mock('./services/logger.js', () => {
  const noopLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return {
    default: noopLogger,
    logger: noopLogger,
    logRequest: vi.fn(),
    logError: vi.fn(),
    logQuery: vi.fn(),
    logCache: vi.fn(),
    logMetric: vi.fn(),
    createRequestLogger: vi.fn().mockReturnValue(noopLogger),
  };
});

// Mock metrics service
vi.mock('./services/metrics.js', () => {
  const mockCounter = {
    inc: vi.fn(),
    dec: vi.fn(),
    labels: vi.fn().mockReturnValue({ inc: vi.fn(), dec: vi.fn() }),
  };
  const mockHistogram = {
    observe: vi.fn(),
    labels: vi.fn().mockReturnValue({ observe: vi.fn() }),
  };
  const mockGauge = {
    set: vi.fn(),
    inc: vi.fn(),
    dec: vi.fn(),
    labels: vi.fn().mockReturnValue({ set: vi.fn(), inc: vi.fn(), dec: vi.fn() }),
  };
  return {
    register: {
      contentType: 'text/plain',
      metrics: vi.fn().mockResolvedValue('# metrics'),
    },
    metricsMiddleware: vi.fn().mockImplementation(
      (_req: unknown, _res: unknown, next: () => void) => next()
    ),
    httpRequestDuration: mockHistogram,
    httpRequestsTotal: mockCounter,
    emailsSentTotal: mockCounter,
    emailsReceivedTotal: mockCounter,
    searchQueriesTotal: mockCounter,
    searchDuration: mockHistogram,
    draftConflictsTotal: mockCounter,
    authAttempts: mockCounter,
    rateLimitHits: mockCounter,
    circuitBreakerState: mockGauge,
    circuitBreakerEvents: mockCounter,
    dbQueryDuration: mockHistogram,
    dbConnectionPoolSize: mockGauge,
    indexedMessagesTotal: mockCounter,
    timedOperation: vi.fn().mockImplementation(
      async (_h: unknown, _l: unknown, fn: () => Promise<unknown>) => fn()
    ),
    default: {
      contentType: 'text/plain',
      metrics: vi.fn().mockResolvedValue('# metrics'),
    },
  };
});

// Mock rate limiter service
vi.mock('./services/rateLimiter.js', () => {
  const passThrough = (_req: unknown, _res: unknown, next: () => void) =>
    next();
  return {
    sendRateLimiter: passThrough,
    loginRateLimiter: passThrough,
    searchRateLimiter: passThrough,
    generalRateLimiter: passThrough,
    default: {
      sendRateLimiter: passThrough,
      loginRateLimiter: passThrough,
      searchRateLimiter: passThrough,
      generalRateLimiter: passThrough,
    },
  };
});

// Mock circuit breaker service
vi.mock('./services/circuitBreaker.js', () => ({
  createCircuitBreaker: vi.fn().mockImplementation(
    (_name: string, fn: (...args: unknown[]) => Promise<unknown>) => ({
      fire: vi.fn().mockImplementation((...args: unknown[]) => fn(...args)),
      fallback: vi.fn(),
      on: vi.fn(),
    })
  ),
  fallbackWithDefault: vi.fn().mockImplementation((val: unknown) => () => val),
  fallbackWithError: vi.fn().mockImplementation((msg: string) => () => {
    throw new Error(msg);
  }),
  default: vi.fn(),
}));

// Mock connect-redis
vi.mock('connect-redis', () => {
  const { EventEmitter } = require('events');
  return {
    RedisStore: class MockRedisStore extends EventEmitter {
      get(_sid: string, cb: (err: null, session: null) => void) {
        cb(null, null);
      }
      set(_sid: string, _session: unknown, cb: (err: null) => void) {
        cb(null);
      }
      destroy(_sid: string, cb: (err: null) => void) {
        cb(null);
      }
      touch(_sid: string, _session: unknown, cb: (err: null) => void) {
        cb(null);
      }
    },
  };
});

// Mock label service (for registration)
vi.mock('./services/labelService.js', () => ({
  createSystemLabels: vi.fn().mockResolvedValue(undefined),
  listLabels: vi.fn().mockResolvedValue([]),
  createLabel: vi.fn().mockResolvedValue({
    id: 'label-1',
    name: 'Test',
    color: '#666666',
    isSystem: false,
  }),
  updateLabel: vi.fn().mockResolvedValue(null),
  deleteLabel: vi.fn().mockResolvedValue(false),
  assignLabel: vi.fn().mockResolvedValue(undefined),
  removeLabel: vi.fn().mockResolvedValue(undefined),
}));

// Mock thread service
vi.mock('./services/threadService.js', () => ({
  listThreads: vi.fn().mockResolvedValue({ threads: [], total: 0 }),
  getThread: vi.fn().mockResolvedValue(null),
  updateThreadState: vi.fn().mockResolvedValue(undefined),
  getUnreadCounts: vi.fn().mockResolvedValue(new Map()),
}));

// Mock message service
vi.mock('./services/messageService.js', () => ({
  sendMessage: vi.fn().mockResolvedValue({
    threadId: 'thread-1',
    messageId: 'msg-1',
  }),
}));

// Mock draft service
vi.mock('./services/draftService.js', () => ({
  listDrafts: vi.fn().mockResolvedValue([]),
  getDraft: vi.fn().mockResolvedValue(null),
  createDraft: vi.fn().mockResolvedValue({
    id: 'draft-1',
    threadId: null,
    inReplyTo: null,
    subject: 'Test',
    bodyText: 'Hello',
    bodyHtml: null,
    to: [],
    cc: [],
    bcc: [],
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  updateDraft: vi.fn().mockResolvedValue({ draft: null, conflict: false }),
  deleteDraft: vi.fn().mockResolvedValue(false),
}));

// Mock search service
vi.mock('./services/searchService.js', () => ({
  search: vi.fn().mockResolvedValue({ results: [], total: 0 }),
  parseSearchQuery: vi.fn().mockReturnValue({ text: '', filters: {} }),
}));

// ============================================
// Import app AFTER all mocks are defined
// ============================================
import { app } from './app.js';
import { query } from './services/db.js';

describe('Gmail Backend API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // Health Check Endpoints
  // ============================================

  describe('GET /api/health', () => {
    it('should return health status with ok and timestamp', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('GET /api/health/live', () => {
    it('should return alive status', async () => {
      const response = await request(app).get('/api/health/live');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'alive' });
    });
  });

  // ============================================
  // 404 Handler
  // ============================================

  describe('404 handler', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app).get('/api/v1/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Not found' });
    });
  });

  // ============================================
  // Auth Routes
  // ============================================

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user', async () => {
      const mockUser = {
        id: 'user-123',
        username: 'testuser',
        email: 'test@example.com',
        display_name: 'Test User',
        avatar_url: null,
        created_at: new Date().toISOString(),
      };

      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
        .mockResolvedValueOnce({ rows: [mockUser], rowCount: 1 } as never);

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'password123',
          displayName: 'Test User',
        });

      expect(response.status).toBe(201);
      expect(response.body.user).toHaveProperty('username', 'testuser');
      expect(response.body.user).toHaveProperty('email', 'test@example.com');
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'testuser' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Username, email, and password are required',
      });
    });

    it('should return 400 for short username', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'ab',
          email: 'test@example.com',
          password: 'password123',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Username must be 3-30 characters',
      });
    });

    it('should return 400 for short password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: '12345',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Password must be at least 6 characters',
      });
    });

    it('should return 409 for duplicate username or email', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ id: 'existing-user' }],
        rowCount: 1,
      } as never);

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'existinguser',
          email: 'existing@example.com',
          password: 'password123',
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Username or email already exists',
      });
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should return 400 for missing credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Username and password are required',
      });
    });

    it('should return 401 for non-existent user', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as never);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'nonexistent', password: 'password123' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Invalid credentials' });
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should return 401 for unauthenticated request', async () => {
      const response = await request(app).get('/api/v1/auth/me');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });
  });

  // ============================================
  // Auth-protected Routes (unauthenticated tests)
  // ============================================

  describe('Auth-protected routes return 401 for unauthenticated requests', () => {
    it('GET /api/v1/threads should return 401', async () => {
      const response = await request(app).get('/api/v1/threads');
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });

    it('GET /api/v1/labels should return 401', async () => {
      const response = await request(app).get('/api/v1/labels');
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });

    it('POST /api/v1/messages/send should return 401', async () => {
      const response = await request(app)
        .post('/api/v1/messages/send')
        .send({ to: ['test@test.com'], subject: 'Test', bodyText: 'Hello' });
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });

    it('GET /api/v1/drafts should return 401', async () => {
      const response = await request(app).get('/api/v1/drafts');
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });

    it('GET /api/v1/contacts should return 401', async () => {
      const response = await request(app).get('/api/v1/contacts?q=test');
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });
  });

  // ============================================
  // Metrics Endpoint
  // ============================================

  describe('GET /metrics', () => {
    it('should return prometheus metrics', async () => {
      const response = await request(app).get('/metrics');

      expect(response.status).toBe(200);
      expect(response.text).toBe('# metrics');
    });
  });
});
