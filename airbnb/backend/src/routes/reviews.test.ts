import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// Mock db module
vi.mock('../db.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
  transaction: vi.fn(),
  default: {
    query: vi.fn(),
    connect: vi.fn(),
    on: vi.fn(),
  },
}));

// Mock redis module
vi.mock('../redis.js', () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
    setEx: vi.fn(),
    del: vi.fn(),
    ping: vi.fn(),
    isOpen: true,
    connect: vi.fn(),
    on: vi.fn(),
    keys: vi.fn().mockResolvedValue([]),
    info: vi.fn().mockResolvedValue(''),
  },
  connectRedis: vi.fn(),
}));

// Mock auth middleware
vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn((req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = {
      id: 2,
      email: 'guest@example.com',
      name: 'Guest User',
      is_host: false,
      is_verified: false,
      role: 'user' as const,
    };
    next();
  }),
  requireHost: vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    next();
  }),
  optionalAuth: vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    next();
  }),
}));

// Mock shared/logger module
vi.mock('../shared/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  requestLogger: vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => next()),
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

import { query } from '../db.js';
import reviewsRoutes from './reviews.js';

const mockQuery = vi.mocked(query);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/reviews', reviewsRoutes);
  return app;
}

describe('Reviews Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('POST /api/reviews', () => {
    it('should create a review for a completed booking', async () => {
      // Get booking
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 10, guest_id: 2, host_id: 5, listing_id: 1, status: 'completed' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      // Check existing review
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      // Insert review
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 1,
          booking_id: 10,
          author_id: 2,
          author_type: 'guest',
          rating: 5,
          content: 'Amazing place!',
        }],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .post('/api/reviews')
        .set('Cookie', 'session=test-session-id')
        .send({
          booking_id: 10,
          rating: 5,
          cleanliness_rating: 5,
          communication_rating: 5,
          location_rating: 4,
          value_rating: 5,
          content: 'Amazing place!',
        });

      expect(res.status).toBe(201);
      expect(res.body.review).toBeDefined();
      expect(res.body.review.rating).toBe(5);
      expect(res.body.review.author_type).toBe('guest');
    });

    it('should return 400 when booking_id or rating is missing', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .set('Cookie', 'session=test-session-id')
        .send({ content: 'No rating provided' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('booking_id and rating are required');
    });

    it('should return 400 when rating is out of range', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .set('Cookie', 'session=test-session-id')
        .send({ booking_id: 10, rating: 6 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Rating must be between 1 and 5');
    });

    it('should return 404 when completed booking is not found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .post('/api/reviews')
        .set('Cookie', 'session=test-session-id')
        .send({ booking_id: 999, rating: 4 });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Completed booking not found');
    });

    it('should return 400 when user has already reviewed this booking', async () => {
      // Get booking
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 10, guest_id: 2, host_id: 5, status: 'completed' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      // Existing review found
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1 }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .post('/api/reviews')
        .set('Cookie', 'session=test-session-id')
        .send({ booking_id: 10, rating: 4 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('You have already reviewed this booking');
    });
  });

  describe('GET /api/reviews/listing/:listingId', () => {
    it('should return reviews and stats for a listing', async () => {
      // Reviews query
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 1, rating: 5, content: 'Great!', author_name: 'Alice', author_avatar: null },
          { id: 2, rating: 4, content: 'Nice', author_name: 'Bob', author_avatar: null },
        ],
        rowCount: 2,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      // Stats query
      mockQuery.mockResolvedValueOnce({
        rows: [{
          total: '2',
          avg_rating: '4.50',
          avg_cleanliness: '4.00',
          avg_communication: '5.00',
          avg_location: '4.50',
          avg_value: '4.00',
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app).get('/api/reviews/listing/1');

      expect(res.status).toBe(200);
      expect(res.body.reviews).toHaveLength(2);
      expect(res.body.stats).toBeDefined();
      expect(res.body.stats.avg_rating).toBe('4.50');
      expect(res.body.stats.total).toBe('2');
    });
  });

  describe('GET /api/reviews/user/:userId', () => {
    it('should return reviews about a user', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 1, rating: 5, content: 'Great guest!', author_name: 'Host', listing_title: 'Cabin' },
        ],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app).get('/api/reviews/user/2');

      expect(res.status).toBe(200);
      expect(res.body.reviews).toHaveLength(1);
      expect(res.body.reviews[0].listing_title).toBe('Cabin');
    });

    it('should filter reviews by type (as_host)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app).get('/api/reviews/user/5?type=as_host');

      expect(res.status).toBe(200);
      expect(res.body.reviews).toHaveLength(0);
      // Verify the query included the as_host filter
      const queryCall = mockQuery.mock.calls[0];
      expect(queryCall[0]).toContain('guest');
    });
  });
});
