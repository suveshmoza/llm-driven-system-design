/**
 * Unit tests for the Pinterest backend API.
 * Uses vitest with mocked shared modules (db, redis, storage, queue).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ============================================
// Mock all shared modules BEFORE importing app
// ============================================

// Mock bcryptjs to avoid slow hashing in tests
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
      database: 'pinterest_test',
      user: 'test',
      password: 'test',
    },
    redis: {
      url: 'redis://localhost:6379',
      host: 'localhost',
      port: 6379,
    },
    minio: {
      endPoint: 'localhost',
      port: 9000,
      accessKey: 'minioadmin',
      secretKey: 'minioadmin',
      bucket: 'pinterest-images',
      useSSL: false,
    },
    rabbitmq: {
      url: 'amqp://localhost:5672',
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
    on: vi.fn(),
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
    on: vi.fn(),
    status: 'ready',
  },
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheDel: vi.fn().mockResolvedValue(undefined),
}));

// Mock storage service
vi.mock('./services/storage.js', () => ({
  ensureBucket: vi.fn().mockResolvedValue(undefined),
  uploadImage: vi.fn().mockResolvedValue('http://localhost:9000/pinterest-images/test.jpg'),
  getObject: vi.fn().mockResolvedValue(Buffer.from('test')),
  getPublicUrl: vi.fn().mockReturnValue('http://localhost:9000/pinterest-images/test.jpg'),
  deleteObject: vi.fn().mockResolvedValue(undefined),
  default: {},
}));

// Mock queue service
vi.mock('./services/queue.js', () => ({
  initializeQueue: vi.fn().mockResolvedValue(undefined),
  closeQueue: vi.fn().mockResolvedValue(undefined),
  publishImageProcessingJob: vi.fn().mockResolvedValue(true),
  getChannel: vi.fn().mockReturnValue(null),
  isQueueReady: vi.fn().mockReturnValue(false),
  QUEUES: { IMAGE_PROCESSING: 'pinterest-image-processing', IMAGE_PROCESSING_DLQ: 'pinterest-image-processing-dlq' },
}));

// Mock image service
vi.mock('./services/imageService.js', () => ({
  uploadOriginalImage: vi.fn().mockResolvedValue({
    imageKey: 'originals/test.jpg',
    imageUrl: 'http://localhost:9000/pinterest-images/originals/test.jpg',
  }),
  uploadThumbnail: vi.fn().mockResolvedValue('http://localhost:9000/pinterest-images/thumbnails/test.webp'),
}));

// Mock pin service
vi.mock('./services/pinService.js', () => ({
  getPinById: vi.fn().mockResolvedValue(null),
  createPin: vi.fn().mockResolvedValue({
    id: 'pin-123',
    user_id: 'user-123',
    title: 'Test Pin',
    description: 'A test pin',
    image_url: 'http://localhost:9000/test.jpg',
    status: 'processing',
    created_at: new Date(),
  }),
  deletePin: vi.fn().mockResolvedValue(true),
  searchPins: vi.fn().mockResolvedValue([]),
  getPinsByUserId: vi.fn().mockResolvedValue([]),
  savePinToBoard: vi.fn().mockResolvedValue(true),
  unsavePinFromBoard: vi.fn().mockResolvedValue(true),
  updatePinProcessing: vi.fn().mockResolvedValue(undefined),
}));

// Mock feed service
vi.mock('./services/feedService.js', () => ({
  getFeed: vi.fn().mockResolvedValue({ pins: [], nextCursor: null }),
  getDiscoverFeed: vi.fn().mockResolvedValue({ pins: [], nextCursor: null }),
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
  };
});

// Mock metrics service
vi.mock('./services/metrics.js', () => {
  const mockCounter = { inc: vi.fn(), dec: vi.fn(), labels: vi.fn().mockReturnValue({ inc: vi.fn(), dec: vi.fn() }) };
  const mockHistogram = { observe: vi.fn(), labels: vi.fn().mockReturnValue({ observe: vi.fn() }) };
  return {
    register: {
      contentType: 'text/plain',
      metrics: vi.fn().mockResolvedValue('# metrics'),
    },
    metricsMiddleware: vi.fn().mockImplementation((_req: unknown, _res: unknown, next: () => void) => next()),
    httpRequestDuration: mockHistogram,
    httpRequestsTotal: mockCounter,
    pinsCreatedTotal: mockCounter,
    pinSavesTotal: mockCounter,
    imageProcessingDuration: mockHistogram,
    imageProcessingErrors: mockCounter,
    feedGenerationDuration: mockHistogram,
    feedCacheHits: mockCounter,
    feedCacheMisses: mockCounter,
    authAttempts: mockCounter,
  };
});

// Mock rate limiter service
vi.mock('./services/rateLimiter.js', () => {
  const passThrough = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    generalRateLimiter: passThrough,
    pinRateLimiter: passThrough,
    loginRateLimiter: passThrough,
    followRateLimiter: passThrough,
    saveRateLimiter: passThrough,
    searchRateLimiter: passThrough,
  };
});

// Mock circuit breaker service
vi.mock('./services/circuitBreaker.js', () => ({
  createCircuitBreaker: vi.fn().mockImplementation((_name: string, fn: (...args: unknown[]) => Promise<unknown>) => ({
    fire: vi.fn().mockImplementation((...args: unknown[]) => fn(...args)),
    fallback: vi.fn(),
    on: vi.fn(),
  })),
  fallbackWithDefault: vi.fn().mockImplementation((val: unknown) => () => val),
  fallbackWithError: vi.fn().mockImplementation((msg: string) => () => { throw new Error(msg); }),
  getCircuitBreakerHealth: vi.fn().mockReturnValue({}),
}));

// Mock connect-redis
vi.mock('connect-redis', () => {
  const { EventEmitter } = require('events');
  return {
    RedisStore: class MockRedisStore extends EventEmitter {
      get(_sid: string, cb: (err: null, session: null) => void) { cb(null, null); }
      set(_sid: string, _session: unknown, cb: (err: null) => void) { cb(null); }
      destroy(_sid: string, cb: (err: null) => void) { cb(null); }
      touch(_sid: string, _session: unknown, cb: (err: null) => void) { cb(null); }
    },
  };
});

// ============================================
// Import app AFTER all mocks are defined
// ============================================
import { app } from './app.js';
import { query } from './services/db.js';

describe('Pinterest Backend API', () => {
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
        bio: null,
        follower_count: 0,
        following_count: 0,
        created_at: new Date(),
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
      expect(response.body).toEqual({ error: 'Username, email, and password are required' });
    });

    it('should return 400 for short username', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'ab', email: 'test@example.com', password: 'password123' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Username must be 3-30 characters' });
    });

    it('should return 400 for short password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'testuser', email: 'test@example.com', password: '12345' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Password must be at least 6 characters' });
    });

    it('should return 409 for duplicate username or email', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: 'existing-user' }], rowCount: 1 } as never);

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'existinguser',
          email: 'existing@example.com',
          password: 'password123',
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'Username or email already exists' });
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should return 400 for missing credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Username and password are required' });
    });

    it('should return 401 for non-existent user', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

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
  // User Routes
  // ============================================

  describe('GET /api/v1/users/:username', () => {
    it('should return user profile', async () => {
      const mockUser = {
        id: 'user-123',
        username: 'alice',
        display_name: 'Alice',
        avatar_url: null,
        bio: 'I love pinning things',
        follower_count: 100,
        following_count: 50,
        created_at: new Date('2024-01-01'),
      };

      vi.mocked(query).mockResolvedValueOnce({ rows: [mockUser], rowCount: 1 } as never);

      const response = await request(app).get('/api/v1/users/alice');

      expect(response.status).toBe(200);
      expect(response.body.user).toHaveProperty('username', 'alice');
      expect(response.body.user).toHaveProperty('displayName', 'Alice');
      expect(response.body.user).toHaveProperty('followerCount', 100);
    });

    it('should return 404 for non-existent user', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      const response = await request(app).get('/api/v1/users/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'User not found' });
    });

    it('should return 500 on database error', async () => {
      vi.mocked(query).mockRejectedValueOnce(new Error('DB connection failed'));

      const response = await request(app).get('/api/v1/users/alice');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });
  });

  // ============================================
  // Pin Routes
  // ============================================

  describe('GET /api/v1/pins/:pinId', () => {
    it('should return 404 for non-existent pin', async () => {
      const response = await request(app).get('/api/v1/pins/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Pin not found' });
    });
  });

  // ============================================
  // Search Routes
  // ============================================

  describe('GET /api/v1/search/pins', () => {
    it('should return empty for short query', async () => {
      const response = await request(app).get('/api/v1/search/pins?q=a');

      expect(response.status).toBe(200);
      expect(response.body.pins).toHaveLength(0);
    });
  });

  describe('GET /api/v1/search/users', () => {
    it('should return matching users', async () => {
      const mockUsers = [
        {
          id: 'user-1',
          username: 'alice',
          display_name: 'Alice',
          avatar_url: null,
          follower_count: 100,
        },
      ];

      vi.mocked(query).mockResolvedValueOnce({ rows: mockUsers, rowCount: 1 } as never);

      const response = await request(app).get('/api/v1/search/users?q=ali');

      expect(response.status).toBe(200);
      expect(response.body.users).toHaveLength(1);
      expect(response.body.users[0]).toHaveProperty('username', 'alice');
    });

    it('should return empty for short query', async () => {
      const response = await request(app).get('/api/v1/search/users?q=a');

      expect(response.status).toBe(200);
      expect(response.body.users).toHaveLength(0);
    });
  });

  // ============================================
  // Auth-protected Routes (unauthenticated tests)
  // ============================================

  describe('Auth-protected routes return 401 for unauthenticated requests', () => {
    it('POST /api/v1/pins should return 401', async () => {
      const response = await request(app).post('/api/v1/pins');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });

    it('DELETE /api/v1/pins/:pinId should return 401', async () => {
      const response = await request(app).delete('/api/v1/pins/pin-123');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });

    it('POST /api/v1/boards should return 401', async () => {
      const response = await request(app)
        .post('/api/v1/boards')
        .send({ name: 'Test Board' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });

    it('GET /api/v1/feed should return 401', async () => {
      const response = await request(app).get('/api/v1/feed');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });

    it('POST /api/v1/users/:userId/follow should return 401', async () => {
      const response = await request(app).post('/api/v1/users/user-123/follow');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });

    it('POST /api/v1/pins/:pinId/save should return 401', async () => {
      const response = await request(app)
        .post('/api/v1/pins/pin-123/save')
        .send({ boardId: 'board-123' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });

    it('POST /api/v1/pins/:pinId/comments should return 401', async () => {
      const response = await request(app)
        .post('/api/v1/pins/pin-123/comments')
        .send({ content: 'test comment' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });
  });

  // ============================================
  // Discover Feed (public)
  // ============================================

  describe('GET /api/v1/feed/discover', () => {
    it('should return discover feed without auth', async () => {
      const response = await request(app).get('/api/v1/feed/discover');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('pins');
      expect(response.body).toHaveProperty('nextCursor');
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
