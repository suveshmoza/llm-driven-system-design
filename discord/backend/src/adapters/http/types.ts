/**
 * Shared types for HTTP server adapter
 */

import type { Response } from 'express';

/**
 * Internal state for tracking an SSE client connection.
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
 * Configuration for the HTTP server
 */
export interface HTTPServerConfig {
  /** Port to listen on */
  port: number;
}

/**
 * SSE Manager interface for managing SSE client connections
 */
export interface SSEManager {
  /** Map of client ID to SSE client */
  clients: Map<string, SSEClient>;
  /** Whether server is draining connections */
  isDraining: boolean;
}

/**
 * Extended Request type with request ID
 */
export interface RequestWithId {
  requestId?: string;
}
