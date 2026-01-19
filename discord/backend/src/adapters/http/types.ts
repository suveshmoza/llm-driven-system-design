/**
 * Shared types for HTTP server adapter
 *
 * @description This module defines TypeScript interfaces used across the HTTP adapter layer,
 * including SSE client tracking, server configuration, and request extensions.
 * @module adapters/http/types
 */

import type { Response } from 'express';

/**
 * Internal state for tracking an SSE (Server-Sent Events) client connection.
 *
 * @description Represents an active SSE connection from a browser client.
 * Each SSE client is associated with a user session and subscribed to a specific room
 * to receive real-time message updates.
 *
 * @interface SSEClient
 * @property {string} sessionId - Unique session identifier linking this SSE connection to a user session
 * @property {Response} res - Express response object used to write SSE events to the client
 * @property {string} room - Name of the chat room this connection is subscribed to
 */
export interface SSEClient {
  /** Session ID of the connected user */
  sessionId: string;
  /** Express response object for the SSE stream */
  res: Response;
  /** Room name this connection is subscribed to */
  room: string;
}

/**
 * Configuration options for the HTTP server.
 *
 * @description Contains all configurable parameters for initializing the HTTP server.
 *
 * @interface HTTPServerConfig
 * @property {number} port - TCP port number the server will listen on
 */
export interface HTTPServerConfig {
  /** Port to listen on */
  port: number;
}

/**
 * Manager interface for handling SSE client connections across the server.
 *
 * @description Provides centralized tracking of all active SSE connections and
 * the server's draining state for graceful shutdown handling. The clients map
 * uses a composite key of "{sessionId}-{roomName}" to uniquely identify each connection.
 *
 * @interface SSEManager
 * @property {Map<string, SSEClient>} clients - Map from client ID (sessionId-room) to SSE client object
 * @property {boolean} isDraining - Indicates whether the server is in graceful shutdown mode
 */
export interface SSEManager {
  /** Map of client ID to SSE client */
  clients: Map<string, SSEClient>;
  /** Whether server is draining connections */
  isDraining: boolean;
}

/**
 * Extension interface for Express Request objects with request tracking.
 *
 * @description Extends the base Express Request type to include a unique request ID
 * for distributed tracing and log correlation. Applied by the request logging middleware.
 *
 * @interface RequestWithId
 * @property {string} [requestId] - Unique identifier for the HTTP request, used for tracing
 */
export interface RequestWithId {
  requestId?: string;
}
