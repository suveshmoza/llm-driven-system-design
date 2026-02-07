/**
 * Unit tests for the Uber backend API.
 * Uses vitest with mocked shared modules (db, redis, queue, services).
 * @module app.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

// ========================================
// Mock shared modules BEFORE importing app
// ========================================

// Mock database
vi.mock('./utils/db.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
  default: {
    query: vi.fn(),
    on: vi.fn(),
  },
}))

// Mock Redis
vi.mock('./utils/redis.js', () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue('PONG'),
    hset: vi.fn().mockResolvedValue(1),
    hgetall: vi.fn().mockResolvedValue(null),
    zadd: vi.fn().mockResolvedValue(1),
    zrem: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    decr: vi.fn().mockResolvedValue(0),
    expire: vi.fn().mockResolvedValue(1),
    geoadd: vi.fn().mockResolvedValue(1),
    georadius: vi.fn().mockResolvedValue([]),
    multi: vi.fn().mockReturnValue({
      geoadd: vi.fn().mockReturnThis(),
      hset: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      zrem: vi.fn().mockReturnThis(),
      incr: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    }),
    on: vi.fn(),
  },
}))

// Mock RabbitMQ queue
vi.mock('./utils/queue.js', () => ({
  connectRabbitMQ: vi.fn().mockResolvedValue({ connection: {}, channel: {} }),
  closeRabbitMQ: vi.fn().mockResolvedValue(undefined),
  publishToQueue: vi.fn().mockResolvedValue(true),
  publishToExchange: vi.fn().mockResolvedValue(true),
  consumeQueue: vi.fn().mockResolvedValue(undefined),
  getQueueDepth: vi.fn().mockResolvedValue(0),
  isHealthy: vi.fn().mockResolvedValue(true),
  QUEUES: {
    MATCHING_REQUESTS: 'matching.requests',
    RIDE_EVENTS: 'ride.events',
    NOTIFICATIONS: 'notifications',
    ANALYTICS: 'analytics',
    DLQ: 'dead.letter.queue',
  },
  EXCHANGES: {
    RIDE_EVENTS: 'ride.events.fanout',
    DIRECT: 'uber.direct',
    DLX: 'dead.letter.exchange',
  },
  default: {
    connectRabbitMQ: vi.fn(),
    publishToQueue: vi.fn(),
    publishToExchange: vi.fn(),
    consumeQueue: vi.fn(),
    getQueueDepth: vi.fn(),
    isHealthy: vi.fn(),
    closeRabbitMQ: vi.fn(),
    QUEUES: {},
    EXCHANGES: {},
  },
}))

// Mock circuit breaker
vi.mock('./utils/circuitBreaker.js', () => ({
  createCircuitBreaker: vi.fn().mockImplementation((fn: Function) => ({
    fire: vi.fn().mockImplementation((...args: unknown[]) => fn(...args)),
    on: vi.fn(),
    fallback: vi.fn(),
  })),
  createCircuitBreakerWithFallback: vi.fn().mockImplementation((fn: Function) => ({
    fire: vi.fn().mockImplementation((...args: unknown[]) => fn(...args)),
    on: vi.fn(),
    fallback: vi.fn(),
  })),
  withRetry: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
  getCircuitBreakerStatus: vi.fn().mockReturnValue({}),
  default: {
    createCircuitBreaker: vi.fn(),
    createCircuitBreakerWithFallback: vi.fn(),
    withRetry: vi.fn(),
    getCircuitBreakerStatus: vi.fn(),
  },
}))

// Mock logger to suppress output during tests
vi.mock('./utils/logger.js', () => {
  const noopLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }
  return {
    default: noopLogger,
    createLogger: vi.fn().mockReturnValue(noopLogger),
    requestLogger: vi.fn().mockImplementation((_req: unknown, _res: unknown, next: () => void) => next()),
    logError: vi.fn(),
  }
})

// Mock metrics to no-op
vi.mock('./utils/metrics.js', () => {
  const noopCounter = { inc: vi.fn(), labels: vi.fn().mockReturnValue({ inc: vi.fn() }) }
  const noopHistogram = { observe: vi.fn(), labels: vi.fn().mockReturnValue({ observe: vi.fn() }) }
  const noopGauge = { set: vi.fn(), inc: vi.fn(), dec: vi.fn(), labels: vi.fn().mockReturnValue({ set: vi.fn() }) }
  return {
    registry: {
      contentType: 'text/plain',
      metrics: vi.fn().mockResolvedValue('# metrics'),
    },
    metricsMiddleware: vi.fn().mockImplementation((_req: unknown, _res: unknown, next: () => void) => next()),
    metrics: {
      rideRequestsTotal: noopCounter,
      rideMatchingDuration: noopHistogram,
      rideStatusGauge: noopGauge,
      rideFareHistogram: noopHistogram,
      driversOnlineGauge: noopGauge,
      driversAvailableGauge: noopGauge,
      driverLocationUpdates: noopCounter,
      surgeMultiplierGauge: noopGauge,
      surgeEventCounter: noopCounter,
      geoQueryDuration: noopHistogram,
      geoOperationsTotal: noopCounter,
      circuitBreakerState: noopGauge,
      circuitBreakerRequests: noopCounter,
      queueMessagesPublished: noopCounter,
      queueMessagesConsumed: noopCounter,
      queueProcessingDuration: noopHistogram,
      queueDepthGauge: noopGauge,
      httpRequestsTotal: noopCounter,
      httpRequestDuration: noopHistogram,
      idempotencyHits: noopCounter,
      idempotencyMisses: noopCounter,
      serviceHealthGauge: noopGauge,
    },
    rideRequestsTotal: noopCounter,
    rideMatchingDuration: noopHistogram,
    rideStatusGauge: noopGauge,
    rideFareHistogram: noopHistogram,
    driversOnlineGauge: noopGauge,
    driversAvailableGauge: noopGauge,
    driverLocationUpdates: noopCounter,
    surgeMultiplierGauge: noopGauge,
    surgeEventCounter: noopCounter,
    geoQueryDuration: noopHistogram,
    geoOperationsTotal: noopCounter,
    circuitBreakerState: noopGauge,
    circuitBreakerRequests: noopCounter,
    queueMessagesPublished: noopCounter,
    queueMessagesConsumed: noopCounter,
    queueProcessingDuration: noopHistogram,
    queueDepthGauge: noopGauge,
    httpRequestsTotal: noopCounter,
    httpRequestDuration: noopHistogram,
    idempotencyHits: noopCounter,
    idempotencyMisses: noopCounter,
    serviceHealthGauge: noopGauge,
    default: {},
  }
})

// Mock health check
vi.mock('./utils/health.js', () => ({
  healthRouter: vi.fn().mockImplementation((expressApp: { get: Function }) => {
    expressApp.get('/health', (_req: unknown, res: { json: Function }) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() })
    })
    expressApp.get('/health/live', (_req: unknown, res: { json: Function }) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() })
    })
    expressApp.get('/health/ready', (_req: unknown, res: { json: Function }) => {
      res.json({ ready: true, timestamp: new Date().toISOString() })
    })
  }),
  getHealthStatus: vi.fn().mockResolvedValue({ status: 'healthy' }),
  getLivenessStatus: vi.fn().mockReturnValue({ status: 'ok' }),
  getReadinessStatus: vi.fn().mockResolvedValue({ ready: true }),
  default: {},
}))

// Mock auth service
vi.mock('./services/authService.js', () => ({
  default: {
    register: vi.fn(),
    registerDriver: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    validateSession: vi.fn(),
    createSession: vi.fn(),
    getUserById: vi.fn(),
  },
}))

// Mock matching service
vi.mock('./services/matching/index.js', () => ({
  default: {
    registerClient: vi.fn(),
    unregisterClient: vi.fn(),
    sendToUser: vi.fn(),
    initializeQueues: vi.fn(),
    requestRide: vi.fn(),
    findDriver: vi.fn(),
    scoreDrivers: vi.fn(),
    offerRideToDriver: vi.fn(),
    acceptRide: vi.fn(),
    driverArrived: vi.fn(),
    startRide: vi.fn(),
    completeRide: vi.fn(),
    cancelRide: vi.fn(),
    handleNoDriversFound: vi.fn(),
    getRideStatus: vi.fn(),
  },
}))

// Mock pricing service
vi.mock('./services/pricingService.js', () => ({
  default: {
    calculateFareEstimate: vi.fn(),
    getFareEstimate: vi.fn(),
    getAllFareEstimates: vi.fn(),
    getSurgeMultiplier: vi.fn(),
    calculateSurge: vi.fn(),
    incrementDemand: vi.fn(),
    decrementDemand: vi.fn(),
    getSurgeInfo: vi.fn(),
  },
}))

// Mock location service
vi.mock('./services/locationService.js', () => ({
  default: {
    updateDriverLocation: vi.fn(),
    setDriverAvailability: vi.fn(),
    setDriverBusy: vi.fn(),
    findNearbyDrivers: vi.fn(),
    getDriverLocation: vi.fn(),
    getDriverStatus: vi.fn(),
    countAvailableDrivers: vi.fn(),
    updateDriverMetrics: vi.fn(),
  },
}))

// Mock idempotency middleware to pass through
vi.mock('./middleware/idempotency.js', () => ({
  idempotencyMiddleware: vi.fn().mockReturnValue(
    (_req: unknown, _res: unknown, next: () => void) => next()
  ),
  default: {
    idempotencyMiddleware: vi.fn(),
  },
}))

// ========================================
// Import AFTER mocking
// ========================================

import { app } from './app.js'
import { query } from './utils/db.js'
import authService from './services/authService.js'
import matchingService from './services/matching/index.js'
import pricingService from './services/pricingService.js'
import locationService from './services/locationService.js'

// ========================================
// Test helpers
// ========================================

const mockRider = {
  id: 'rider-123',
  email: 'rider@test.com',
  name: 'Test Rider',
  phone: '555-0001',
  userType: 'rider' as const,
  rating: 4.5,
}

const mockDriver = {
  id: 'driver-456',
  email: 'driver@test.com',
  name: 'Test Driver',
  phone: '555-0002',
  userType: 'driver' as const,
  rating: 4.8,
  vehicle: {
    vehicleType: 'economy' as const,
    vehicleMake: 'Toyota',
    vehicleModel: 'Camry',
    vehicleColor: 'White',
    licensePlate: 'ABC-1234',
  },
}

const VALID_TOKEN = 'valid-test-token-abc123'

function authenticateAsRider() {
  vi.mocked(authService.validateSession).mockResolvedValue(mockRider)
}

function authenticateAsDriver() {
  vi.mocked(authService.validateSession).mockResolvedValue(mockDriver)
}

// ========================================
// Tests
// ========================================

describe('Uber Backend API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------
  // Health endpoints
  // --------------------------------------------------
  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/health')

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('status', 'healthy')
      expect(response.body).toHaveProperty('timestamp')
    })
  })

  describe('GET /health/live', () => {
    it('should return liveness status', async () => {
      const response = await request(app).get('/health/live')

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('status', 'ok')
    })
  })

  describe('GET /health/ready', () => {
    it('should return readiness status', async () => {
      const response = await request(app).get('/health/ready')

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('ready', true)
    })
  })

  // --------------------------------------------------
  // 404 handler
  // --------------------------------------------------
  describe('Unknown routes', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app).get('/api/nonexistent')

      expect(response.status).toBe(404)
      expect(response.body).toEqual({ error: 'Not found' })
    })
  })

  // --------------------------------------------------
  // Auth routes
  // --------------------------------------------------
  describe('POST /api/auth/register/rider', () => {
    it('should register a new rider successfully', async () => {
      const registrationResult = {
        success: true,
        user: mockRider,
        token: VALID_TOKEN,
      }
      vi.mocked(authService.register).mockResolvedValue(registrationResult)

      const response = await request(app)
        .post('/api/auth/register/rider')
        .send({ email: 'rider@test.com', password: 'password123', name: 'Test Rider' })

      expect(response.status).toBe(201)
      expect(response.body.success).toBe(true)
      expect(response.body.user).toEqual(mockRider)
      expect(response.body.token).toBe(VALID_TOKEN)
      expect(authService.register).toHaveBeenCalledWith(
        'rider@test.com', 'password123', 'Test Rider', null, 'rider'
      )
    })

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/auth/register/rider')
        .send({ email: 'rider@test.com' })

      expect(response.status).toBe(400)
      expect(response.body).toEqual({ error: 'Email, password, and name are required' })
    })

    it('should return 400 when email already exists', async () => {
      vi.mocked(authService.register).mockResolvedValue({
        success: false,
        error: 'Email already registered',
      })

      const response = await request(app)
        .post('/api/auth/register/rider')
        .send({ email: 'existing@test.com', password: 'password123', name: 'Existing User' })

      expect(response.status).toBe(400)
      expect(response.body).toEqual({ error: 'Email already registered' })
    })
  })

  describe('POST /api/auth/register/driver', () => {
    it('should register a new driver successfully', async () => {
      const registrationResult = {
        success: true,
        user: mockDriver,
        token: VALID_TOKEN,
      }
      vi.mocked(authService.registerDriver).mockResolvedValue(registrationResult)

      const response = await request(app)
        .post('/api/auth/register/driver')
        .send({
          email: 'driver@test.com',
          password: 'password123',
          name: 'Test Driver',
          vehicle: mockDriver.vehicle,
        })

      expect(response.status).toBe(201)
      expect(response.body.success).toBe(true)
      expect(response.body.user).toEqual(mockDriver)
    })

    it('should return 400 for missing vehicle info', async () => {
      const response = await request(app)
        .post('/api/auth/register/driver')
        .send({ email: 'driver@test.com', password: 'password123', name: 'Driver' })

      expect(response.status).toBe(400)
      expect(response.body).toEqual({ error: 'Email, password, name, and vehicle info are required' })
    })
  })

  describe('POST /api/auth/login', () => {
    it('should login successfully with valid credentials', async () => {
      const loginResult = {
        success: true,
        user: mockRider,
        token: VALID_TOKEN,
      }
      vi.mocked(authService.login).mockResolvedValue(loginResult)

      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'rider@test.com', password: 'password123' })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.token).toBe(VALID_TOKEN)
    })

    it('should return 400 for missing credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'rider@test.com' })

      expect(response.status).toBe(400)
      expect(response.body).toEqual({ error: 'Email and password are required' })
    })

    it('should return 401 for invalid credentials', async () => {
      vi.mocked(authService.login).mockResolvedValue({
        success: false,
        error: 'Invalid email or password',
      })

      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'rider@test.com', password: 'wrongpassword' })

      expect(response.status).toBe(401)
      expect(response.body).toEqual({ error: 'Invalid email or password' })
    })
  })

  describe('GET /api/auth/me', () => {
    it('should return current user when authenticated', async () => {
      authenticateAsRider()

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)

      expect(response.status).toBe(200)
      expect(response.body.user).toEqual(mockRider)
    })

    it('should return 401 without authentication', async () => {
      vi.mocked(authService.validateSession).mockResolvedValue(null)

      const response = await request(app).get('/api/auth/me')

      expect(response.status).toBe(401)
      expect(response.body).toEqual({ error: 'Authentication required' })
    })
  })

  describe('POST /api/auth/logout', () => {
    it('should logout successfully', async () => {
      authenticateAsRider()
      vi.mocked(authService.logout).mockResolvedValue({ success: true })

      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ success: true })
    })
  })

  // --------------------------------------------------
  // Ride routes
  // --------------------------------------------------
  describe('POST /api/rides/estimate', () => {
    it('should return fare estimates for authenticated rider', async () => {
      authenticateAsRider()

      const mockEstimates = [
        {
          vehicleType: 'economy',
          totalFareCents: 1500,
          distanceKm: 5,
          durationMinutes: 12,
          surgeMultiplier: 1.0,
          baseFareCents: 250,
          distanceFareCents: 500,
          timeFareCents: 300,
          vehicleMultiplier: 1.0,
          distanceMiles: 3.11,
        },
      ]
      vi.mocked(pricingService.getAllFareEstimates).mockResolvedValue(mockEstimates)
      vi.mocked(locationService.findNearbyDrivers).mockResolvedValue([])

      const response = await request(app)
        .post('/api/rides/estimate')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({
          pickupLat: 37.7749,
          pickupLng: -122.4194,
          dropoffLat: 37.7849,
          dropoffLng: -122.4094,
        })

      expect(response.status).toBe(200)
      expect(response.body.estimates).toBeDefined()
      expect(response.body.estimates.length).toBeGreaterThan(0)
    })

    it('should return 400 for missing coordinates', async () => {
      authenticateAsRider()

      const response = await request(app)
        .post('/api/rides/estimate')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ pickupLat: 37.7749 })

      expect(response.status).toBe(400)
      expect(response.body).toEqual({ error: 'Pickup and dropoff coordinates are required' })
    })

    it('should return 403 when a driver tries to get an estimate', async () => {
      authenticateAsDriver()

      const response = await request(app)
        .post('/api/rides/estimate')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({
          pickupLat: 37.7749,
          pickupLng: -122.4194,
          dropoffLat: 37.7849,
          dropoffLng: -122.4094,
        })

      expect(response.status).toBe(403)
      expect(response.body).toEqual({ error: 'Rider access required' })
    })
  })

  describe('POST /api/rides/request', () => {
    it('should request a ride successfully', async () => {
      authenticateAsRider()

      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never) // No active ride

      const rideResult = {
        rideId: 'ride-789',
        status: 'requested',
        fareEstimate: { totalFareCents: 1500 },
        pickupLat: 37.7749,
        pickupLng: -122.4194,
        dropoffLat: 37.7849,
        dropoffLng: -122.4094,
        vehicleType: 'economy',
      }
      vi.mocked(matchingService.requestRide).mockResolvedValue(rideResult as never)

      const response = await request(app)
        .post('/api/rides/request')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({
          pickupLat: 37.7749,
          pickupLng: -122.4194,
          dropoffLat: 37.7849,
          dropoffLng: -122.4094,
          vehicleType: 'economy',
        })

      expect(response.status).toBe(201)
      expect(response.body.rideId).toBe('ride-789')
      expect(response.body.status).toBe('requested')
    })

    it('should return 409 when rider already has an active ride', async () => {
      authenticateAsRider()

      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ id: 'existing-ride-1', status: 'matched' }],
      } as never)

      const response = await request(app)
        .post('/api/rides/request')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({
          pickupLat: 37.7749,
          pickupLng: -122.4194,
          dropoffLat: 37.7849,
          dropoffLng: -122.4094,
        })

      expect(response.status).toBe(409)
      expect(response.body.error).toBe('You already have an active ride')
      expect(response.body.existingRideId).toBe('existing-ride-1')
    })
  })

  describe('GET /api/rides/:rideId', () => {
    it('should return ride status for authenticated user', async () => {
      authenticateAsRider()

      const rideStatus = {
        id: 'ride-789',
        status: 'matched',
        pickup: { lat: 37.7749, lng: -122.4194 },
        dropoff: { lat: 37.7849, lng: -122.4094 },
        driver: {
          id: 'driver-456',
          name: 'Test Driver',
          vehicleType: 'economy',
          vehicleMake: 'Toyota',
          vehicleModel: 'Camry',
          vehicleColor: 'White',
          licensePlate: 'ABC-1234',
        },
      }
      vi.mocked(matchingService.getRideStatus).mockResolvedValue(rideStatus as never)

      const response = await request(app)
        .get('/api/rides/ride-789')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)

      expect(response.status).toBe(200)
      expect(response.body.id).toBe('ride-789')
      expect(response.body.status).toBe('matched')
      expect(response.body.driver.name).toBe('Test Driver')
    })

    it('should return 404 for non-existent ride', async () => {
      authenticateAsRider()
      vi.mocked(matchingService.getRideStatus).mockResolvedValue(null)

      const response = await request(app)
        .get('/api/rides/nonexistent-ride')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)

      expect(response.status).toBe(404)
      expect(response.body).toEqual({ error: 'Ride not found' })
    })
  })

  describe('POST /api/rides/:rideId/cancel', () => {
    it('should cancel a ride successfully', async () => {
      authenticateAsRider()
      vi.mocked(matchingService.cancelRide).mockResolvedValue({ success: true } as never)

      const response = await request(app)
        .post('/api/rides/ride-789/cancel')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ reason: 'Changed my mind' })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(matchingService.cancelRide).toHaveBeenCalledWith('ride-789', 'rider', 'Changed my mind')
    })

    it('should return 400 when cancellation fails', async () => {
      authenticateAsRider()
      vi.mocked(matchingService.cancelRide).mockResolvedValue({
        success: false,
        error: 'Ride cannot be cancelled in current state',
      } as never)

      const response = await request(app)
        .post('/api/rides/ride-789/cancel')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)

      expect(response.status).toBe(400)
      expect(response.body.error).toBe('Ride cannot be cancelled in current state')
    })
  })

  describe('POST /api/rides/:rideId/rate', () => {
    it('should rate a completed ride successfully', async () => {
      authenticateAsRider()

      const completedRide = {
        id: 'ride-789',
        rider_id: 'rider-123',
        driver_id: 'driver-456',
        status: 'completed',
        driver_rating: null,
        rider_rating: null,
      }
      vi.mocked(query)
        .mockResolvedValueOnce({ rows: [completedRide] } as never) // Get ride
        .mockResolvedValueOnce({ rows: [] } as never) // Update ride rating
        .mockResolvedValueOnce({ rows: [] } as never) // Update driver's average rating

      const response = await request(app)
        .post('/api/rides/ride-789/rate')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ rating: 5 })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ success: true })
    })

    it('should return 400 for invalid rating', async () => {
      authenticateAsRider()

      const response = await request(app)
        .post('/api/rides/ride-789/rate')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ rating: 6 })

      expect(response.status).toBe(400)
      expect(response.body).toEqual({ error: 'Rating must be between 1 and 5' })
    })

    it('should return 404 for non-existent ride', async () => {
      authenticateAsRider()
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never)

      const response = await request(app)
        .post('/api/rides/nonexistent/rate')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ rating: 4 })

      expect(response.status).toBe(404)
      expect(response.body).toEqual({ error: 'Ride not found' })
    })

    it('should return 400 when rating a non-completed ride', async () => {
      authenticateAsRider()

      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ id: 'ride-789', status: 'matched', driver_rating: null, rider_rating: null }],
      } as never)

      const response = await request(app)
        .post('/api/rides/ride-789/rate')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ rating: 4 })

      expect(response.status).toBe(400)
      expect(response.body).toEqual({ error: 'Can only rate completed rides' })
    })
  })

  describe('GET /api/rides (ride history)', () => {
    it('should return ride history for authenticated rider', async () => {
      authenticateAsRider()

      const mockRides = [
        {
          id: 'ride-1',
          status: 'completed',
          pickup_lat: '37.7749',
          pickup_lng: '-122.4194',
          pickup_address: '123 Market St',
          dropoff_lat: '37.7849',
          dropoff_lng: '-122.4094',
          dropoff_address: '456 Mission St',
          vehicle_type: 'economy',
          final_fare_cents: 1500,
          estimated_fare_cents: 1400,
          surge_multiplier: '1.0',
          driver_name: 'Test Driver',
          vehicle_make: 'Toyota',
          vehicle_model: 'Camry',
          vehicle_color: 'White',
          requested_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
      ]
      vi.mocked(query).mockResolvedValueOnce({ rows: mockRides } as never)

      const response = await request(app)
        .get('/api/rides')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)

      expect(response.status).toBe(200)
      expect(response.body.rides).toBeDefined()
      expect(response.body.rides.length).toBe(1)
      expect(response.body.rides[0].id).toBe('ride-1')
      expect(response.body.rides[0].status).toBe('completed')
      expect(response.body.rides[0].fare).toBe(1500)
    })
  })

  // --------------------------------------------------
  // Driver routes
  // --------------------------------------------------
  describe('POST /api/driver/location', () => {
    it('should update driver location', async () => {
      authenticateAsDriver()
      vi.mocked(locationService.updateDriverLocation).mockResolvedValue({ success: true })

      const response = await request(app)
        .post('/api/driver/location')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ lat: 37.7749, lng: -122.4194 })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ success: true })
      expect(locationService.updateDriverLocation).toHaveBeenCalledWith('driver-456', 37.7749, -122.4194)
    })

    it('should return 400 for missing coordinates', async () => {
      authenticateAsDriver()

      const response = await request(app)
        .post('/api/driver/location')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ lat: 37.7749 })

      expect(response.status).toBe(400)
      expect(response.body).toEqual({ error: 'Location coordinates are required' })
    })

    it('should return 403 when a rider tries to update driver location', async () => {
      authenticateAsRider()

      const response = await request(app)
        .post('/api/driver/location')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ lat: 37.7749, lng: -122.4194 })

      expect(response.status).toBe(403)
      expect(response.body).toEqual({ error: 'Driver access required' })
    })
  })

  describe('POST /api/driver/online', () => {
    it('should set driver online with location', async () => {
      authenticateAsDriver()
      vi.mocked(locationService.setDriverAvailability).mockResolvedValue({ success: true })

      const response = await request(app)
        .post('/api/driver/online')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ lat: 37.7749, lng: -122.4194 })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ success: true, status: 'online' })
    })
  })

  describe('POST /api/driver/offline', () => {
    it('should set driver offline', async () => {
      authenticateAsDriver()
      vi.mocked(locationService.setDriverAvailability).mockResolvedValue({ success: true })

      const response = await request(app)
        .post('/api/driver/offline')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ success: true, status: 'offline' })
    })
  })

  describe('POST /api/driver/rides/:rideId/accept', () => {
    it('should accept a ride offer successfully', async () => {
      authenticateAsDriver()
      vi.mocked(matchingService.acceptRide).mockResolvedValue({ success: true } as never)

      const response = await request(app)
        .post('/api/driver/rides/ride-789/accept')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(matchingService.acceptRide).toHaveBeenCalledWith('ride-789', 'driver-456')
    })

    it('should return 400 when ride acceptance fails', async () => {
      authenticateAsDriver()
      vi.mocked(matchingService.acceptRide).mockResolvedValue({
        success: false,
        error: 'Ride already accepted by another driver',
      } as never)

      const response = await request(app)
        .post('/api/driver/rides/ride-789/accept')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)

      expect(response.status).toBe(400)
      expect(response.body.error).toBe('Ride already accepted by another driver')
    })
  })

  describe('POST /api/driver/rides/:rideId/complete', () => {
    it('should complete a ride successfully', async () => {
      authenticateAsDriver()
      vi.mocked(matchingService.completeRide).mockResolvedValue({
        success: true,
        finalFareCents: 1500,
      } as never)

      const response = await request(app)
        .post('/api/driver/rides/ride-789/complete')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ finalDistanceMeters: 5000 })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.finalFareCents).toBe(1500)
    })

    it('should return 400 when completion fails', async () => {
      authenticateAsDriver()
      vi.mocked(matchingService.completeRide).mockResolvedValue({
        success: false,
        error: 'Ride not in correct state for completion',
      } as never)

      const response = await request(app)
        .post('/api/driver/rides/ride-789/complete')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)

      expect(response.status).toBe(400)
      expect(response.body.error).toBe('Ride not in correct state for completion')
    })
  })

  describe('GET /api/driver/status', () => {
    it('should return driver status with no active ride', async () => {
      authenticateAsDriver()
      vi.mocked(locationService.getDriverStatus).mockResolvedValue('available')
      vi.mocked(locationService.getDriverLocation).mockResolvedValue({
        lat: 37.7749,
        lng: -122.4194,
        timestamp: Date.now(),
        source: 'redis',
      })
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never) // No active ride

      const response = await request(app)
        .get('/api/driver/status')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)

      expect(response.status).toBe(200)
      expect(response.body.status).toBe('available')
      expect(response.body.location).toBeDefined()
      expect(response.body.activeRide).toBeNull()
    })
  })

  describe('GET /api/driver/profile', () => {
    it('should return driver profile', async () => {
      authenticateAsDriver()

      vi.mocked(query).mockResolvedValueOnce({
        rows: [{
          id: 'driver-456',
          name: 'Test Driver',
          email: 'driver@test.com',
          phone: '555-0002',
          rating: '4.8',
          rating_count: 100,
          vehicle_type: 'economy',
          vehicle_make: 'Toyota',
          vehicle_model: 'Camry',
          vehicle_color: 'White',
          license_plate: 'ABC-1234',
          total_rides: 500,
          total_earnings_cents: 750000,
          is_online: true,
          is_available: true,
          created_at: new Date(),
        }],
      } as never)

      const response = await request(app)
        .get('/api/driver/profile')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)

      expect(response.status).toBe(200)
      expect(response.body.name).toBe('Test Driver')
      expect(response.body.rating).toBe(4.8)
      expect(response.body.vehicle.type).toBe('economy')
      expect(response.body.stats.totalRides).toBe(500)
    })

    it('should return 404 when driver profile not found', async () => {
      authenticateAsDriver()
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never)

      const response = await request(app)
        .get('/api/driver/profile')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)

      expect(response.status).toBe(404)
      expect(response.body).toEqual({ error: 'Driver not found' })
    })
  })

  describe('GET /api/driver/earnings', () => {
    it('should return driver earnings for today', async () => {
      authenticateAsDriver()

      vi.mocked(query)
        .mockResolvedValueOnce({
          rows: [{
            total_rides: '10',
            total_earnings: '25000',
            avg_fare: '2500',
            total_distance: '80000',
            total_duration: '14400',
          }],
        } as never) // Earnings summary
        .mockResolvedValueOnce({ rows: [] } as never) // Hourly breakdown

      const response = await request(app)
        .get('/api/driver/earnings')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)

      expect(response.status).toBe(200)
      expect(response.body.period).toBe('today')
      expect(response.body.totalRides).toBe(10)
      expect(response.body.totalEarnings).toBe(25000)
    })
  })
})
