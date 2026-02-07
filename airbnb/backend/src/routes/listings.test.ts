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
      id: 1,
      email: 'host@example.com',
      name: 'Host User',
      is_host: true,
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

// Mock shared/cache module
vi.mock('../shared/cache.js', () => ({
  getCachedListing: vi.fn((_id: unknown, fetchFn: () => Promise<unknown>) => fetchFn()),
  invalidateListingCache: vi.fn().mockResolvedValue(undefined),
  getCachedAvailability: vi.fn((_id: unknown, _start: unknown, _end: unknown, fetchFn: () => Promise<unknown>) => fetchFn()),
  invalidateAvailabilityCache: vi.fn().mockResolvedValue(undefined),
  getCachedSearchResults: vi.fn(),
  updateCacheMetrics: vi.fn(),
  CACHE_TTL: { LISTING: 900, AVAILABILITY: 60, SEARCH: 300 },
}));

// Mock shared/audit module
vi.mock('../shared/audit.js', () => ({
  auditListing: vi.fn().mockResolvedValue({}),
  auditBooking: vi.fn().mockResolvedValue({}),
  AUDIT_EVENTS: {
    LISTING_CREATED: 'listing.created',
    LISTING_UPDATED: 'listing.updated',
    LISTING_DELETED: 'listing.deleted',
  },
  OUTCOMES: { SUCCESS: 'success', FAILURE: 'failure' },
}));

