/**
 * Main entry point for the Google Docs clone backend server.
 * Configures Express middleware, mounts API routes, and initializes WebSocket server.
 * Supports running multiple instances for load balancing via PORT environment variable.
 */

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import authRoutes from './routes/auth.js';
import documentsRoutes from './routes/documents.js';
import versionsRoutes from './routes/versions.js';
import commentsRoutes from './routes/comments.js';
import suggestionsRoutes from './routes/suggestions.js';
import { initWebSocket } from './services/collaboration.js';

/** Express application instance */
const app = express();

/** Server port, configurable for running multiple instances */
const port = parseInt(process.env.PORT || '3001');

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

/**
 * Health check endpoint for load balancer monitoring.
 * Returns server identifier to verify which instance handled the request.
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', server: `server-${port}` });
});

/** Mount API route handlers under /api prefix */
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/documents', versionsRoutes);
app.use('/api/documents', commentsRoutes);
app.use('/api/documents', suggestionsRoutes);

/**
 * Global error handler for uncaught exceptions in routes.
 * Logs error details and returns generic error response.
 */
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

/** HTTP server instance for Express and WebSocket */
const server = createServer(app);

/** WebSocket server for real-time collaboration, mounted at /ws path */
const wss = new WebSocketServer({ server, path: '/ws' });

/** Initialize WebSocket handlers for document collaboration */
initWebSocket(wss);

/** Start the HTTP server and log connection details */
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(`WebSocket server on ws://localhost:${port}/ws`);
});

/**
 * Graceful shutdown handler for SIGTERM signal.
 * Closes HTTP server and waits for connections to drain before exiting.
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
