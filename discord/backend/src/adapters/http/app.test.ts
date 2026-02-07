/**
 * Unit tests for the Discord HTTP API.
 * Uses vitest with mocked shared modules (db, core, utils).
 * @module adapters/http/app.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

// ============================================================================
// Mock all external dependencies BEFORE importing the HTTP server
// ============================================================================

// Mock the logger to silence output during tests
vi.mock('../../utils/logger.js', () => {
  const noopLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
    flush: vi.fn(),
  }
  return {
    logger: noopLogger,
    httpLogger: noopLogger,
    tcpLogger: noopLogger,
    dbLogger: noopLogger,
    pubsubLogger: noopLogger,
    coreLogger: noopLogger,
    createChildLogger: vi.fn().mockReturnValue(noopLogger),
    createRequestLogger: vi.fn().mockReturnValue(noopLogger),
    generateRequestId: vi.fn().mockReturnValue('test-req-id'),
    logWithTiming: vi.fn(),
    logError: vi.fn(),
    logThresholdExceeded: vi.fn(),
    flushLogs: vi.fn().mockResolvedValue(undefined),
    default: noopLogger,
  }
})

// Mock shared config
vi.mock('../../shared/config.js', () => ({
  server: {
    instanceId: 'test-1',
    tcpPort: 9001,
    httpPort: 3001,
    logLevel: 'silent',
    nodeEnv: 'test',
  },
  database: {
    url: 'postgresql://test:test@localhost:5432/test',
    poolMax: 5,
    idleTimeout: 30000,
    connectionTimeout: 2000,
  },
  redis: { url: 'redis://localhost:6379', maxRetries: 3 },
  messageRetention: {
    maxMessagesPerRoom: 10,
    maxMessageAgeHours: 0,
    cleanupIntervalMinutes: 5,
    archiveBeforeDelete: false,
    archiveDirectory: './archive',
  },
  alertThresholds: {
    pubsubLatency: { warning: 100, critical: 500 },
    queueDepth: { warning: 100, critical: 500 },
    dbConnectionWait: { warning: 50, critical: 200 },
    tableSize: { messages: { warning: 5, critical: 20 } },
    cacheHitRate: { historyBuffer: { target: 95, warning: 90 } },
  },
  shutdown: { gracePeriodMs: 10000, warningIntervalMs: 2000, drainConnections: true },
  checkThreshold: vi.fn().mockReturnValue('ok'),
  checkCacheHitRate: vi.fn().mockReturnValue('ok'),
  default: {},
}))

// Mock metrics to no-op
vi.mock('../../shared/metrics.js', () => {
  const mockGauge = { labels: vi.fn().mockReturnValue({ set: vi.fn(), inc: vi.fn() }), set: vi.fn(), inc: vi.fn() }
  const mockCounter = { labels: vi.fn().mockReturnValue({ inc: vi.fn() }), inc: vi.fn() }
  const mockHistogram = { labels: vi.fn().mockReturnValue({ observe: vi.fn() }), observe: vi.fn() }
  return {
    metricsRegistry: { metrics: vi.fn().mockResolvedValue('# test metrics'), contentType: 'text/plain' },
    activeConnections: { ...mockGauge },
    totalConnections: { ...mockCounter },
    connectionErrors: { ...mockCounter },
    messagesSent: { ...mockCounter },
    messagesReceived: { ...mockCounter },
    messageDeliveryLatency: { ...mockHistogram },
    pubsubPublishLatency: { ...mockHistogram },
    pubsubConnectionStatus: { ...mockGauge },
    subscribedChannels: { ...mockGauge },
    dbPoolSize: { ...mockGauge },
    dbQueryLatency: { ...mockHistogram },
    dbErrors: { ...mockCounter },
    activeRooms: { ...mockGauge },
    roomMembership: { ...mockGauge },
    historyBufferHits: { ...mockCounter },
    historyBufferMisses: { ...mockCounter },
    historyBufferSize: { ...mockGauge },
    cleanupJobRuns: { ...mockCounter },
    lastCleanupTimestamp: { ...mockGauge },
    messagesDeleted: { ...mockCounter },
    commandsExecuted: { ...mockCounter },
    recordConnection: vi.fn(),
    recordMessageSent: vi.fn(),
    recordPubsubPublish: vi.fn(),
    recordDbQuery: vi.fn(),
    updateDbPoolMetrics: vi.fn(),
    getMetrics: vi.fn().mockResolvedValue('# test metrics'),
    getMetricsContentType: vi.fn().mockReturnValue('text/plain'),
    default: {},
  }
})

// Mock core modules
vi.mock('../../core/index.js', () => ({
  connectionManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    getSession: vi.fn(),
    getSessionCount: vi.fn().mockReturnValue(0),
    getOnlineUserCount: vi.fn().mockReturnValue(0),
    getSessions: vi.fn().mockReturnValue([]),
  },
  chatHandler: {
    handleInput: vi.fn(),
    handleDisconnect: vi.fn(),
  },
  roomManager: {
    listRooms: vi.fn().mockResolvedValue([]),
    getRoom: vi.fn(),
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    leaveRoom: vi.fn(),
  },
  historyBuffer: {
    getHistory: vi.fn().mockReturnValue([]),
    addMessage: vi.fn(),
  },
  commandParser: {
    parse: vi.fn(),
  },
  messageRouter: {
    routeMessage: vi.fn(),
  },
  // Class exports (not used directly but must be present)
  ConnectionManager: vi.fn(),
  ChatHandler: vi.fn(),
  RoomManager: vi.fn(),
  HistoryBuffer: vi.fn(),
  CommandParser: vi.fn(),
  MessageRouter: vi.fn(),
}))

// Mock database operations
vi.mock('../../db/index.js', () => ({
  getOrCreateUser: vi.fn(),
  createUser: vi.fn(),
  getUserByNickname: vi.fn(),
  getUserById: vi.fn(),
  createRoom: vi.fn(),
  getRoomByName: vi.fn(),
  getRoomById: vi.fn(),
  getAllRooms: vi.fn(),
  deleteRoom: vi.fn(),
  joinRoom: vi.fn(),
  leaveRoom: vi.fn(),
  leaveAllRooms: vi.fn(),
  getRoomMembers: vi.fn(),
  getUserRooms: vi.fn(),
  saveMessage: vi.fn(),
  getRecentMessages: vi.fn(),
  cleanupOldMessages: vi.fn(),
  updateNickname: vi.fn(),
  db: {
    query: vi.fn(),
    getClient: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
    close: vi.fn(),
  },
  default: {
    query: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
  },
}))

// Mock pubsub manager
vi.mock('../../utils/pubsub.js', () => ({
  pubsubManager: {
    isConnected: vi.fn().mockReturnValue(true),
    getSubscribedChannels: vi.fn().mockReturnValue([]),
    connect: vi.fn(),
    disconnect: vi.fn(),
    subscribeToRoom: vi.fn(),
    unsubscribeFromRoom: vi.fn(),
    publishToRoom: vi.fn(),
    setMessageHandler: vi.fn(),
  },
  default: {},
}))

// Mock cleanup utilities
vi.mock('../../utils/cleanup.js', () => ({
  isCleanupRunning: vi.fn().mockReturnValue(false),
  getStorageStats: vi.fn().mockResolvedValue({
    totalMessages: 42,
    messagesPerRoom: [{ roomName: 'general', count: 42 }],
    tableSize: '16 kB',
  }),
  runCleanup: vi.fn(),
  startCleanupJob: vi.fn(),
  stopCleanupJob: vi.fn(),
  default: {},
}))

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('test-session-uuid'),
}))

// ============================================================================
// Import after mocking
// ============================================================================

import { HTTPServer } from './index.js'
import { connectionManager, chatHandler, roomManager, historyBuffer } from '../../core/index.js'
import * as dbOps from '../../db/index.js'
import { getStorageStats } from '../../utils/cleanup.js'

// ============================================================================
// Test Suite
// ============================================================================

describe('Discord HTTP API', () => {
  let httpServer: HTTPServer
  let app: ReturnType<HTTPServer['getApp']>

  beforeEach(() => {
    vi.clearAllMocks()
    httpServer = new HTTPServer(3099)
    app = httpServer.getApp()
  })

  // --------------------------------------------------------------------------
  // Health and Observability
  // --------------------------------------------------------------------------

  describe('GET /health', () => {
    it('should return healthy status when DB and Redis are up', async () => {
      vi.mocked(dbOps.db.healthCheck).mockResolvedValue(true)

      const res = await request(app).get('/health')

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('healthy')
      expect(res.body).toHaveProperty('timestamp')
      expect(res.body).toHaveProperty('checks')
      expect(res.body.checks.database.status).toBe('healthy')
      expect(res.body.checks.redis.status).toBe('healthy')
    })

    it('should return unhealthy status when DB is down', async () => {
      vi.mocked(dbOps.db.healthCheck).mockResolvedValue(false)

      const res = await request(app).get('/health')

      expect(res.status).toBe(503)
      expect(res.body.status).toBe('unhealthy')
      expect(res.body.checks.database.status).toBe('unhealthy')
    })
  })

  describe('GET /api/health', () => {
    it('should return legacy health check', async () => {
      vi.mocked(dbOps.db.healthCheck).mockResolvedValue(true)

      const res = await request(app).get('/api/health')

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('healthy')
      expect(res.body).toHaveProperty('db', true)
      expect(res.body).toHaveProperty('connections')
      expect(res.body).toHaveProperty('uptime')
    })
  })

  describe('GET /metrics', () => {
    it('should return Prometheus metrics', async () => {
      const res = await request(app).get('/metrics')

      expect(res.status).toBe(200)
      expect(res.text).toContain('# test metrics')
    })
  })

  // --------------------------------------------------------------------------
  // Authentication Routes
  // --------------------------------------------------------------------------

  describe('POST /api/connect', () => {
    it('should connect a user with a valid nickname', async () => {
      vi.mocked(dbOps.getOrCreateUser).mockResolvedValue({
        id: 1,
        nickname: 'testuser',
        createdAt: new Date(),
      })

      const res = await request(app)
        .post('/api/connect')
        .send({ nickname: 'testuser' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toEqual({
        sessionId: 'test-session-uuid',
        userId: 1,
        nickname: 'testuser',
      })
      expect(connectionManager.connect).toHaveBeenCalledWith(
        'test-session-uuid',
        1,
        'testuser',
        'http',
        expect.any(Function)
      )
    })

    it('should return 400 for too short nickname', async () => {
      const res = await request(app)
        .post('/api/connect')
        .send({ nickname: 'a' })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toContain('between 2 and 50 characters')
    })

    it('should return 400 for missing nickname', async () => {
      const res = await request(app)
        .post('/api/connect')
        .send({})

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })

    it('should return 400 for nickname with invalid characters', async () => {
      const res = await request(app)
        .post('/api/connect')
        .send({ nickname: 'test user!' })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toContain('letters, numbers, underscores, and hyphens')
    })

    it('should return 500 when database fails during connect', async () => {
      vi.mocked(dbOps.getOrCreateUser).mockRejectedValue(new Error('DB connection failed'))

      const res = await request(app)
        .post('/api/connect')
        .send({ nickname: 'testuser' })

      expect(res.status).toBe(500)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe('Failed to connect')
    })
  })

  describe('POST /api/disconnect', () => {
    it('should disconnect a valid session', async () => {
      vi.mocked(connectionManager.getSession).mockReturnValue({
        sessionId: 'test-session-uuid',
        userId: 1,
        nickname: 'testuser',
        currentRoom: null,
        transport: 'http',
        sendMessage: vi.fn(),
        createdAt: new Date(),
      })

      const res = await request(app)
        .post('/api/disconnect')
        .send({ sessionId: 'test-session-uuid' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.message).toBe('Disconnected')
      expect(chatHandler.handleDisconnect).toHaveBeenCalledWith('test-session-uuid')
    })

    it('should return 400 when sessionId is missing', async () => {
      const res = await request(app)
        .post('/api/disconnect')
        .send({})

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe('sessionId is required')
    })

    it('should return 401 for invalid session', async () => {
      vi.mocked(connectionManager.getSession).mockReturnValue(undefined)

      const res = await request(app)
        .post('/api/disconnect')
        .send({ sessionId: 'nonexistent-session' })

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe('Invalid session')
    })
  })

  // --------------------------------------------------------------------------
  // Room Routes
  // --------------------------------------------------------------------------

  describe('GET /api/rooms', () => {
    it('should return list of rooms', async () => {
      const mockRooms = [
        { name: 'general', memberCount: 5, createdAt: new Date() },
        { name: 'random', memberCount: 2, createdAt: new Date() },
      ]
      vi.mocked(roomManager.listRooms).mockResolvedValue(mockRooms)

      const res = await request(app).get('/api/rooms')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.rooms).toHaveLength(2)
      expect(res.body.data.rooms[0].name).toBe('general')
    })

    it('should return empty array when no rooms exist', async () => {
      vi.mocked(roomManager.listRooms).mockResolvedValue([])

      const res = await request(app).get('/api/rooms')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.rooms).toEqual([])
    })

    it('should return 500 on room listing failure', async () => {
      vi.mocked(roomManager.listRooms).mockRejectedValue(new Error('DB error'))

      const res = await request(app).get('/api/rooms')

      expect(res.status).toBe(500)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe('Failed to list rooms')
    })
  })

  describe('GET /api/rooms/:room/history', () => {
    it('should return message history for an existing room', async () => {
      const mockHistory = [
        { room: 'general', user: 'alice', content: 'Hello!', timestamp: new Date() },
        { room: 'general', user: 'bob', content: 'Hi!', timestamp: new Date() },
      ]
      vi.mocked(roomManager.getRoom).mockResolvedValue({
        id: 1,
        name: 'general',
        createdBy: 1,
        createdAt: new Date(),
      })
      vi.mocked(historyBuffer.getHistory).mockReturnValue(mockHistory)

      const res = await request(app).get('/api/rooms/general/history')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.messages).toHaveLength(2)
    })

    it('should return 404 for nonexistent room', async () => {
      vi.mocked(roomManager.getRoom).mockResolvedValue(null)

      const res = await request(app).get('/api/rooms/nonexistent/history')

      expect(res.status).toBe(404)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe('Room not found')
    })
  })

  // --------------------------------------------------------------------------
  // Command Routes
  // --------------------------------------------------------------------------

  describe('POST /api/command', () => {
    const validSession = {
      sessionId: 'test-session-uuid',
      userId: 1,
      nickname: 'testuser',
      currentRoom: 'general',
      transport: 'http' as const,
      sendMessage: vi.fn(),
      createdAt: new Date(),
    }

    it('should execute a valid command', async () => {
      vi.mocked(connectionManager.getSession).mockReturnValue(validSession)
      vi.mocked(chatHandler.handleInput).mockResolvedValue({
        success: true,
        message: 'Joined room #general',
        data: { room: 'general' },
      })

      const res = await request(app)
        .post('/api/command')
        .send({ sessionId: 'test-session-uuid', command: '/join general' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.message).toBe('Joined room #general')
    })

    it('should return 400 when sessionId or command is missing', async () => {
      const res = await request(app)
        .post('/api/command')
        .send({ sessionId: 'test-session-uuid' })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe('sessionId and command are required')
    })

    it('should return 401 for invalid session', async () => {
      vi.mocked(connectionManager.getSession).mockReturnValue(undefined)

      const res = await request(app)
        .post('/api/command')
        .send({ sessionId: 'invalid-session', command: '/join general' })

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe('Invalid session')
    })

    it('should return 500 when command execution throws', async () => {
      vi.mocked(connectionManager.getSession).mockReturnValue(validSession)
      vi.mocked(chatHandler.handleInput).mockRejectedValue(new Error('Internal error'))

      const res = await request(app)
        .post('/api/command')
        .send({ sessionId: 'test-session-uuid', command: '/join general' })

      expect(res.status).toBe(500)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe('Failed to execute command')
    })
  })

  // --------------------------------------------------------------------------
  // Message Routes
  // --------------------------------------------------------------------------

  describe('POST /api/message', () => {
    const sessionInRoom = {
      sessionId: 'test-session-uuid',
      userId: 1,
      nickname: 'testuser',
      currentRoom: 'general',
      transport: 'http' as const,
      sendMessage: vi.fn(),
      createdAt: new Date(),
    }

    it('should send a message when in a room', async () => {
      vi.mocked(connectionManager.getSession).mockReturnValue(sessionInRoom)
      vi.mocked(chatHandler.handleInput).mockResolvedValue({
        success: true,
        message: 'Message sent',
      })

      const res = await request(app)
        .post('/api/message')
        .send({ sessionId: 'test-session-uuid', content: 'Hello, world!' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(chatHandler.handleInput).toHaveBeenCalledWith('test-session-uuid', 'Hello, world!')
    })

    it('should return 400 when content is missing', async () => {
      const res = await request(app)
        .post('/api/message')
        .send({ sessionId: 'test-session-uuid' })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe('sessionId and content are required')
    })

    it('should return 401 for invalid session', async () => {
      vi.mocked(connectionManager.getSession).mockReturnValue(undefined)

      const res = await request(app)
        .post('/api/message')
        .send({ sessionId: 'invalid-session', content: 'Hello!' })

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe('Invalid session')
    })

    it('should return 400 when user is not in a room', async () => {
      const sessionNotInRoom = { ...sessionInRoom, currentRoom: null }
      vi.mocked(connectionManager.getSession).mockReturnValue(sessionNotInRoom)

      const res = await request(app)
        .post('/api/message')
        .send({ sessionId: 'test-session-uuid', content: 'Hello!' })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe('You must join a room first')
    })

    it('should return 500 when message sending throws', async () => {
      vi.mocked(connectionManager.getSession).mockReturnValue(sessionInRoom)
      vi.mocked(chatHandler.handleInput).mockRejectedValue(new Error('DB write failed'))

      const res = await request(app)
        .post('/api/message')
        .send({ sessionId: 'test-session-uuid', content: 'Hello!' })

      expect(res.status).toBe(500)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe('Failed to send message')
    })
  })

  // --------------------------------------------------------------------------
  // Storage Stats
  // --------------------------------------------------------------------------

  describe('GET /api/storage', () => {
    it('should return storage statistics', async () => {
      const res = await request(app).get('/api/storage')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toEqual({
        totalMessages: 42,
        messagesPerRoom: [{ roomName: 'general', count: 42 }],
        tableSize: '16 kB',
      })
    })

    it('should return 500 when storage stats fail', async () => {
      vi.mocked(getStorageStats).mockRejectedValue(new Error('DB error'))

      const res = await request(app).get('/api/storage')

      expect(res.status).toBe(500)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toBe('Failed to get storage stats')
    })
  })
})
