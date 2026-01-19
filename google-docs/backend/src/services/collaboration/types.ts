/**
 * Type definitions for the collaboration service.
 * Contains interfaces for WebSocket client connections and document state.
 */

import type { WebSocket } from 'ws';
import type { PresenceState, UserPublic, Operation } from '../../types/index.js';

/**
 * Represents a connected WebSocket client with their session info.
 * Tracks which document they are currently viewing and activity timestamp.
 */
export interface ClientConnection {
  ws: WebSocket;
  user: UserPublic;
  documentId: string | null;
  lastActivity: number;
}

/**
 * In-memory state for an active document being edited.
 * Contains the current version, operation log for OT, and connected users' presence.
 */
export interface DocumentState {
  version: number;
  operationLog: Operation[][];
  presence: Map<string, PresenceState>;
}

/**
 * Redis pub/sub message for cross-server operation broadcast.
 */
export interface RedisOperationMessage {
  serverId: string;
  docId: string;
  version: number;
  operation: Operation[];
  userId: string;
  userName: string;
}

/**
 * Redis pub/sub message for cross-server presence broadcast.
 */
export interface RedisPresenceMessage {
  serverId: string;
  docId: string;
  presence: PresenceState;
}
