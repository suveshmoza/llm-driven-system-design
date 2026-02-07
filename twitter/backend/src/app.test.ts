/**
 * Unit tests for the Twitter backend API.
 * Uses vitest with mocked shared modules (db, redis, kafka, fanout).
 * @module app.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ============================================================================
// Mock all shared modules BEFORE importing app
// ============================================================================

// Mock database pool
vi.mock('./db/pool.js', () => ({
  default: {
    query: vi.fn(),
    totalCount: 5,
    idleCount: 3,
    waitingCount: 0,
    end: vi.fn(),
  },
}));

// Mock Redis
vi.mock('./db/redis.js', () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue('PONG'),
    info: vi.fn().mockResolvedValue('redis_version:7.0.0\r\n'),
    lrange: vi.fn().mockResolvedValue([]),
    lpush: vi.fn().mockResolvedValue(1),
    ltrim: vi.fn().mockResolvedValue('OK'),
    sadd: vi.fn().mockResolvedValue(1),
    srem: vi.fn().mockResolvedValue(1),
    scan: vi.fn().mockResolvedValue(['0', []]),
    quit: vi.fn().mockResolvedValue('OK'),
    pipeline: vi.fn().mockReturnValue({
      lpush: vi.fn().mockReturnThis(),
      ltrim: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      lrem: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    }),
  },
}));

// Mock logger
vi.mock('./shared/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
  requestLoggerMiddleware: vi.fn().mockImplementation(
    (req: { requestId?: string }, _res: unknown, next: () => void) => {
      req.requestId = 'test-request-id';
      next();
    },
  ),
  createRequestLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock metrics
vi.mock('./shared/metrics.js', () => ({
  metricsMiddleware: vi.fn().mockImplementation(
    (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getMetrics: vi.fn().mockResolvedValue('# metrics'),
  getMetricsContentType: vi.fn().mockReturnValue('text/plain'),
  tweetCounter: { inc: vi.fn() },
  tweetCreationDuration: { observe: vi.fn() },
  timelineLatency: { observe: vi.fn() },
  timelineRequestsTotal: { inc: vi.fn() },
  fanoutQueueDepth: { set: vi.fn() },
  fanoutOperationsTotal: { inc: vi.fn() },
  fanoutDuration: { observe: vi.fn() },
  fanoutFollowersTotal: { inc: vi.fn() },
  circuitBreakerState: { set: vi.fn() },
  circuitBreakerTrips: { inc: vi.fn() },
  redisConnectionStatus: { set: vi.fn() },
  redisOperationDuration: { observe: vi.fn() },
  dbConnectionPoolSize: { set: vi.fn() },
  dbQueryDuration: { observe: vi.fn() },
  httpRequestDuration: { observe: vi.fn() },
  httpRequestsTotal: { inc: vi.fn() },
  idempotencyHits: { inc: vi.fn() },
  idempotencyMisses: { inc: vi.fn() },
  getFollowerCountBucket: vi.fn().mockReturnValue('<100'),
}));

// Mock circuit breaker
vi.mock('./shared/circuitBreaker.js', () => ({
  createCircuitBreaker: vi.fn().mockReturnValue({
    fire: vi.fn().mockResolvedValue({}),
    fallback: vi.fn(),
  }),
  getCircuitBreaker: vi.fn(),
  getAllCircuitBreakerStatus: vi.fn().mockReturnValue({}),
  withCircuitBreaker: vi.fn(),
  REDIS_CIRCUIT_OPTIONS: {},
  FANOUT_CIRCUIT_OPTIONS: {},
  DATABASE_CIRCUIT_OPTIONS: {},
  default: {
    createCircuitBreaker: vi.fn(),
    getCircuitBreaker: vi.fn(),
    getAllCircuitBreakerStatus: vi.fn().mockReturnValue({}),
  },
}));

// Mock retry - pass through immediately
vi.mock('./shared/retry.js', () => ({
  withRetry: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
  retryable: vi.fn(),
  isRetryableError: vi.fn(),
  calculateDelay: vi.fn(),
  sleep: vi.fn(),
  DATABASE_RETRY_CONFIG: {},
  REDIS_RETRY_CONFIG: {},
  EXTERNAL_API_RETRY_CONFIG: {},
  FANOUT_RETRY_CONFIG: {},
  default: {
    withRetry: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
  },
}));

// Mock retention
vi.mock('./shared/retention.js', () => ({
  validateRetentionConfig: vi.fn().mockReturnValue([]),
  logRetentionConfig: vi.fn(),
  RETENTION_POLICIES: {
    tweets: { softDeleteRetentionDays: 30, autoDeleteEnabled: false, archiveAfterDays: 0 },
    timelineCache: { ttlSeconds: 604800, maxSize: 800 },
    trendBuckets: { ttlSeconds: 7200, bucketSizeSeconds: 60, windowBuckets: 60 },
    sessions: { ttlSeconds: 604800 },
    idempotencyKeys: { ttlSeconds: 86400 },
    hashtagActivity: { retentionDays: 90, aggregateAfterDays: 7 },
    activityLogs: { retentionDays: 365 },
  },
  ARCHIVAL_CONFIG: { enabled: false },
  CLEANUP_CONFIG: {},
  CLEANUP_QUERIES: {},
  redisCleanup: {},
  default: {},
}));

// Mock Kafka
vi.mock('./shared/kafka.js', () => ({
  publishTweet: vi.fn().mockResolvedValue({ success: true }),
  publishLike: vi.fn().mockResolvedValue({ success: true }),
  connectProducer: vi.fn().mockResolvedValue(true),
  disconnectProducer: vi.fn().mockResolvedValue(undefined),
  consumeTweets: vi.fn(),
  consumeMultiple: vi.fn(),
  isKafkaHealthy: vi.fn().mockResolvedValue(true),
  TOPICS: { TWEETS: 'tweets', LIKES: 'likes' },
  default: {
    publishTweet: vi.fn().mockResolvedValue({ success: true }),
    publishLike: vi.fn().mockResolvedValue({ success: true }),
  },
}));

// Mock idempotency middleware - pass through
vi.mock('./shared/idempotency.js', () => ({
  tweetIdempotencyMiddleware: vi.fn().mockReturnValue(
    (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  createIdempotencyMiddleware: vi.fn().mockReturnValue(
    (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  generateIdempotencyKey: vi.fn().mockReturnValue('test-key'),
  default: {},
}));

// Mock fanout service
vi.mock('./services/fanout.js', () => ({
  fanoutTweet: vi.fn().mockResolvedValue({ success: true }),
  getFollowedCelebrities: vi.fn().mockResolvedValue([]),
  removeTweetFromTimelines: vi.fn().mockResolvedValue({ success: true }),
  default: {
    fanoutTweet: vi.fn().mockResolvedValue({ success: true }),
    getFollowedCelebrities: vi.fn().mockResolvedValue([]),
  },
}));

// Mock connect-redis
vi.mock('connect-redis', () => {
  const { EventEmitter } = require('events');
  return {
    default: vi.fn().mockImplementation(() => {
      const store = Object.assign(new EventEmitter(), {
        get: vi.fn((_sid: string, cb: (err: null, session: null) => void) => cb(null, null)),
        set: vi.fn((_sid: string, _session: unknown, cb: (err: null) => void) => cb(null)),
        destroy: vi.fn((_sid: string, cb: (err: null) => void) => cb(null)),
        touch: vi.fn((_sid: string, _session: unknown, cb: (err: null) => void) => cb(null)),
      });
      return store;
    }),
  };
});

// Mock bcrypt
vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashed_password'),
    compare: vi.fn().mockResolvedValue(true),
  },
}));

// ============================================================================
// Import after mocking
// ============================================================================
import { app } from './app.js';
import pool from './db/pool.js';

// ============================================================================
// Tests
// ============================================================================

describe('Twitter Backend API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Health Check Endpoints
  // ==========================================================================

  describe('GET /live', () => {
    it('should return alive status', async () => {
      const response = await request(app).get('/live');

      expect(response.status).toBe(200);
      expect(response.text).toBe('alive');
    });
  });

  describe('GET /ready', () => {
    it('should return ready when services are healthy', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] } as never);

      const response = await request(app).get('/ready');

      expect(response.status).toBe(200);
      expect(response.text).toBe('ready');
    });

    it('should return 503 when database is down', async () => {
      vi.mocked(pool.query).mockRejectedValueOnce(new Error('Connection refused'));

      const response = await request(app).get('/ready');

      expect(response.status).toBe(503);
      expect(response.text).toBe('not ready');
    });
  });

  // ==========================================================================
  // 404 Handler
  // ==========================================================================

  describe('404 Handler', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app).get('/api/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'Not found',
        path: '/api/nonexistent',
      });
    });
  });

  // ==========================================================================
  // Auth Routes
  // ==========================================================================

  describe('POST /api/auth/register', () => {
    it('should register a new user', async () => {
      const mockUser = {
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        display_name: 'Test User',
        bio: null,
        avatar_url: null,
        follower_count: 0,
        following_count: 0,
        tweet_count: 0,
        created_at: new Date('2024-01-01'),
      };

      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [] } as never) // no existing user
        .mockResolvedValueOnce({ rows: [mockUser] } as never); // insert user

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'password123',
          displayName: 'Test User',
        });

      expect(response.status).toBe(201);
      expect(response.body.user).toBeDefined();
      expect(response.body.user.username).toBe('testuser');
      expect(response.body.user.email).toBe('test@example.com');
    });

    it('should return 400 when required fields are missing', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ username: 'test' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Username, email, and password are required');
    });

    it('should return 400 when username is too short', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ username: 'ab', email: 'test@example.com', password: 'password123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Username must be between 3 and 50 characters');
    });

    it('should return 400 when password is too short', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ username: 'testuser', email: 'test@example.com', password: '12345' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Password must be at least 6 characters');
    });

    it('should return 409 when username or email already exists', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] } as never);

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'existing',
          email: 'existing@example.com',
          password: 'password123',
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Username or email already exists');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should return 400 when credentials are missing', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Username and password are required');
    });

    it('should return 401 for non-existent user', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);

      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'nonexistent', password: 'password123' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid username or password');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return 401 when not authenticated', async () => {
      const response = await request(app).get('/api/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Not authenticated');
    });
  });

  // ==========================================================================
  // Tweet Routes
  // ==========================================================================

  describe('GET /api/tweets/:id', () => {
    it('should return a tweet by id', async () => {
      const mockTweet = {
        id: 1,
        content: 'Hello world!',
        media_urls: [],
        hashtags: [],
        mentions: [],
        reply_to: null,
        quote_of: null,
        like_count: 5,
        retweet_count: 2,
        reply_count: 1,
        created_at: new Date('2024-01-01'),
        author_id: 10,
        username: 'alice',
        display_name: 'Alice',
        avatar_url: null,
      };

      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [mockTweet] } as never);

      const response = await request(app).get('/api/tweets/1');

      expect(response.status).toBe(200);
      expect(response.body.tweet).toBeDefined();
      expect(response.body.tweet.content).toBe('Hello world!');
      expect(response.body.tweet.id).toBe('1');
      expect(response.body.tweet.author.username).toBe('alice');
      expect(response.body.tweet.likeCount).toBe(5);
    });

    it('should return 404 for non-existent tweet', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);

      const response = await request(app).get('/api/tweets/999');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Tweet not found');
    });
  });

  describe('POST /api/tweets', () => {
    it('should return 401 when not authenticated', async () => {
      const response = await request(app)
        .post('/api/tweets')
        .send({ content: 'Hello!' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required');
    });
  });

  describe('DELETE /api/tweets/:id', () => {
    it('should return 401 when not authenticated', async () => {
      const response = await request(app).delete('/api/tweets/1');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required');
    });
  });

  // ==========================================================================
  // Tweet Engagement Routes
  // ==========================================================================

  describe('POST /api/tweets/:id/like', () => {
    it('should return 401 when not authenticated', async () => {
      const response = await request(app).post('/api/tweets/1/like');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required');
    });
  });

  describe('POST /api/tweets/:id/retweet', () => {
    it('should return 401 when not authenticated', async () => {
      const response = await request(app).post('/api/tweets/1/retweet');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required');
    });
  });

  // ==========================================================================
  // User Routes
  // ==========================================================================

  describe('GET /api/users/:username', () => {
    it('should return user profile', async () => {
      const mockUser = {
        id: 1,
        username: 'alice',
        display_name: 'Alice Wonderland',
        bio: 'Down the rabbit hole',
        avatar_url: null,
        follower_count: 100,
        following_count: 50,
        tweet_count: 200,
        is_celebrity: false,
        created_at: new Date('2024-01-01'),
      };

      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [mockUser] } as never);

      const response = await request(app).get('/api/users/alice');

      expect(response.status).toBe(200);
      expect(response.body.user).toBeDefined();
      expect(response.body.user.username).toBe('alice');
      expect(response.body.user.displayName).toBe('Alice Wonderland');
      expect(response.body.user.followerCount).toBe(100);
      expect(response.body.user.isCelebrity).toBe(false);
    });

    it('should return 404 for non-existent user', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);

      const response = await request(app).get('/api/users/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found');
    });
  });

  describe('GET /api/users (search)', () => {
    it('should return search results', async () => {
      const mockUsers = [
        {
          id: 1,
          username: 'alice',
          display_name: 'Alice',
          bio: 'Hello',
          avatar_url: null,
          follower_count: 100,
          following_count: 50,
        },
      ];

      vi.mocked(pool.query).mockResolvedValueOnce({ rows: mockUsers } as never);

      const response = await request(app).get('/api/users?q=alice');

      expect(response.status).toBe(200);
      expect(response.body.users).toHaveLength(1);
      expect(response.body.users[0].username).toBe('alice');
    });

    it('should return 400 when search query is missing', async () => {
      const response = await request(app).get('/api/users');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Search query is required');
    });
  });

  describe('POST /api/users/:id/follow', () => {
    it('should return 401 when not authenticated', async () => {
      const response = await request(app).post('/api/users/2/follow');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required');
    });
  });

  describe('DELETE /api/users/:id/follow', () => {
    it('should return 401 when not authenticated', async () => {
      const response = await request(app).delete('/api/users/2/follow');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required');
    });
  });

  // ==========================================================================
  // Timeline Routes
  // ==========================================================================

  describe('GET /api/timeline/home', () => {
    it('should return 401 when not authenticated', async () => {
      const response = await request(app).get('/api/timeline/home');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required');
    });
  });

  describe('GET /api/timeline/user/:username', () => {
    it('should return user timeline', async () => {
      const mockTweets = [
        {
          id: 1,
          content: 'My first tweet',
          media_urls: [],
          hashtags: ['hello'],
          like_count: 3,
          retweet_count: 1,
          reply_count: 0,
          created_at: new Date('2024-01-01'),
          author_id: 10,
          username: 'alice',
          display_name: 'Alice',
          avatar_url: null,
          retweet_of: null,
        },
      ];

      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ id: 10 }] } as never) // user lookup
        .mockResolvedValueOnce({ rows: mockTweets } as never); // tweets query

      const response = await request(app).get('/api/timeline/user/alice');

      expect(response.status).toBe(200);
      expect(response.body.tweets).toHaveLength(1);
      expect(response.body.tweets[0].content).toBe('My first tweet');
      expect(response.body.tweets[0].author.username).toBe('alice');
    });

    it('should return 404 for non-existent user', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);

      const response = await request(app).get('/api/timeline/user/nobody');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found');
    });
  });

  describe('GET /api/timeline/explore', () => {
    it('should return explore timeline', async () => {
      const mockTweets = [
        {
          id: 1,
          content: 'Popular tweet',
          media_urls: [],
          hashtags: [],
          like_count: 100,
          retweet_count: 50,
          reply_count: 20,
          created_at: new Date('2024-01-01'),
          author_id: 5,
          username: 'popular_user',
          display_name: 'Popular User',
          avatar_url: null,
          retweet_of: null,
        },
      ];

      vi.mocked(pool.query).mockResolvedValueOnce({ rows: mockTweets } as never);

      const response = await request(app).get('/api/timeline/explore');

      expect(response.status).toBe(200);
      expect(response.body.tweets).toHaveLength(1);
      expect(response.body.tweets[0].content).toBe('Popular tweet');
      expect(response.body.tweets[0].likeCount).toBe(100);
    });
  });

  describe('GET /api/timeline/hashtag/:tag', () => {
    it('should return tweets for a hashtag', async () => {
      const mockTweets = [
        {
          id: 1,
          content: 'Tweet with #typescript',
          media_urls: [],
          hashtags: ['typescript'],
          like_count: 10,
          retweet_count: 5,
          reply_count: 2,
          created_at: new Date('2024-01-01'),
          author_id: 3,
          username: 'dev',
          display_name: 'Developer',
          avatar_url: null,
          retweet_of: null,
        },
      ];

      vi.mocked(pool.query).mockResolvedValueOnce({ rows: mockTweets } as never);

      const response = await request(app).get('/api/timeline/hashtag/typescript');

      expect(response.status).toBe(200);
      expect(response.body.tweets).toHaveLength(1);
      expect(response.body.tweets[0].hashtags).toContain('typescript');
    });

    it('should return empty array for unused hashtag', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);

      const response = await request(app).get('/api/timeline/hashtag/obscure');

      expect(response.status).toBe(200);
      expect(response.body.tweets).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Trends Routes
  // ==========================================================================

  describe('GET /api/trends', () => {
    it('should return empty trends when no data', async () => {
      const response = await request(app).get('/api/trends');

      expect(response.status).toBe(200);
      expect(response.body.trends).toEqual([]);
    });
  });

  // ==========================================================================
  // Tweet Reply Listing
  // ==========================================================================

  describe('GET /api/tweets/:id/replies', () => {
    it('should return replies for a tweet', async () => {
      const mockReplies = [
        {
          id: 2,
          content: 'Great tweet!',
          media_urls: [],
          hashtags: [],
          like_count: 1,
          retweet_count: 0,
          reply_count: 0,
          created_at: new Date('2024-01-02'),
          author_id: 20,
          username: 'bob',
          display_name: 'Bob',
          avatar_url: null,
        },
      ];

      vi.mocked(pool.query).mockResolvedValueOnce({ rows: mockReplies } as never);

      const response = await request(app).get('/api/tweets/1/replies');

      expect(response.status).toBe(200);
      expect(response.body.tweets).toHaveLength(1);
      expect(response.body.tweets[0].content).toBe('Great tweet!');
      expect(response.body.tweets[0].author.username).toBe('bob');
    });

    it('should return empty array when no replies', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);

      const response = await request(app).get('/api/tweets/999/replies');

      expect(response.status).toBe(200);
      expect(response.body.tweets).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Followers / Following Lists
  // ==========================================================================

  describe('GET /api/users/:id/followers', () => {
    it('should return followers list', async () => {
      const mockFollowers = [
        {
          id: 2,
          username: 'bob',
          display_name: 'Bob Builder',
          bio: 'Can we fix it?',
          avatar_url: null,
          follower_count: 50,
          following_count: 30,
        },
      ];

      vi.mocked(pool.query).mockResolvedValueOnce({ rows: mockFollowers } as never);

      const response = await request(app).get('/api/users/1/followers');

      expect(response.status).toBe(200);
      expect(response.body.users).toHaveLength(1);
      expect(response.body.users[0].username).toBe('bob');
      expect(response.body.users[0].followerCount).toBe(50);
    });
  });

  describe('GET /api/users/:id/following', () => {
    it('should return following list', async () => {
      const mockFollowing = [
        {
          id: 3,
          username: 'charlie',
          display_name: 'Charlie',
          bio: null,
          avatar_url: null,
          follower_count: 200,
          following_count: 100,
        },
      ];

      vi.mocked(pool.query).mockResolvedValueOnce({ rows: mockFollowing } as never);

      const response = await request(app).get('/api/users/1/following');

      expect(response.status).toBe(200);
      expect(response.body.users).toHaveLength(1);
      expect(response.body.users[0].username).toBe('charlie');
    });
  });
});
