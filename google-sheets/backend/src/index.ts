/**
 * Main entry point for the Google Sheets backend server.
 * Sets up Express HTTP server with WebSocket support for real-time collaboration.
 * Configures CORS, JSON parsing, and API routes.
 *
 * @module index
 */

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import apiRoutes from './api/routes.js';
import { setupWebSocket } from './websocket/server.js';

const app = express();

/** Server port, configurable via PORT environment variable */
const PORT = parseInt(process.env.PORT || '3001');

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

/**
 * Health check endpoint for monitoring and load balancer probes.
 * Returns service name and status.
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'google-sheets' });
});

// API routes
app.use('/api', apiRoutes);

// Create HTTP server
const server = createServer(app);

// Setup WebSocket
setupWebSocket(server);

// Start server
server.listen(PORT, () => {
  console.log(`Google Sheets server running on port ${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
});
