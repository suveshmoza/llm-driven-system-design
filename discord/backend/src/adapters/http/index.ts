/**
 * HTTP Server Adapter
 *
 * Provides a REST API and SSE (Server-Sent Events) interface for the chat system.
 * This adapter enables browser clients to connect using standard HTTP.
 *
 * Endpoints:
 * - GET  /health                 - Comprehensive health check
 * - GET  /metrics                - Prometheus metrics endpoint
 * - GET  /api/health             - Server health check (legacy)
 * - POST /api/connect            - Authenticate with nickname, get session token
 * - POST /api/disconnect         - End session
 * - POST /api/command            - Execute a slash command
 * - POST /api/message            - Send a chat message
 * - GET  /api/rooms              - List available rooms
 * - GET  /api/rooms/:room/history - Get room message history
 * - GET  /api/session/:sessionId - Get session details
 * - GET  /api/messages/:room     - SSE stream for real-time messages
 *
 * The SSE endpoint maintains a persistent connection for pushing messages
 * to the client, while commands use regular POST requests.
 */

import express from 'express';
import type { ChatMessage } from '../../types/index.js';
import { httpLogger } from '../../utils/logger.js';
import type { SSEClient, SSEManager } from './types.js';
import { applyMiddleware } from './middleware.js';
import { SSEHandler } from './sse-handler.js';
import { createAuthRoutes } from './auth-routes.js';
import { createRoomRoutes } from './room-routes.js';
import { createCommandRoutes } from './message-routes.js';
import { createObservabilityRoutes, createApiHealthRoutes } from './observability-routes.js';

/**
 * HTTP/REST server for Baby Discord.
 *
 * Implements the Adapter pattern to provide an HTTP interface over
 * the core chat functionality. Supports both REST endpoints for commands
 * and SSE for real-time message streaming.
 */
export class HTTPServer {
  /** Express application instance */
  private app: express.Application;
  /** Port to listen on */
  private port: number;
  /** Node.js HTTP server instance */
  private server: ReturnType<typeof express.application.listen> | null = null;
  /** SSE manager for tracking connections */
  private sseManager: SSEManager;
  /** SSE handler for SSE operations */
  private sseHandler: SSEHandler;

  /**
   * Create a new HTTP server.
   *
   * @param port - Port number to listen on (default: 3001)
   */
  constructor(port: number = 3001) {
    this.port = port;
    this.app = express();

    // Initialize SSE manager
    this.sseManager = {
      clients: new Map<string, SSEClient>(),
      isDraining: false,
    };

    // Initialize SSE handler
    this.sseHandler = new SSEHandler(this.sseManager);

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Configure Express middleware.
   * Sets up CORS, JSON parsing, and request logging.
   */
  private setupMiddleware(): void {
    applyMiddleware(this.app, this.sseManager);
  }

  /**
   * Set up API routes.
   * Registers all REST endpoints and the SSE stream.
   */
  private setupRoutes(): void {
    // Root-level observability routes (metrics, health)
    this.app.use('/', createObservabilityRoutes(this.sseManager));

    // API routes
    this.app.use('/api', createAuthRoutes(this.sseHandler));
    this.app.use('/api', createRoomRoutes());
    this.app.use('/api', createApiHealthRoutes(this.sseManager));
    this.app.use('/api', createCommandRoutes());
    this.app.use('/api', this.sseHandler.createRouter());
  }

  /**
   * Send a message to all SSE clients for a specific session.
   * Called by ConnectionManager when messages need to be delivered.
   *
   * @param sessionId - Target session's ID
   * @param message - Message string to send
   */
  sendSSEMessage(sessionId: string, message: string): void {
    this.sseHandler.sendSSEMessage(sessionId, message);
  }

  /**
   * Broadcast a message to all SSE clients in a specific room.
   * Used for room-wide announcements and messages.
   *
   * @param roomName - Target room name
   * @param message - Chat message to broadcast
   */
  broadcastToRoom(roomName: string, message: ChatMessage): void {
    this.sseHandler.broadcastToRoom(roomName, message);
  }

  /**
   * Start the HTTP server and begin accepting connections.
   *
   * @returns Promise that resolves when server is listening
   */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        httpLogger.info({ port: this.port }, 'HTTP Server listening');
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server and close all SSE connections gracefully.
   *
   * WHY Graceful Shutdown Prevents Message Loss:
   * - Allows in-flight requests to complete
   * - Sends shutdown notifications to connected SSE clients
   * - Ensures database writes are flushed
   * - Prevents abrupt connection termination that could lose messages
   *
   * @param gracePeriodMs - Time to wait for connections to close
   * @returns Promise that resolves when server is fully stopped
   */
  async stop(gracePeriodMs: number = 10000): Promise<void> {
    this.sseManager.isDraining = true;
    httpLogger.info('HTTP Server entering drain mode');

    // Shutdown SSE clients
    await this.sseHandler.shutdownClients(gracePeriodMs);

    // Close HTTP server
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          httpLogger.info('HTTP Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get the Express application instance.
   * Used for testing.
   *
   * @returns Express application
   */
  getApp(): express.Application {
    return this.app;
  }

  /**
   * Get the number of active SSE connections.
   *
   * @returns Number of SSE client connections
   */
  getSSEClientCount(): number {
    return this.sseManager.clients.size;
  }
}

export default HTTPServer;
