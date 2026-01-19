/**
 * Shared state management for collaboration service.
 * Manages in-memory document states, client connections, and provides utility functions.
 */

import { WebSocket } from 'ws';
import type { ClientConnection, DocumentState } from './types.js';
import type { WSMessage } from '../../types/index.js';
import { activeDocumentsGauge, activeCollaboratorsGauge } from '../../shared/metrics.js';

/** In-memory cache of active document states for real-time collaboration */
export const documents = new Map<string, DocumentState>();

/** Map of WebSocket connections to their client metadata */
export const clients = new Map<WebSocket, ClientConnection>();

/** Timers for debounced database persistence per document */
export const persistTimers = new Map<string, NodeJS.Timeout>();

/**
 * Unique identifier for this server instance.
 * Used to filter out self-originated Redis pub/sub messages in multi-server deployments.
 */
export const serverId = Math.random().toString(36).substring(7);

/**
 * Returns current collaboration statistics for health checks.
 */
export function getCollaborationStats(): { activeDocuments: number; activeConnections: number } {
  return {
    activeDocuments: documents.size,
    activeConnections: clients.size,
  };
}

/**
 * Updates the collaborators gauge metric.
 */
export function updateCollaboratorsMetric(): void {
  activeCollaboratorsGauge.set(clients.size);
}

/**
 * Updates the active documents gauge metric.
 */
export function updateDocumentsMetric(): void {
  activeDocumentsGauge.set(documents.size);
}

/**
 * Sends a message to all clients connected to a specific document.
 * Optionally excludes a specific connection (typically the sender).
 *
 * @param documentId - The document UUID to broadcast to
 * @param message - The WebSocket message to send
 * @param exclude - Optional WebSocket connection to exclude from broadcast
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
