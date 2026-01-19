import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { parse as parseCookie } from 'cookie';
import { config } from '../config.js';
import { redis, redisSub, KEYS } from '../redis.js';
import { setUserPresence } from '../services/userService.js';
import { getPendingMessagesForUser } from '../services/messageService.js';
import { WSMessage } from '../types/index.js';
import { createServiceLogger, LogEvents, logEvent } from '../shared/logger.js';
import { websocketConnections, websocketEvents } from '../shared/metrics.js';
import { withRedisCircuit } from '../shared/circuitBreaker.js';
import { recordDelivery, idempotentStatusUpdate } from '../shared/deliveryTracker.js';
import { AuthenticatedSocket } from './types.js';
import {
  addConnection,
  removeConnection,
  sendToSocket,
} from './connection-manager.js';
import { broadcastPresence, notifyDeliveryReceipt } from './presence.js';
import { handleWebSocketMessage } from './message-handler.js';
import { handleRedisMessage } from './redis-handler.js';

const wsLogger = createServiceLogger('websocket');

// Re-export functions needed by other modules
export { getConnectionCount } from './connection-manager.js';
export { broadcastReactionUpdate } from './presence.js';

/**
 * Sets up the WebSocket server for real-time messaging.
 * Handles authentication, message routing, typing indicators, and presence.
 * Supports horizontal scaling via Redis pub/sub for cross-server communication.
 *
 * @param server - HTTP server to attach WebSocket to
 * @param sessionMiddleware - Express session middleware for authentication
 * @returns The configured WebSocketServer instance
 */
export function setupWebSocket(server: Server, sessionMiddleware: unknown): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Subscribe to this server's Redis channel for cross-server messaging
  subscribeToRedisChannel();

  redisSub.on('message', async (channel: string, message: string) => {
    if (channel === KEYS.serverChannel(config.serverId)) {
      try {
        const data = JSON.parse(message);
        await handleRedisMessage(data);
      } catch (error) {
        wsLogger.error({ error, channel }, 'Error handling Redis message');
      }
    }
  });

  wss.on('connection', async (ws: WebSocket, req) => {
    await handleConnection(ws as AuthenticatedSocket, req);
  });

  // Heartbeat to detect broken connections
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const socket = ws as AuthenticatedSocket;
      if (!socket.isAlive) {
        removeConnection(socket.userId);
        websocketConnections.dec();
        websocketEvents.inc({ event: 'timeout' });
        return socket.terminate();
      }
      socket.isAlive = false;
      socket.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
    redisSub.unsubscribe(KEYS.serverChannel(config.serverId));
  });

  return wss;
}

/**
 * Subscribes to Redis channel for cross-server messaging.
 */
function subscribeToRedisChannel(): void {
  withRedisCircuit(async () => {
    await redisSub.subscribe(KEYS.serverChannel(config.serverId));
    wsLogger.info({ channel: KEYS.serverChannel(config.serverId) }, 'Subscribed to Redis channel');
  }).catch((error) => {
    wsLogger.error({ error }, 'Failed to subscribe to Redis channel');
  });
}

/**
 * Handles a new WebSocket connection.
 */
async function handleConnection(socket: AuthenticatedSocket, req: unknown): Promise<void> {
  socket.connectedAt = Date.now();
  const reqWithHeaders = req as { headers: { cookie?: string } };

  try {
    const userId = await authenticateSocket(socket, reqWithHeaders);
    if (!userId) return;

    socket.userId = userId;
    socket.isAlive = true;

    addConnection(userId, socket);
    websocketConnections.inc();
    websocketEvents.inc({ event: 'connect' });

    await setUserPresence(userId, 'online', config.serverId);

    logEvent(LogEvents.WS_CONNECTED, { user_id: userId, server_id: config.serverId });
    wsLogger.info({ userId, serverId: config.serverId }, 'User connected');

    await deliverPendingMessages(socket, userId);
    await broadcastPresence(userId, 'online');

    setupSocketEventHandlers(socket, userId);
  } catch (error) {
    websocketEvents.inc({ event: 'error' });
    wsLogger.error({ error }, 'WebSocket connection error');
    socket.close(4000, 'Internal error');
  }
}

/**
 * Authenticates a WebSocket connection via session cookie.
 */
async function authenticateSocket(
  socket: AuthenticatedSocket,
  req: { headers: { cookie?: string } }
): Promise<string | null> {
  const cookies = parseCookie(req.headers.cookie || '');
  const sessionId = cookies['connect.sid'];

  if (!sessionId) {
    websocketEvents.inc({ event: 'auth_failed' });
    socket.close(4001, 'No session');
    return null;
  }

  const sessionKey = `sess:${sessionId.replace('s:', '').split('.')[0]}`;
  const sessionData = await redis.get(sessionKey);

  if (!sessionData) {
    websocketEvents.inc({ event: 'auth_failed' });
    socket.close(4001, 'Invalid session');
    return null;
  }

  const session = JSON.parse(sessionData);
  const userId = session.userId;

  if (!userId) {
    websocketEvents.inc({ event: 'auth_failed' });
    socket.close(4001, 'Not authenticated');
    return null;
  }

  return userId;
}

/**
 * Sets up event handlers for a socket connection.
 */
function setupSocketEventHandlers(socket: AuthenticatedSocket, userId: string): void {
  socket.on('pong', () => {
    socket.isAlive = true;
  });

  socket.on('message', async (data) => {
    try {
      const message: WSMessage = JSON.parse(data.toString());
      await handleWebSocketMessage(socket, message);
    } catch (error) {
      wsLogger.error({ error, userId }, 'Error handling WebSocket message');
      sendToSocket(socket, { type: 'error', payload: { message: 'Invalid message format' } });
    }
  });

  socket.on('close', async () => {
    removeConnection(userId);
    websocketConnections.dec();
    websocketEvents.inc({ event: 'disconnect' });

    const connectionDuration = (Date.now() - socket.connectedAt) / 1000;
    await setUserPresence(userId, 'offline');
    await broadcastPresence(userId, 'offline');

    logEvent(LogEvents.WS_DISCONNECTED, {
      user_id: userId,
      server_id: config.serverId,
      duration_seconds: connectionDuration,
    });
    wsLogger.info({ userId, duration: connectionDuration }, 'User disconnected');
  });

  socket.on('error', (error) => {
    websocketEvents.inc({ event: 'error' });
    logEvent(LogEvents.WS_ERROR, { user_id: userId, error: error.message });
    wsLogger.error({ error, userId }, 'WebSocket error');
  });
}

/**
 * Delivers pending messages to a newly connected user.
 */
async function deliverPendingMessages(socket: AuthenticatedSocket, userId: string): Promise<void> {
  try {
    const pendingMessages = await getPendingMessagesForUser(userId);
    for (const msg of pendingMessages) {
      sendToSocket(socket, { type: 'message', payload: msg });

      const wasUpdated = await idempotentStatusUpdate(msg.id, userId, 'delivered');
      if (wasUpdated) {
        await recordDelivery(msg.id, userId, 'pending');
        await notifyDeliveryReceipt(msg.sender_id, msg.id, userId, 'delivered');
      }
    }

    if (pendingMessages.length > 0) {
      wsLogger.info({ userId, count: pendingMessages.length }, 'Delivered pending messages');
    }
  } catch (error) {
    wsLogger.error({ error, userId }, 'Error delivering pending messages');
  }
}
