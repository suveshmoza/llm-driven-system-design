/**
 * Backend Server Entry Point
 *
 * Initializes and starts the Express HTTP server with WebSocket support.
 * Sets up API routes, middleware, and the WebSocket gateway for real-time
 * communication. Handles graceful shutdown on SIGTERM/SIGINT.
 *
 * @module index
 */

import express from 'express';
import cors from 'cors';
import http from 'http';
import dotenv from 'dotenv';

import streamRoutes from './routes/streams.js';
import userRoutes from './routes/users.js';
import { WebSocketGateway } from './services/wsGateway.js';

dotenv.config();

/** Express application instance */
const app = express();

/** Server port from environment or default to 3001 */
const PORT = parseInt(process.env.PORT || '3001', 10);

// Middleware
app.use(cors());
app.use(express.json());

/**
 * Health check endpoint for load balancer and monitoring.
 * Returns current server status and timestamp.
 */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/streams', streamRoutes);
app.use('/api/users', userRoutes);

/** HTTP server instance (used by both Express and WebSocket) */
const server = http.createServer(app);

/** WebSocket gateway for real-time communication */
const wsGateway = new WebSocketGateway(server);

/**
 * Real-time viewer count endpoint.
 * Provides current viewer count from WebSocket connections.
 */
app.get('/api/streams/:streamId/viewers', (req, res) => {
  const count = wsGateway.getViewerCount(req.params.streamId);
  res.json({ stream_id: req.params.streamId, viewer_count: count });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
});

/**
 * Graceful shutdown handler for SIGTERM.
 * Closes the server and waits for existing connections to complete.
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

/**
 * Graceful shutdown handler for SIGINT (Ctrl+C).
 * Closes the server and waits for existing connections to complete.
 */
process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export { app, server, wsGateway };
