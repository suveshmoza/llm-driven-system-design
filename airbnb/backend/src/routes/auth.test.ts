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
    get: vi.fn(),
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

// Mock auth service
vi.mock('../services/auth.js', () => ({
  createSession: vi.fn().mockResolvedValue({
    sessionId: 'test-session-id',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  }),
  deleteSession: vi.fn().mockResolvedValue(undefined),
  getSession: vi.fn().mockResolvedValue(null),
  hashPassword: vi.fn().mockResolvedValue('hashed-password'),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

// Mock auth middleware
vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn((req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = {
      id: 1,
      email: 'test@example.com',
      name: 'Test User',
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

// Mock shared modules
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
import { verifyPassword } from '../services/auth.js';
import authRoutes from './auth.js';

const mockQuery = vi.mocked(query);
const mockVerifyPassword = vi.mocked(verifyPassword);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  return app;
}

describe('Auth Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }) // no existing user
        .mockResolvedValueOnce({
          rows: [{ id: 1, email: 'new@example.com', name: 'New User', is_host: false, role: 'user' }],
          rowCount: 1,
          command: 'INSERT',
          oid: 0,
          fields: [],
        });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'new@example.com', password: 'password123', name: 'New User' });

      expect(res.status).toBe(201);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('new@example.com');
      expect(res.body.user.name).toBe('New User');
    });

    it('should return 400 if required fields are missing', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'new@example.com' }); // missing password and name

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Email, password, and name are required');
    });

    it('should return 400 if email already registered', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1 }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'existing@example.com', password: 'password123', name: 'Existing User' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Email already registered');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login successfully with valid credentials', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 1,
          email: 'test@example.com',
          name: 'Test User',
          password_hash: 'hashed',
          is_host: false,
          is_verified: false,
          role: 'user',
          avatar_url: null,
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      mockVerifyPassword.mockResolvedValueOnce(true);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('test@example.com');
      // Should set session cookie
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('should return 400 if email or password is missing', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Email and password are required');
    });

    it('should return 401 for invalid credentials', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 1,
          email: 'test@example.com',
          name: 'Test User',
          password_hash: 'hashed',
          is_host: false,
          is_verified: false,
          role: 'user',
          avatar_url: null,
        }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
      mockVerifyPassword.mockResolvedValueOnce(false);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'wrong' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid credentials');
    });

    it('should return 401 if user does not exist', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nonexistent@example.com', password: 'password123' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid credentials');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return the current authenticated user', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', 'session=test-session-id');

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.id).toBe(1);
      expect(res.body.user.email).toBe('test@example.com');
    });
  });

  describe('POST /api/auth/become-host', () => {
    it('should upgrade user to host', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'UPDATE',
        oid: 0,
        fields: [],
      });

      const res = await request(app)
        .post('/api/auth/become-host')
        .set('Cookie', 'session=test-session-id');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('You are now a host');
      expect(res.body.is_host).toBe(true);
    });
  });
});
