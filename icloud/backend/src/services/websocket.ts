import type { IncomingMessage } from 'http';
import type { WebSocket as WsWebSocket, WebSocketServer } from 'ws';
import { redis } from '../db.js';

// Extended WebSocket type with custom properties
interface ExtendedWebSocket extends WsWebSocket {
  userId?: string;
  deviceId?: string;
  isAlive?: boolean;
  subscribedFiles?: Set<string>;
}

interface SessionData {
  user: {
    id: string;
    email: string;
    role: string;
  };
  deviceId?: string;
}

interface WebSocketMessage {
  type: string;
  data?: {
    fileId?: string;
  };
}

// Store active WebSocket connections by user
const userConnections = new Map<string, Set<ExtendedWebSocket>>();

export function setupWebSocket(wss: WebSocketServer): void {
  wss.on('connection', async (ws: ExtendedWebSocket, req: IncomingMessage) => {
    console.log('WebSocket connection attempt');

    // Extract token from query string
    const url = new URL(req.url || '', 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Authentication required');
      return;
    }

    // Validate token
    const sessionData = await redis.get(`session:${token}`);

    if (!sessionData) {
      ws.close(4001, 'Invalid token');
      return;
    }

    const session: SessionData = JSON.parse(sessionData);
    const userId = session.user.id;
    const deviceId = session.deviceId;

    // Store connection
    if (!userConnections.has(userId)) {
      userConnections.set(userId, new Set());
    }
    userConnections.get(userId)!.add(ws);

    // Add metadata to connection
    ws.userId = userId;
    ws.deviceId = deviceId;

    console.log(`WebSocket connected: user=${userId}, device=${deviceId}`);

    // Send connection confirmation
    ws.send(JSON.stringify({
      type: 'connected',
      userId,
      deviceId,
    }));

    // Handle messages
    ws.on('message', async (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const message: WebSocketMessage = JSON.parse(data.toString());
        await handleMessage(ws, message);
      } catch (error) {
        console.error('WebSocket message error:', error);
        ws.send(JSON.stringify({ type: 'error', message: (error as Error).message }));
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      console.log(`WebSocket disconnected: user=${userId}, device=${deviceId}`);
      const userConns = userConnections.get(userId);
      if (userConns) {
        userConns.delete(ws);
        if (userConns.size === 0) {
          userConnections.delete(userId);
        }
      }
    });

    // Handle errors
    ws.on('error', (error: Error) => {
      console.error(`WebSocket error for user=${userId}:`, error);
    });

    // Ping/pong for connection health
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  });

  // Heartbeat interval
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const extWs = ws as ExtendedWebSocket;
      if (!extWs.isAlive) {
        return extWs.terminate();
      }
      extWs.isAlive = false;
      extWs.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });
}

/**
 * Handle incoming WebSocket messages
 */
async function handleMessage(ws: ExtendedWebSocket, message: WebSocketMessage): Promise<void> {
  const { type, data } = message;

  switch (type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;

    case 'subscribe':
      // Subscribe to specific file changes
      if (data?.fileId) {
        ws.subscribedFiles = ws.subscribedFiles || new Set();
        ws.subscribedFiles.add(data.fileId);
      }
      break;

    case 'unsubscribe':
      if (data?.fileId && ws.subscribedFiles) {
        ws.subscribedFiles.delete(data.fileId);
      }
      break;

    case 'sync_request':
      // Client requesting immediate sync check
      ws.send(JSON.stringify({
        type: 'sync_required',
        timestamp: new Date().toISOString(),
      }));
      break;

    default:
      console.log(`Unknown message type: ${type}`);
  }
}

/**
 * Broadcast a message to all connections for a specific user
 */
export function broadcastToUser(userId: string, message: unknown, excludeDeviceId: string | null = null): void {
  const connections = userConnections.get(userId);

  if (!connections) return;

  const messageStr = JSON.stringify(message);

  for (const ws of connections) {
    // Skip the device that initiated the change
    if (excludeDeviceId && ws.deviceId === excludeDeviceId) {
      continue;
    }

    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(messageStr);
    }
  }
}

/**
 * Broadcast to all subscribers of a specific file
 */
export function broadcastToFileSubscribers(fileId: string, message: unknown, excludeDeviceId: string | null = null): void {
  const messageStr = JSON.stringify(message);

  for (const [_userId, connections] of userConnections) {
    for (const ws of connections) {
      if (
        ws.subscribedFiles?.has(fileId) &&
        (!excludeDeviceId || ws.deviceId !== excludeDeviceId) &&
        ws.readyState === 1
      ) {
        ws.send(messageStr);
      }
    }
  }
}

/**
 * Get count of active connections for a user
 */
export function getUserConnectionCount(userId: string): number {
  return userConnections.get(userId)?.size || 0;
}

/**
 * Get all connected devices for a user
 */
export function getConnectedDevices(userId: string): string[] {
  const connections = userConnections.get(userId);
  if (!connections) return [];

  return Array.from(connections)
    .map(ws => ws.deviceId)
    .filter((id): id is string => Boolean(id));
}
