/**
 * @fileoverview Shared state management for collaboration service.
 * @description Manages in-memory document states, client connections, and provides
 * utility functions for broadcasting messages and tracking metrics.
 * @module services/collaboration/state
 */

import { WebSocket } from 'ws';
import type { ClientConnection, DocumentState } from './types.js';
import type { WSMessage } from '../../types/index.js';
import { activeDocumentsGauge, activeCollaboratorsGauge } from '../../shared/metrics.js';

/**
 * In-memory cache of active document states for real-time collaboration.
 *
 * @description Stores DocumentState objects keyed by document UUID. Only documents
 * with active collaborators are cached. Cleaned up when the last user leaves.
 *
 * @type {Map<string, DocumentState>}
 */
export const documents = new Map<string, DocumentState>();

/**
 * Map of WebSocket connections to their client metadata.
 *
 * @description Tracks all authenticated WebSocket connections and their associated
 * user info, current document subscription, and last activity timestamp.
 *
 * @type {Map<WebSocket, ClientConnection>}
 */
export const clients = new Map<WebSocket, ClientConnection>();

/**
 * Timers for debounced database persistence per document.
 *
 * @description Stores active debounce timers keyed by document UUID. Used to batch
 * rapid edits and reduce database write frequency.
 *
 * @type {Map<string, NodeJS.Timeout>}
 */
export const persistTimers = new Map<string, NodeJS.Timeout>();

/**
 * Unique identifier for this server instance.
 *
 * @description Used to filter out self-originated Redis pub/sub messages in
 * multi-server deployments. Generated randomly on server startup.
 *
 * @type {string}
 *
 * @example
 * // When receiving Redis message, skip if from self
 * if (message.serverId === serverId) return;
 */
export const serverId = Math.random().toString(36).substring(7);

/**
 * Returns current collaboration statistics for health checks.
 *
 * @description Provides a snapshot of active collaboration state including the
 * number of documents being edited and total connected clients.
 *
 * @returns {{ activeDocuments: number; activeConnections: number }} Object with active document and connection counts
 *
 * @example
 * const stats = getCollaborationStats();
 * console.log(`${stats.activeDocuments} documents, ${stats.activeConnections} users`);
 */
export function getCollaborationStats(): { activeDocuments: number; activeConnections: number } {
  return {
    activeDocuments: documents.size,
    activeConnections: clients.size,
  };
}

/**
 * Updates the collaborators gauge metric.
 *
 * @description Sets the Prometheus gauge to the current number of connected clients.
 * Called when clients connect or disconnect.
 *
 * @returns {void}
 */
export function updateCollaboratorsMetric(): void {
  activeCollaboratorsGauge.set(clients.size);
}

/**
 * Updates the active documents gauge metric.
 *
 * @description Sets the Prometheus gauge to the current number of active documents.
 * Called when documents are created or cleaned up.
 *
 * @returns {void}
 */
export function updateDocumentsMetric(): void {
  activeDocumentsGauge.set(documents.size);
}

/**
 * Sends a message to all clients connected to a specific document.
 *
 * @description Broadcasts a WebSocket message to all clients subscribed to the
 * specified document. Optionally excludes a specific connection (typically the
 * sender to avoid echo). Only sends to connections in OPEN state.
 *
 * @param {string} documentId - The document UUID to broadcast to
 * @param {WSMessage} message - The WebSocket message object to send (will be JSON-stringified)
 * @param {WebSocket | null} exclude - Optional WebSocket connection to exclude from broadcast
 * @returns {void}
 *
 * @example
 * // Broadcast operation to all clients in document
 * broadcastToDocument('doc-456', {
 *   type: 'OPERATION',
 *   version: 43,
 *   operation: [{ type: 'insert', pos: 10, text: 'Hello' }],
 * }, senderWebSocket);
 *
 * @example
 * // Broadcast to all clients including sender
 * broadcastToDocument('doc-456', { type: 'PRESENCE', data: presence }, null);
 */
export function broadcastToDocument(
  documentId: string,
  message: WSMessage,
  exclude: WebSocket | null
): void {
  const messageStr = JSON.stringify(message);

  for (const [ws, client] of clients) {
    if (client.documentId === documentId && ws !== exclude && ws.readyState === WebSocket.OPEN) {
      ws.send(messageStr);
    }
  }
}