// Mock shared/queue module
vi.mock('../shared/queue.js', () => ({
  publishAvailabilityChanged: vi.fn().mockResolvedValue('event-id'),
  publishBookingCreated: vi.fn(),
  publishBookingConfirmed: vi.fn(),
  publishBookingCancelled: vi.fn(),
  publishHostAlert: vi.fn(),
  initQueue: vi.fn(),
  getQueueStats: vi.fn().mockResolvedValue({}),
  closeQueue: vi.fn(),
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

// Mock shared/metrics module
vi.mock('../shared/metrics.js', () => ({
  metrics: {
    availabilityCheckLatency: { observe: vi.fn() },
    availabilityChecksTotal: { inc: vi.fn() },
    bookingLatency: { observe: vi.fn() },
    bookingsTotal: { inc: vi.fn() },
    bookingRevenue: { inc: vi.fn() },
    bookingNights: { inc: vi.fn() },
    searchLatency: { observe: vi.fn() },
    searchesTotal: { inc: vi.fn() },
  },
  metricsMiddleware: vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => next()),
  getMetrics: vi.fn(),
  getMetricsContentType: vi.fn(),
}));

import { query, transaction } from '../db.js';
import listingsRoutes from './listings.js';

const mockQuery = vi.mocked(query);
const mockTransaction = vi.mocked(transaction);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/listings', listingsRoutes);
  return app;
}

describe('Listings Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('GET /api/listings', () => {
    it('should return a list of active listings', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            title: 'Cozy Cabin',
            city: 'Denver',
            price_per_night: 120,
            host_name: 'Host User',
            primary_photo: '/uploads/listings/photo1.jpg',
          },
          {
            id: 2,
            title: 'Beach House',
            city: 'Miami',
            price_per_night: 250,
            host_name: 'Another Host',
            primary_photo: null,
          },
        ],
        rowCount: 2,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app).get('/api/listings');

      expect(res.status).toBe(200);
      expect(res.body.listings).toHaveLength(2);
      expect(res.body.listings[0].title).toBe('Cozy Cabin');
      expect(res.body.listings[1].title).toBe('Beach House');
    });

    it('should filter listings by host_id', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, title: 'My Listing', host_id: 5 }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app).get('/api/listings?host_id=5');

      expect(res.status).toBe(200);
      expect(res.body.listings).toHaveLength(1);
      // Verify the query was called with host_id param
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryCall = mockQuery.mock.calls[0];
      expect(queryCall[1]).toContain('5');
    });

    it('should return 500 on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database connection failed'));

      const res = await request(app).get('/api/listings');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch listings');
    });
  });

  describe('GET /api/listings/:id', () => {
    it('should return a single listing with photos and reviews', async () => {
      // getCachedListing calls the fetchFn which does 3 queries
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            title: 'Cozy Cabin',
            host_name: 'Host User',
            price_per_night: 120,
            bedrooms: 2,
            max_guests: 4,
          }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 10, url: '/uploads/listings/photo1.jpg', display_order: 0 }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 20, rating: 5, content: 'Great place!', author_name: 'Guest' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        });

      const res = await request(app).get('/api/listings/1');

      expect(res.status).toBe(200);
      expect(res.body.listing).toBeDefined();
      expect(res.body.listing.title).toBe('Cozy Cabin');
      expect(res.body.listing.photos).toHaveLength(1);
      expect(res.body.listing.reviews).toHaveLength(1);
    });

    it('should return 404 if listing does not exist', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app).get('/api/listings/999');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Listing not found');
    });
  });

  describe('POST /api/listings', () => {
    it('should create a listing successfully', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 5,
          host_id: 1,
          title: 'New Listing',
          price_per_night: 150,
          city: 'Portland',
          is_active: true,
        }],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .post('/api/listings')
        .set('Cookie', 'session=test-session-id')
        .send({
          title: 'New Listing',
          description: 'A great place to stay',
          latitude: 45.5231,
          longitude: -122.6765,
          city: 'Portland',
          state: 'OR',
          country: 'US',
          property_type: 'apartment',
          room_type: 'entire_place',
          max_guests: 4,
          bedrooms: 2,
          beds: 2,
          bathrooms: 1,
          price_per_night: 150,
        });

      expect(res.status).toBe(201);
      expect(res.body.listing).toBeDefined();
      expect(res.body.listing.title).toBe('New Listing');
      expect(res.body.listing.id).toBe(5);
    });

    it('should return 500 when database insert fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Insert failed'));

      const res = await request(app)
        .post('/api/listings')
        .set('Cookie', 'session=test-session-id')
        .send({
          title: 'New Listing',
          description: 'test',
          latitude: 45.0,
          longitude: -122.0,
          price_per_night: 100,
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to create listing');
    });
  });

  describe('DELETE /api/listings/:id', () => {
    it('should delete a listing owned by the user', async () => {
      // Owner check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, host_id: 1, title: 'To Delete', price_per_night: 100 }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      // Delete query
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'DELETE',
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .delete('/api/listings/1')
        .set('Cookie', 'session=test-session-id');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Listing deleted');
    });

    it('should return 403 when trying to delete listing not owned by user', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .delete('/api/listings/99')
        .set('Cookie', 'session=test-session-id');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Not authorized to delete this listing');
    });
  });

  describe('GET /api/listings/:id/availability', () => {
    it('should return availability blocks for a listing', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 1, listing_id: 1, start_date: '2025-01-01', end_date: '2025-01-10', status: 'available' },
          { id: 2, listing_id: 1, start_date: '2025-01-15', end_date: '2025-01-20', status: 'blocked' },
        ],
        rowCount: 2,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app).get('/api/listings/1/availability?start_date=2025-01-01&end_date=2025-03-31');

      expect(res.status).toBe(200);
      expect(res.body.availability).toHaveLength(2);
    });
  });

  describe('PUT /api/listings/:id/availability', () => {
    it('should update availability for a listing owned by user', async () => {
      // Owner check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1 }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      // Transaction
      mockTransaction.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: vi.fn()
            .mockResolvedValueOnce({ rows: [] }) // overlaps check
            .mockResolvedValueOnce({ rows: [] }), // insert new block
        };
        return callback(mockClient as never);
      });

      const res = await request(app)
        .put('/api/listings/1/availability')
        .set('Cookie', 'session=test-session-id')
        .send({
          start_date: '2025-02-01',
          end_date: '2025-02-10',
          status: 'blocked',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Availability updated');
    });

    it('should return 403 for non-owner updating availability', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .put('/api/listings/99/availability')
        .set('Cookie', 'session=test-session-id')
        .send({
          start_date: '2025-02-01',
          end_date: '2025-02-10',
          status: 'blocked',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Not authorized');
    });
  });
});
