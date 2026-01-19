/**
 * @fileoverview Cursor position handling for collaborative editing.
 * @description Manages cursor and selection updates between clients, enabling real-time
 * visibility of where each collaborator is working in the document.
 * @module services/collaboration/cursors
 */

import type { WebSocket } from 'ws';
import type { ClientConnection } from './types.js';
import type { WSMessage } from '../../types/index.js';
import { redisPub } from '../../utils/redis.js';
import logger from '../../shared/logger.js';
import { documents, serverId, broadcastToDocument } from './state.js';

/**
 * Handles cursor/selection updates from a client.
 *
 * @description Updates the client's presence state with new cursor position and/or
 * selection range, then broadcasts the update to all other clients in the document.
 * Also publishes via Redis for cross-server visibility in distributed deployments.
 *
 * @param {WebSocket} ws - The WebSocket connection of the client sending the update
 * @param {ClientConnection} client - The client metadata including user info and current document
 * @param {WSMessage} msg - The WebSocket message containing cursor and/or selection data
 * @returns {void}
 *
 * @example
 * // Handle incoming cursor update message
 * const msg = {
 *   type: 'CURSOR',
 *   cursor: { pos: 42, line: 3, column: 15 },
 *   selection: { start: 42, end: 50 },
 * };
 * handleCursor(clientWebSocket, clientConnection, msg);
 */
export function handleCursor(ws: WebSocket, client: ClientConnection, msg: WSMessage): void {
  const documentId = client.documentId;
  if (!documentId) return;

  const docState = documents.get(documentId);
  if (!docState) return;

  const presence = docState.presence.get(client.user.id);
  if (!presence) return;

  if (msg.cursor) {
    presence.cursor = msg.cursor;
  }
  if (msg.selection) {
    presence.selection = msg.selection;
  }
  presence.last_active = Date.now();

  // Broadcast to other clients
  broadcastToDocument(documentId, {
    type: 'CURSOR',
    data: presence,
  }, ws);

  // Publish to Redis for other servers (fire and forget, no circuit breaker for presence)
  redisPub.publish('doc:presence', JSON.stringify({
    serverId,
    docId: documentId,
    presence,
  })).catch((error) => {
    logger.trace({ error, documentId }, 'Failed to publish cursor to Redis');
  });
}

/**
 * Handles presence updates (cursor + selection combined).
 *
 * @description Alias for handleCursor as they share the same logic. Both message types
 * (CURSOR and PRESENCE) can contain cursor and selection updates and are processed identically.
 *
 * @param {WebSocket} ws - The WebSocket connection of the client sending the update
 * @param {ClientConnection} client - The client metadata including user info and current document
 * @param {WSMessage} msg - The WebSocket message containing presence data
 * @returns {void}
 *
 * @see handleCursor
 */
export const handlePresence = handleCursor;
