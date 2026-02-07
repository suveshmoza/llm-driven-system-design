/**
 * Unit tests for the Instagram backend API.
 * Uses vitest with mocked shared modules (db, redis, storage, queue, cassandra).
 * @module app.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ============================================
// Mock all shared modules BEFORE importing app
// ============================================

// Mock config
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
      database: 'instagram_test',
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
      bucket: 'instagram-media',
      useSSL: false,
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
    zadd: vi.fn().mockResolvedValue(1),
    zrevrange: vi.fn().mockResolvedValue([]),
    zrem: vi.fn().mockResolvedValue(1),
    zremrangebyrank: vi.fn().mockResolvedValue(0),
    call: vi.fn().mockResolvedValue(null),
    on: vi.fn(),
    status: 'ready',
  },
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheDel: vi.fn().mockResolvedValue(undefined),
  timelineAdd: vi.fn().mockResolvedValue(undefined),
  timelineGet: vi.fn().mockResolvedValue([]),
  timelineRemove: vi.fn().mockResolvedValue(undefined),
  storyTrayGet: vi.fn().mockResolvedValue(null),
  storyTraySet: vi.fn().mockResolvedValue(undefined),
}));

// Mock storage service
vi.mock('./services/storage.js', () => ({
  ensureBucket: vi.fn().mockResolvedValue(undefined),
  storeOriginalImage: vi.fn().mockResolvedValue({ key: 'originals/test.jpg', fileId: 'test-id' }),
  processAndUploadImage: vi.fn().mockResolvedValue({
    id: 'test-id',
    urls: {},
    width: 1080,
    height: 1080,
    filter: 'none',
    mediaUrl: 'http://localhost:9000/images/test.jpg',
    thumbnailUrl: 'http://localhost:9000/images/test-thumb.jpg',
  }),
  uploadProfilePicture: vi.fn().mockResolvedValue('http://localhost:9000/profiles/test.jpg'),
  FILTERS: { none: '', clarendon: 'contrast(1.2)', moon: 'grayscale(1)' },
  getPublicUrl: vi.fn().mockReturnValue('http://localhost:9000/test'),
  deleteObject: vi.fn().mockResolvedValue(undefined),
  default: {},
}));

// Mock queue service
vi.mock('./services/queue.js', () => ({
  initializeQueue: vi.fn().mockResolvedValue(undefined),
  closeQueue: vi.fn().mockResolvedValue(undefined),
  publishImageProcessingJob: vi.fn().mockResolvedValue(true),
  isQueueReady: vi.fn().mockReturnValue(false),
  QUEUES: { IMAGE_PROCESSING: 'image-processing', IMAGE_PROCESSING_DLQ: 'image-processing-dlq' },
}));

// Mock cassandra service
vi.mock('./services/cassandra.js', () => ({
  initCassandra: vi.fn().mockResolvedValue(undefined),
  closeCassandra: vi.fn().mockResolvedValue(undefined),
  getCassandraClient: vi.fn().mockReturnValue(null),
  isCassandraConnected: vi.fn().mockReturnValue(false),
  generateTimeUuid: vi.fn(),
  toUuid: vi.fn(),
  generateUserPairKey: vi.fn(),
  types: {},
}));

// Mock message service
vi.mock('./services/messageService.js', () => ({
  getOrCreateConversation: vi.fn(),
  sendMessage: vi.fn(),
  getMessages: vi.fn(),
  getConversations: vi.fn(),
  markConversationRead: vi.fn(),
  setTypingIndicator: vi.fn(),
  getTypingIndicators: vi.fn(),
  addReaction: vi.fn(),
  removeReaction: vi.fn(),
}));

// Mock logger service - silence all logging during tests
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
  const mockCounter = { inc: vi.fn(), dec: vi.fn(), labels: vi.fn().mockReturnValue({ inc: vi.fn(), dec: vi.fn() }) };
  const mockHistogram = { observe: vi.fn(), labels: vi.fn().mockReturnValue({ observe: vi.fn() }) };
  const mockGauge = { set: vi.fn(), inc: vi.fn(), dec: vi.fn(), labels: vi.fn().mockReturnValue({ set: vi.fn(), inc: vi.fn(), dec: vi.fn() }) };
  return {
    register: {
      contentType: 'text/plain',
      metrics: vi.fn().mockResolvedValue('# metrics'),
    },
    metricsMiddleware: vi.fn().mockImplementation((_req: unknown, _res: unknown, next: () => void) => next()),
    httpRequestDuration: mockHistogram,
    httpRequestsTotal: mockCounter,
    postsCreatedTotal: mockCounter,
    postsDeletedTotal: mockCounter,
    likesTotal: mockCounter,
    likesDuplicateTotal: mockCounter,
    followsTotal: mockCounter,
    followsRateLimited: mockCounter,
    feedGenerationDuration: mockHistogram,
    feedCacheHits: mockCounter,
    feedCacheMisses: mockCounter,
    imageProcessingDuration: mockHistogram,
    imageProcessingErrors: mockCounter,
    storiesCreatedTotal: mockCounter,
    storyViewsTotal: mockCounter,
    activeSessions: mockGauge,
    authAttempts: mockCounter,
    rateLimitHits: mockCounter,
    circuitBreakerState: mockGauge,
    circuitBreakerEvents: mockCounter,
    dbQueryDuration: mockHistogram,
    dbConnectionPoolSize: mockGauge,
    timedOperation: vi.fn().mockImplementation(async (_h: unknown, _l: unknown, fn: () => Promise<unknown>) => fn()),
    default: {
      contentType: 'text/plain',
      metrics: vi.fn().mockResolvedValue('# metrics'),
    },
  };
});

// Mock rate limiter service - pass through all requests
vi.mock('./services/rateLimiter.js', () => {
  const passThrough = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    generalRateLimiter: passThrough,
    postRateLimiter: passThrough,
    followRateLimiter: passThrough,
    followRateLimitMiddleware: passThrough,
    loginRateLimiter: passThrough,
    likeRateLimiter: passThrough,
    commentRateLimiter: passThrough,
    storyRateLimiter: passThrough,
    feedRateLimiter: passThrough,
    checkRateLimit: vi.fn().mockResolvedValue(true),
    default: {
      postRateLimiter: passThrough,
      followRateLimiter: passThrough,
      followRateLimitMiddleware: passThrough,
      loginRateLimiter: passThrough,
      likeRateLimiter: passThrough,
      commentRateLimiter: passThrough,
      storyRateLimiter: passThrough,
      feedRateLimiter: passThrough,
      generalRateLimiter: passThrough,
      checkRateLimit: vi.fn().mockResolvedValue(true),
    },
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
  default: vi.fn(),
}));

// Mock connect-redis (session store) - must use class with EventEmitter interface
// The store methods must call their callbacks for express-session to complete requests
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

// Helper: creates an authenticated agent by setting session data
const authenticatedAgent = () => {
  // Since session is mocked, we simulate auth by setting session via a middleware
  // We use supertest cookies approach: first hit a test endpoint that sets session
  return request(app);
};

describe('Instagram Backend API', () => {
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
        bio: null,
        profile_picture_url: null,
        follower_count: 0,
        following_count: 0,
        post_count: 0,
        role: 'user',
        created_at: new Date(),
      };

      // Mock: check for existing user (none found)
      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // No existing user
        .mockResolvedValueOnce({ rows: [mockUser], rowCount: 1 } as never); // Create user

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
      expect(response.body.user).not.toHaveProperty('password_hash');
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
      expect(response.body).toEqual({ error: 'Not authenticated' });
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
        bio: 'Hello world',
        profile_picture_url: null,
        follower_count: 100,
        following_count: 50,
        post_count: 25,
        is_private: false,
        created_at: new Date('2024-01-01'),
      };

      vi.mocked(query).mockResolvedValueOnce({ rows: [mockUser], rowCount: 1 } as never);

      const response = await request(app).get('/api/v1/users/alice');

      expect(response.status).toBe(200);
      expect(response.body.user).toHaveProperty('username', 'alice');
      expect(response.body.user).toHaveProperty('displayName', 'Alice');
      expect(response.body.user).toHaveProperty('followerCount', 100);
      expect(response.body.user).toHaveProperty('postCount', 25);
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

  describe('GET /api/v1/users/:username/followers', () => {
    it('should return followers list', async () => {
      const mockUser = { id: 'user-123' };
      const mockFollowers = [
        {
          id: 'follower-1',
          username: 'bob',
          display_name: 'Bob',
          profile_picture_url: null,
          created_at: new Date('2024-06-01'),
        },
      ];

      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [mockUser], rowCount: 1 } as never) // User lookup
        .mockResolvedValueOnce({ rows: mockFollowers, rowCount: 1 } as never); // Followers query

      const response = await request(app).get('/api/v1/users/alice/followers');

      expect(response.status).toBe(200);
      expect(response.body.followers).toHaveLength(1);
      expect(response.body.followers[0]).toHaveProperty('username', 'bob');
      expect(response.body).toHaveProperty('nextCursor', null);
    });

    it('should return 404 for unknown user followers', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      const response = await request(app).get('/api/v1/users/unknown/followers');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'User not found' });
    });
  });

  // ============================================
  // Post Routes
  // ============================================

  describe('GET /api/v1/posts/:postId', () => {
    it('should return a post by ID', async () => {
      const mockPost = {
        id: 'post-123',
        user_id: 'user-456',
        username: 'alice',
        display_name: 'Alice',
        profile_picture_url: null,
        caption: 'My first post!',
        location: 'New York',
        like_count: 10,
        comment_count: 3,
        created_at: new Date('2024-06-01'),
      };

      const mockMedia = [
        {
          id: 'media-1',
          media_type: 'image',
          media_url: 'http://localhost:9000/images/test.jpg',
          thumbnail_url: 'http://localhost:9000/images/test-thumb.jpg',
          filter_applied: 'none',
          width: 1080,
          height: 1080,
          order_index: 0,
        },
      ];

      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [mockPost], rowCount: 1 } as never) // Post query
        .mockResolvedValueOnce({ rows: mockMedia, rowCount: 1 } as never); // Media query

      const response = await request(app).get('/api/v1/posts/post-123');

      expect(response.status).toBe(200);
      expect(response.body.post).toHaveProperty('id', 'post-123');
      expect(response.body.post).toHaveProperty('caption', 'My first post!');
      expect(response.body.post).toHaveProperty('location', 'New York');
      expect(response.body.post.media).toHaveLength(1);
      expect(response.body.post.media[0]).toHaveProperty('mediaType', 'image');
    });

    it('should return 404 for non-existent post', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      const response = await request(app).get('/api/v1/posts/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Post not found' });
    });

    it('should return 500 on database error when getting post', async () => {
      vi.mocked(query).mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/api/v1/posts/post-123');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });
  });

  describe('GET /api/v1/posts/filters/list', () => {
    it('should return available filters', async () => {
      const response = await request(app).get('/api/v1/posts/filters/list');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('filters');
      expect(response.body.filters).toContain('none');
      expect(response.body.filters).toContain('clarendon');
      expect(response.body.filters).toContain('moon');
    });
  });

  // ============================================
  // Comment Routes
  // ============================================

  describe('GET /api/v1/posts/:postId/comments', () => {
    it('should return comments for a post', async () => {
      const mockComments = [
        {
          id: 'comment-1',
          user_id: 'user-1',
          post_id: 'post-123',
          parent_comment_id: null,
          username: 'bob',
          display_name: 'Bob',
          profile_picture_url: null,
          content: 'Great post!',
          like_count: 2,
          created_at: new Date('2024-06-01'),
        },
      ];

      vi.mocked(query).mockResolvedValueOnce({ rows: mockComments, rowCount: 1 } as never);

      const response = await request(app).get('/api/v1/posts/post-123/comments');

      expect(response.status).toBe(200);
      expect(response.body.comments).toHaveLength(1);
      expect(response.body.comments[0]).toHaveProperty('content', 'Great post!');
      expect(response.body.comments[0]).toHaveProperty('username', 'bob');
      expect(response.body).toHaveProperty('nextCursor', null);
    });

    it('should return empty comments list when no comments', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      const response = await request(app).get('/api/v1/posts/post-123/comments');

      expect(response.status).toBe(200);
      expect(response.body.comments).toHaveLength(0);
      expect(response.body.nextCursor).toBeNull();
    });
  });

  // ============================================
  // Auth-protected Routes (unauthenticated tests)
  // ============================================

  describe('Auth-protected routes return 401 for unauthenticated requests', () => {
    it('POST /api/v1/posts should return 401', async () => {
      const response = await request(app).post('/api/v1/posts');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });

    it('DELETE /api/v1/posts/:postId should return 401', async () => {
      const response = await request(app).delete('/api/v1/posts/post-123');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });

    it('POST /api/v1/posts/:postId/like should return 401', async () => {
      const response = await request(app).post('/api/v1/posts/post-123/like');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });

    it('POST /api/v1/users/:userId/follow should return 401', async () => {
      const response = await request(app).post('/api/v1/users/user-123/follow');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });

    it('GET /api/v1/feed should return 401', async () => {
      const response = await request(app).get('/api/v1/feed');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });

    it('POST /api/v1/posts/:postId/comments should return 401', async () => {
      const response = await request(app)
        .post('/api/v1/posts/post-123/comments')
        .send({ content: 'test comment' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authentication required' });
    });
  });

  // ============================================
  // User Posts
  // ============================================

  describe('GET /api/v1/users/:username/posts', () => {
    it('should return posts for a public user', async () => {
      const mockUser = { id: 'user-123', is_private: false };
      const mockPosts = [
        {
          id: 'post-1',
          caption: 'Post one',
          like_count: 5,
          comment_count: 2,
          created_at: new Date('2024-06-01'),
          thumbnail: 'http://localhost:9000/images/thumb1.jpg',
          media_count: '1',
        },
        {
          id: 'post-2',
          caption: 'Post two',
          like_count: 10,
          comment_count: 0,
          created_at: new Date('2024-06-02'),
          thumbnail: 'http://localhost:9000/images/thumb2.jpg',
          media_count: '3',
        },
      ];

      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [mockUser], rowCount: 1 } as never) // User lookup
        .mockResolvedValueOnce({ rows: mockPosts, rowCount: 2 } as never); // Posts query

      const response = await request(app).get('/api/v1/users/alice/posts');

      expect(response.status).toBe(200);
      expect(response.body.posts).toHaveLength(2);
      expect(response.body.posts[0]).toHaveProperty('id', 'post-1');
      expect(response.body.posts[0]).toHaveProperty('likeCount', 5);
      expect(response.body.posts[0]).toHaveProperty('mediaCount', 1);
      expect(response.body.nextCursor).toBeNull();
    });

    it('should return 404 for non-existent user posts', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      const response = await request(app).get('/api/v1/users/nonexistent/posts');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'User not found' });
    });
  });

  // ============================================
  // Post Likes List
  // ============================================

  describe('GET /api/v1/posts/:postId/likes', () => {
    it('should return users who liked a post', async () => {
      const mockLikes = [
        {
          id: 'user-1',
          username: 'bob',
          display_name: 'Bob',
          profile_picture_url: null,
          created_at: new Date('2024-06-01'),
        },
      ];

      vi.mocked(query).mockResolvedValueOnce({ rows: mockLikes, rowCount: 1 } as never);

      const response = await request(app).get('/api/v1/posts/post-123/likes');

      expect(response.status).toBe(200);
      expect(response.body.likes).toHaveLength(1);
      expect(response.body.likes[0]).toHaveProperty('username', 'bob');
      expect(response.body.nextCursor).toBeNull();
    });

    it('should return empty list when no likes', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      const response = await request(app).get('/api/v1/posts/post-123/likes');

      expect(response.status).toBe(200);
      expect(response.body.likes).toHaveLength(0);
    });
  });

  // ============================================
  // Comment Replies
  // ============================================

  describe('GET /api/v1/comments/:commentId/replies', () => {
    it('should return replies for a comment', async () => {
      const mockReplies = [
        {
          id: 'reply-1',
          user_id: 'user-2',
          post_id: 'post-123',
          parent_comment_id: 'comment-1',
          username: 'charlie',
          display_name: 'Charlie',
          profile_picture_url: null,
          content: 'Thanks!',
          like_count: 0,
          created_at: new Date('2024-06-01'),
        },
      ];

      vi.mocked(query).mockResolvedValueOnce({ rows: mockReplies, rowCount: 1 } as never);

      const response = await request(app).get('/api/v1/comments/comment-1/replies');

      expect(response.status).toBe(200);
      expect(response.body.replies).toHaveLength(1);
      expect(response.body.replies[0]).toHaveProperty('content', 'Thanks!');
      expect(response.body.replies[0]).toHaveProperty('username', 'charlie');
    });
  });

  // ============================================
  // User Search
  // ============================================

  describe('GET /api/v1/users/search/users', () => {
    it('should return matching users', async () => {
      const mockUsers = [
        {
          id: 'user-1',
          username: 'alice',
          display_name: 'Alice',
          profile_picture_url: null,
        },
      ];

      vi.mocked(query).mockResolvedValueOnce({ rows: mockUsers, rowCount: 1 } as never);

      const response = await request(app).get('/api/v1/users/search/users?q=ali');

      expect(response.status).toBe(200);
      expect(response.body.users).toHaveLength(1);
      expect(response.body.users[0]).toHaveProperty('username', 'alice');
    });

    it('should return empty list for short query', async () => {
      const response = await request(app).get('/api/v1/users/search/users?q=a');

      expect(response.status).toBe(200);
      expect(response.body.users).toHaveLength(0);
    });
  });

  // ============================================
  // User Following list
  // ============================================

  describe('GET /api/v1/users/:username/following', () => {
    it('should return following list', async () => {
      const mockUser = { id: 'user-123' };
      const mockFollowing = [
        {
          id: 'following-1',
          username: 'diana',
          display_name: 'Diana',
          profile_picture_url: null,
          created_at: new Date('2024-05-01'),
        },
      ];

      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [mockUser], rowCount: 1 } as never)
        .mockResolvedValueOnce({ rows: mockFollowing, rowCount: 1 } as never);

      const response = await request(app).get('/api/v1/users/alice/following');

      expect(response.status).toBe(200);
      expect(response.body.following).toHaveLength(1);
      expect(response.body.following[0]).toHaveProperty('username', 'diana');
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
