/**
 * Cursor position handling for collaborative editing.
 * Manages cursor and selection updates between clients.
 */

import type { WebSocket } from 'ws';
import type { ClientConnection } from './types.js';
import type { WSMessage } from '../../types/index.js';
import { redisPub } from '../../utils/redis.js';
import logger from '../../shared/logger.js';
import { documents, serverId, broadcastToDocument } from './state.js';

/**
 * Handles cursor/selection updates from a client.
 * Updates the client's presence state and broadcasts to others.
 * Published via Redis for cross-server visibility.
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
 * Alias for handleCursor as they share the same logic.
 */
export const handlePresence = handleCursor;
