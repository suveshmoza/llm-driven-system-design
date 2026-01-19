/**
 * Document synchronization operations for collaborative editing.
 * Handles subscribing to documents and syncing document state.
 */

import type { WebSocket } from 'ws';
import type { ClientConnection, DocumentState } from './types.js';
import logger, { createChildLogger } from '../../shared/logger.js';
import { documents, updateDocumentsMetric } from './state.js';
import { handleLeaveDocument, addUserToDocument } from './presence.js';
import { checkDocumentPermission, hasAccess, getEffectivePermission } from './permissions.js';

/**
 * Initializes document state if not already cached.
 * Returns the document state (existing or newly created).
 */
export function ensureDocumentState(documentId: string, currentVersion: number): DocumentState {
  if (!documents.has(documentId)) {
    documents.set(documentId, {
      version: currentVersion,
      operationLog: [],
      presence: new Map(),
    });
    updateDocumentsMetric();
  }
  return documents.get(documentId)!;
}

/**
 * Handles a client subscribing to a document for real-time updates.
 * Verifies document access permission before allowing subscription.
 * Initializes document state if not already cached.
 * Sends sync message with current document content and online users.
 */
export async function handleSubscribe(
  ws: WebSocket,
  client: ClientConnection,
  documentId: string
): Promise<void> {
  const opLogger = createChildLogger({
    userId: client.user.id,
    documentId,
    action: 'subscribe',
  });

  // Check permission
  const permResult = await checkDocumentPermission(documentId, client.user.id);

  if (!permResult.found) {
    opLogger.warn('Subscribe failed: document not found');
    ws.send(JSON.stringify({ type: 'ERROR', code: 'NOT_FOUND', error: 'Document not found' }));
    return;
  }

  if (!hasAccess(client.user.id, permResult.ownerId!, permResult.permissionLevel || null)) {
    opLogger.warn('Subscribe failed: access denied');
    ws.send(JSON.stringify({ type: 'ERROR', code: 'ACCESS_DENIED', error: 'Access denied' }));
    return;
  }

  // Leave previous document if any
  if (client.documentId) {
    handleLeaveDocument(ws, client.documentId);
  }

  // Join new document
  client.documentId = documentId;

  // Initialize document state if not exists
  const docState = ensureDocumentState(documentId, permResult.currentVersion!);

  // Add user to presence
  const presence = addUserToDocument(documentId, docState, client.user);

  opLogger.info({
    version: docState.version,
    activeUsers: docState.presence.size,
  }, 'User subscribed to document');

  // Send sync message with current document state
  ws.send(JSON.stringify({
    type: 'SYNC',
    doc_id: documentId,
    version: docState.version,
    data: {
      content: permResult.content,
      presence: Array.from(docState.presence.values()),
      permission_level: getEffectivePermission(
        client.user.id,
        permResult.ownerId!,
        permResult.permissionLevel || null
      ),
    },
  }));
}
