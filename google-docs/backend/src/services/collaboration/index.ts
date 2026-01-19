/**
 * @fileoverview Main entry point for the collaboration service.
 * @description Combines all collaboration modules and initializes the WebSocket server.
 * Handles client connections, authentication, message routing, and Redis pub/sub
 * for cross-server communication in distributed deployments.
 * @module services/collaboration
 */

import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { parse as parseUrl } from 'url';
import redis, { redisSub } from '../../utils/redis.js';
import type { WSMessage, UserPublic } from '../../types/index.js';
import logger, { createChildLogger } from '../../shared/logger.js';
import { recordCacheAccess } from '../../shared/metrics.js';

// Import from submodules
import {
  clients,
  serverId,
  broadcastToDocument,
  updateCollaboratorsMetric,
  getCollaborationStats as _getCollaborationStats,
} from './state.js';
import { handleOperation } from './ot.js';
import { handleLeaveDocument, getDocumentPresence as _getDocumentPresence } from './presence.js';
import { handleSubscribe } from './sync.js';
import { handleCursor, handlePresence } from './cursors.js';

// Re-export public API
export { getCollaborationStats } from './state.js';
export { getDocumentPresence } from './presence.js';

/**
 * Routes incoming WebSocket messages to appropriate handlers.
 *
 * @description Parses the incoming message and dispatches to the correct handler
 * based on message type. Updates the client's last activity timestamp to prevent
 * timeout disconnection. Handles errors gracefully by sending error messages back.
 *
 * @param {WebSocket} ws - The WebSocket connection that sent the message
 * @param {string} message - The raw JSON message string from the client
 * @returns {Promise<void>} Resolves when message handling is complete
 *
 * @example
 * // Message routing:
 * // { type: 'SUBSCRIBE', doc_id: 'doc-456' } -> handleSubscribe()
 * // { type: 'OPERATION', operation: [...] } -> handleOperation()
 * // { type: 'CURSOR', cursor: { pos: 42 } } -> handleCursor()
 */
async function handleMessage(ws: WebSocket, message: string): Promise<void> {
  const client = clients.get(ws);
  if (!client) return;

  client.lastActivity = Date.now();

  try {
    const msg: WSMessage = JSON.parse(message);

    switch (msg.type) {
      case 'SUBSCRIBE':
        await handleSubscribe(ws, client, msg.doc_id!);
        break;

      case 'UNSUBSCRIBE':
        if (client.documentId) {
          handleLeaveDocument(ws, client.documentId);
        }
        break;

      case 'OPERATION':
        await handleOperation(ws, client, msg);
        break;

      case 'CURSOR':
        handleCursor(ws, client, msg);
        break;

      case 'PRESENCE':
        handlePresence(ws, client, msg);
        break;

      default:
        ws.send(JSON.stringify({ type: 'ERROR', error: 'Unknown message type' }));
    }
  } catch (error) {
    logger.error({ error, userId: client.user.id }, 'Message handling error');
    ws.send(JSON.stringify({ type: 'ERROR', error: 'Invalid message format' }));
  }
}

/**
 * Initializes the WebSocket server for real-time collaboration.
 *
 * @description Sets up the complete WebSocket infrastructure including:
 * - Redis pub/sub subscription for cross-server operation and presence sync
 * - Connection handling with session-based authentication
 * - Message routing to appropriate handlers
 * - Connection lifecycle management (connect, disconnect, error)
 * - Inactive connection cleanup (60 second timeout, checked every 30 seconds)
 *
 * @param {WebSocketServer} wss - The WebSocket server instance to initialize
 * @returns {void}
 *
 * @example
 * import { WebSocketServer } from 'ws';
 * import { createServer } from 'http';
 *
 * const server = createServer(app);
 * const wss = new WebSocketServer({ server });
 * initWebSocket(wss);
 *
 * server.listen(3000, () => {
 *   console.log('Server with WebSocket support started');
 * });
 *
 * @example
 * // Client connection URL with authentication token
 * // ws://localhost:3000?token=session-abc123
 */
export function initWebSocket(wss: WebSocketServer): void {
  logger.info({ serverId }, 'WebSocket server initialized');

  // Subscribe to Redis channels for cross-server communication
  redisSub.subscribe('doc:operations', 'doc:presence');

  redisSub.on('message', (channel, message) => {
    try {
      const data = JSON.parse(message);

      // Ignore our own messages
      if (data.serverId === serverId) return;

      if (channel === 'doc:operations') {
        broadcastToDocument(data.docId, {
          type: 'OPERATION',
          version: data.version,
          operation: data.operation,
          data: { userId: data.userId, userName: data.userName },
        }, null);
      } else if (channel === 'doc:presence') {
        broadcastToDocument(data.docId, {
          type: 'PRESENCE',
          data: data.presence,
        }, null);
      }
    } catch (error) {
      logger.error({ error, channel }, 'Redis message parsing error');
    }
  });

  wss.on('connection', async (ws: WebSocket, request: IncomingMessage) => {
    const connectionId = Math.random().toString(36).substring(7);
    const connLogger = createChildLogger({ connectionId });

    connLogger.debug('New WebSocket connection attempt');

    // Parse token from query string
    const url = parseUrl(request.url || '', true);
    const token = url.query.token as string;

    if (!token) {
      connLogger.warn('Connection rejected: no token');
      ws.close(4001, 'Authentication required');
      return;
    }

    // Validate token
    const sessionData = await redis.get(`session:${token}`);

    if (!sessionData) {
      recordCacheAccess('session', false);
      connLogger.warn('Connection rejected: invalid session');
      ws.close(4001, 'Invalid session');
      return;
    }

    recordCacheAccess('session', true);
    const user = JSON.parse(sessionData) as UserPublic;

    connLogger.info({ userId: user.id, userName: user.name }, 'WebSocket authenticated');

    // Register client
    clients.set(ws, {
      ws,
      user,
      documentId: null,
      lastActivity: Date.now(),
    });

    // Update metrics
    updateCollaboratorsMetric();

    // Handle messages
    ws.on('message', (data) => handleMessage(ws, data.toString()));

    ws.on('close', () => {
      const client = clients.get(ws);
      if (client?.documentId) {
        handleLeaveDocument(ws, client.documentId);
      }
      clients.delete(ws);
      updateCollaboratorsMetric();

      connLogger.info({ userId: user.id }, 'WebSocket disconnected');
    });

    ws.on('error', (error) => {
      connLogger.error({ error: error.message }, 'WebSocket error');
    });

    // Send welcome message
    ws.send(JSON.stringify({ type: 'CONNECTED', data: { userId: user.id } }));
  });

  // Cleanup inactive connections every 30 seconds
  setInterval(() => {
    const now = Date.now();
    for (const [ws, client] of clients) {
      if (now - client.lastActivity > 60000) {
        logger.debug({ userId: client.user.id }, 'Closing inactive connection');
        ws.close(4002, 'Inactive');
      }
    }
  }, 30000);
}
