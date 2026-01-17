/**
 * FaceTime Backend Server Entry Point
 *
 * This module bootstraps the Express HTTP server with WebSocket support
 * for real-time video calling signaling. It initializes database and Redis
 * connections, mounts REST API routes, and configures the WebSocket server
 * for call signaling.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import { testConnection } from './db/index.js';
import { getRedisClient } from './services/redis.js';
import { setupWebSocketServer, getOnlineUsers, getClientCount } from './services/signaling.js';
import usersRouter from './routes/users.js';
import callsRouter from './routes/calls.js';

/** Express application instance */
const app = express();

/** Server port from environment or default 3001 */
const PORT = parseInt(process.env.PORT || '3001');

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(helmet({
  contentSecurityPolicy: false, // Disable for WebSocket compatibility
}));
app.use(morgan('dev'));
app.use(express.json());

/**
 * Health check endpoint.
 * Returns database and Redis connection status for monitoring.
 */
app.get('/health', async (req, res) => {
  const dbOk = await testConnection();
  let redisOk = false;

  try {
    const redis = await getRedisClient();
    await redis.ping();
    redisOk = true;
  } catch {
    redisOk = false;
  }

  res.json({
    status: dbOk && redisOk ? 'healthy' : 'degraded',
    database: dbOk ? 'connected' : 'disconnected',
    redis: redisOk ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Stats endpoint.
 * Returns current online users and total WebSocket connection count.
 */
app.get('/stats', (req, res) => {
  res.json({
    onlineUsers: getOnlineUsers(),
    totalConnections: getClientCount(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * TURN/STUN credentials endpoint.
 * Returns ICE server configuration for WebRTC peer connections.
 * In production, this would generate time-limited credentials.
 */
app.get('/turn-credentials', (req, res) => {
  // In production, generate time-limited credentials
  res.json({
    iceServers: [
      // Google's public STUN servers
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      // Local coturn TURN server
      {
        urls: process.env.TURN_URL || 'turn:localhost:3478',
        username: process.env.TURN_USERNAME || 'facetime',
        credential: process.env.TURN_CREDENTIAL || 'facetime123',
      },
    ],
  });
});

// API routes
app.use('/api/users', usersRouter);
app.use('/api/calls', callsRouter);

/** HTTP server wrapping Express for WebSocket support */
const server = createServer(app);

/**
 * WebSocket server for real-time signaling.
 * Handles call initiation, answering, and WebRTC offer/answer exchange.
 */
const wss = new WebSocketServer({
  server,
  path: '/ws',
});

// Setup WebSocket handling
setupWebSocketServer(wss);

/**
 * Starts the server after verifying database and Redis connectivity.
 * Logs connection status and server URLs on successful startup.
 */
async function start() {
  try {
    // Test database connection
    const dbOk = await testConnection();
    if (!dbOk) {
      console.error('Failed to connect to database. Make sure PostgreSQL is running.');
      console.log('Run: docker-compose up -d postgres');
    }

    // Test Redis connection
    try {
      await getRedisClient();
    } catch (error) {
      console.error('Failed to connect to Redis. Make sure Redis is running.');
      console.log('Run: docker-compose up -d redis');
    }

    server.listen(PORT, () => {
      console.log(`\n=================================`);
      console.log(`FaceTime Signaling Server`);
      console.log(`=================================`);
      console.log(`HTTP Server: http://localhost:${PORT}`);
      console.log(`WebSocket: ws://localhost:${PORT}/ws`);
      console.log(`Health: http://localhost:${PORT}/health`);
      console.log(`Stats: http://localhost:${PORT}/stats`);
      console.log(`=================================\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
