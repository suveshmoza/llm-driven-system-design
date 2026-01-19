import { WebSocket } from 'ws';
import { AuthenticatedSocket } from './types.js';

/**
 * Connection Manager Module
 *
 * Manages the in-memory map of userId to their active WebSocket connection
 * on this server. Used for local message delivery before falling back to
 * Redis pub/sub for cross-server communication.
 */

/**
 * Map of userId to their active WebSocket connection on this server.
 */
const connections = new Map<string, AuthenticatedSocket>();

/**
 * Stores a user's WebSocket connection.
 *
 * @param userId - The user's ID
 * @param socket - The authenticated WebSocket connection
 */
export function addConnection(userId: string, socket: AuthenticatedSocket): void {
  connections.set(userId, socket);
}

/**
 * Removes a user's WebSocket connection.
 *
 * @param userId - The user's ID
 */
export function removeConnection(userId: string): void {
  connections.delete(userId);
}

/**
 * Gets a user's WebSocket connection if they're connected to this server.
 *
 * @param userId - The user's ID
 * @returns The WebSocket connection or undefined if not connected
 */
export function getConnection(userId: string): AuthenticatedSocket | undefined {
  return connections.get(userId);
}

/**
 * Returns the number of active WebSocket connections on this server.
 * Used for health checks and load monitoring.
 *
 * @returns The count of connected users
 */
export function getConnectionCount(): number {
  return connections.size;
}

/**
 * Iterates over all active connections.
 *
 * @returns Iterator of [userId, socket] entries
 */
export function getAllConnections(): IterableIterator<[string, AuthenticatedSocket]> {
  return connections.entries();
}

/**
 * Safely sends a message to a WebSocket connection.
 * Checks connection state before sending to avoid errors.
 *
 * @param socket - The WebSocket to send to
 * @param message - The message object to serialize and send
 */
export function sendToSocket(socket: WebSocket, message: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

/**
 * Sends a message to a user if they're connected to this server.
 *
 * @param userId - The user's ID
 * @param message - The message to send
 * @returns true if the message was sent, false if user not connected
 */
export function sendToUser(userId: string, message: unknown): boolean {
  const socket = connections.get(userId);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
    return true;
  }
  return false;
}
