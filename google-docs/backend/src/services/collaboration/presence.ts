/**
 * User presence tracking for collaborative editing.
 * Manages online users, broadcasts presence updates, and handles users joining/leaving.
 */

import type { WebSocket } from 'ws';
import type { ClientConnection, DocumentState } from './types.js';
import type { PresenceState } from '../../types/index.js';
import { redisPub } from '../../utils/redis.js';
import logger from '../../shared/logger.js';
import { documents, clients, serverId, broadcastToDocument, updateDocumentsMetric } from './state.js';

/**
 * Creates a presence state object for a user joining a document.
 */
export function createPresenceState(user: ClientConnection['user']): PresenceState {
  return {
    user_id: user.id,
    name: user.name,
    color: user.avatar_color,
    cursor: null,
    selection: null,
    last_active: Date.now(),
  };
}

/**
 * Adds a user to a document's presence map and broadcasts their arrival.
 */
export function addUserToDocument(
  documentId: string,
  docState: DocumentState,
  user: ClientConnection['user']
): PresenceState {
  const presence = createPresenceState(user);
  docState.presence.set(user.id, presence);
  broadcastPresence(documentId, presence);
  return presence;
}

/**
 * Handles a client leaving/unsubscribing from a document.
 * Removes their presence from the document state.
 * Broadcasts departure to other users in the document.
 */
export function handleLeaveDocument(ws: WebSocket, documentId: string): void {
  const client = clients.get(ws);
  if (!client) return;

  const docState = documents.get(documentId);
  if (docState) {
    docState.presence.delete(client.user.id);

    logger.debug({
      userId: client.user.id,
      documentId,
      remainingUsers: docState.presence.size,
    }, 'User left document');

    // Broadcast user left
    broadcastToDocument(documentId, {
      type: 'PRESENCE',
      data: {
        user_id: client.user.id,
        left: true,
      },
    }, ws);

    // Clean up empty document states
    if (docState.presence.size === 0) {
      documents.delete(documentId);
      updateDocumentsMetric();
    }
  }

  client.documentId = null;
}

/**
 * Broadcasts a presence update to all clients in a document.
 * Also publishes to Redis for cross-server notification.
 */
export function broadcastPresence(documentId: string, presence: PresenceState): void {
  broadcastToDocument(documentId, {
    type: 'PRESENCE',
    data: presence,
  }, null);

  redisPub.publish('doc:presence', JSON.stringify({
    serverId,
    docId: documentId,
    presence,
  })).catch((error) => {
    logger.trace({ error, documentId }, 'Failed to publish presence to Redis');
  });
}

/**
 * Returns the current list of online users for a document.
 * Used for displaying presence indicators in the UI.
 */
export function getDocumentPresence(documentId: string): PresenceState[] {
  const docState = documents.get(documentId);
  if (!docState) return [];
  return Array.from(docState.presence.values());
}
