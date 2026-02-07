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

// Mock shared/cache module
vi.mock('../shared/cache.js', () => ({
  getCachedListing: vi.fn(),
  invalidateListingCache: vi.fn().mockResolvedValue(undefined),
  getCachedAvailability: vi.fn(),
  invalidateAvailabilityCache: vi.fn().mockResolvedValue(undefined),
  getCachedSearchResults: vi.fn(),
  updateCacheMetrics: vi.fn(),
  CACHE_TTL: { LISTING: 900, AVAILABILITY: 60, SEARCH: 300 },
}));

// Mock shared/audit module
vi.mock('../shared/audit.js', () => ({
  auditBooking: vi.fn().mockResolvedValue({}),
  auditListing: vi.fn().mockResolvedValue({}),
  AUDIT_EVENTS: {
    BOOKING_CREATED: 'booking.created',
    BOOKING_CONFIRMED: 'booking.confirmed',
    BOOKING_DECLINED: 'booking.declined',
    BOOKING_CANCELLED: 'booking.cancelled',
    BOOKING_COMPLETED: 'booking.completed',
  },
  OUTCOMES: { SUCCESS: 'success', FAILURE: 'failure' },
}));

// Mock shared/queue module
vi.mock('../shared/queue.js', () => ({
  publishBookingCreated: vi.fn().mockResolvedValue('event-id'),
  publishBookingConfirmed: vi.fn().mockResolvedValue('event-id'),
  publishBookingCancelled: vi.fn().mockResolvedValue('event-id'),
  publishHostAlert: vi.fn().mockResolvedValue('event-id'),
  publishAvailabilityChanged: vi.fn(),
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
import bookingsRoutes from './bookings.js';

const mockQuery = vi.mocked(query);
const mockTransaction = vi.mocked(transaction);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/bookings', bookingsRoutes);
  return app;
}

describe('Bookings Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('GET /api/bookings/check-availability', () => {
    it('should return available with pricing when dates are open', async () => {
      // Listing query
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 1,
          host_id: 5,
          title: 'Test Listing',
          price_per_night: '100',
          cleaning_fee: '50',
          service_fee_percent: '10',
          minimum_nights: 1,
          maximum_nights: 30,
          max_guests: 4,
          instant_book: true,
          is_active: true,
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      // Conflict query
      mockQuery.mockResolvedValueOnce({
        rows: [{ conflicts: '0' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .get('/api/bookings/check-availability?listing_id=1&check_in=2025-03-01&check_out=2025-03-05');

      expect(res.status).toBe(200);
      expect(res.body.available).toBe(true);
      expect(res.body.pricing).toBeDefined();
      expect(res.body.pricing.nights).toBe(4);
      expect(res.body.pricing.pricePerNight).toBe(100);
      expect(res.body.pricing.subtotal).toBe(400);
      expect(res.body.pricing.cleaningFee).toBe(50);
      expect(res.body.instant_book).toBe(true);
    });

    it('should return unavailable when dates conflict', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 1,
          price_per_night: '100',
          cleaning_fee: '50',
          minimum_nights: 1,
          maximum_nights: 30,
          max_guests: 4,
          instant_book: true,
          is_active: true,
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{ conflicts: '1' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .get('/api/bookings/check-availability?listing_id=1&check_in=2025-03-01&check_out=2025-03-05');

      expect(res.status).toBe(200);
      expect(res.body.available).toBe(false);
      expect(res.body.pricing).toBeNull();
    });

    it('should return 400 when required params are missing', async () => {
      const res = await request(app)
        .get('/api/bookings/check-availability?listing_id=1');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('listing_id, check_in, and check_out are required');
    });

    it('should return 404 when listing does not exist', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .get('/api/bookings/check-availability?listing_id=999&check_in=2025-03-01&check_out=2025-03-05');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Listing not found');
    });
  });

  describe('POST /api/bookings', () => {
    it('should create a booking with instant book', async () => {
      const bookingData = {
        id: 10,
        listing_id: 1,
        guest_id: 2,
        check_in: '2025-03-01',
        check_out: '2025-03-05',
        guests: 2,
        nights: 4,
        price_per_night: 100,
        cleaning_fee: 50,
        service_fee: 40,
        total_price: 490,
        status: 'confirmed',
      };

      const listingData = {
        id: 1,
        host_id: 5,
        title: 'Test Listing',
        city: 'Denver',
        property_type: 'apartment',
        price_per_night: '100',
        cleaning_fee: '50',
        service_fee_percent: '10',
        minimum_nights: 1,
        maximum_nights: 30,
        max_guests: 4,
        instant_book: true,
      };

      mockTransaction.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: vi.fn()
            .mockResolvedValueOnce({ rows: [listingData] })    // SELECT listing FOR UPDATE
            .mockResolvedValueOnce({ rows: [{ conflicts: '0' }] })  // conflict check
            .mockResolvedValueOnce({ rows: [bookingData] })    // INSERT booking
            .mockResolvedValueOnce({ rows: [] }),              // INSERT availability_blocks
        };
        return callback(mockClient as never);
      });

      const res = await request(app)
        .post('/api/bookings')
        .set('Cookie', 'session=test-session-id')
        .send({
          listing_id: 1,
          check_in: '2025-03-01',
          check_out: '2025-03-05',
          guests: 2,
        });

      expect(res.status).toBe(201);
      expect(res.body.booking).toBeDefined();
    });

    it('should return 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Cookie', 'session=test-session-id')
        .send({ listing_id: 1 }); // missing check_in and check_out

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('listing_id, check_in, and check_out are required');
    });

    it('should return 400 when dates are no longer available', async () => {
      mockTransaction.mockImplementationOnce(async () => {
        throw new Error('Dates are no longer available');
      });

      const res = await request(app)
        .post('/api/bookings')
        .set('Cookie', 'session=test-session-id')
        .send({
          listing_id: 1,
          check_in: '2025-03-01',
          check_out: '2025-03-05',
          guests: 2,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Dates are no longer available');
    });
  });

  describe('GET /api/bookings/my-trips', () => {
    it('should return guest trips', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 10,
            listing_title: 'Cozy Cabin',
            listing_city: 'Denver',
            check_in: '2025-03-01',
            check_out: '2025-03-05',
            status: 'confirmed',
            host_name: 'Host',
          },
        ],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .get('/api/bookings/my-trips')
        .set('Cookie', 'session=test-session-id');

      expect(res.status).toBe(200);
      expect(res.body.bookings).toHaveLength(1);
      expect(res.body.bookings[0].listing_title).toBe('Cozy Cabin');
    });

    it('should filter trips by status', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .get('/api/bookings/my-trips?status=confirmed')
        .set('Cookie', 'session=test-session-id');

      expect(res.status).toBe(200);
      expect(res.body.bookings).toHaveLength(0);
      // Verify status was included in params
      const queryCall = mockQuery.mock.calls[0];
      expect(queryCall[1]).toContain('confirmed');
    });
  });

  describe('GET /api/bookings/:id', () => {
    it('should return booking details for authorized user', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 10,
          guest_id: 2,
          host_id: 5,
          listing_title: 'Test Listing',
          check_in: '2025-03-01',
          check_out: '2025-03-05',
          status: 'confirmed',
          total_price: 490,
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .get('/api/bookings/10')
        .set('Cookie', 'session=test-session-id');

      expect(res.status).toBe(200);
      expect(res.body.booking).toBeDefined();
      expect(res.body.booking.id).toBe(10);
    });

    it('should return 404 for non-existent booking', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .get('/api/bookings/999')
        .set('Cookie', 'session=test-session-id');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Booking not found');
    });

    it('should return 403 for unauthorized user', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 10,
          guest_id: 99,  // different from mock user id (2)
          host_id: 88,   // different from mock user id (2)
          listing_title: 'Test Listing',
          status: 'confirmed',
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .get('/api/bookings/10')
        .set('Cookie', 'session=test-session-id');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Not authorized');
    });
  });

  describe('PUT /api/bookings/:id/cancel', () => {
    it('should cancel a booking by the guest', async () => {
      // Get booking
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 10,
          guest_id: 2,
          host_id: 5,
          listing_id: 1,
          listing_title: 'Test Listing',
          status: 'confirmed',
          check_in: '2025-03-01',
          check_out: '2025-03-05',
          total_price: 490,
          nights: 4,
          guests: 2,
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      // Transaction for cancellation
      mockTransaction.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: vi.fn()
            .mockResolvedValueOnce({ rows: [] }) // UPDATE booking
            .mockResolvedValueOnce({ rows: [] }), // DELETE availability_blocks
        };
        return callback(mockClient as never);
      });

      const res = await request(app)
        .put('/api/bookings/10/cancel')
        .set('Cookie', 'session=test-session-id');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Booking cancelled');
    });

    it('should return 404 for non-existent or non-cancellable booking', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .put('/api/bookings/999/cancel')
        .set('Cookie', 'session=test-session-id');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Booking not found or not cancellable');
    });
  });
});
