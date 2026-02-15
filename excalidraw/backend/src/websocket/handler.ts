import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'http';
import logger from '../services/logger.js';
import { wsConnectionsActive, wsMessagesTotal } from '../services/metrics.js';
import { updateCursor, removeCursor } from '../services/presenceService.js';
import { getDrawing, updateDrawing } from '../services/drawingService.js';
import { mergeElements, applyOperation, type CrdtElement } from '../services/crdtService.js';

interface ClientInfo {
  ws: WebSocket;
  userId: string;
  username: string;
  drawingId: string | null;
  color: string;
}

interface WsMessage {
  type: string;
  drawingId?: string;
  userId?: string;
  username?: string;
  elementId?: string;
  elementData?: CrdtElement;
  elements?: CrdtElement[];
  x?: number;
  y?: number;
  color?: string;
}

// Room management: drawingId -> Set of WebSocket clients
const rooms = new Map<string, Set<ClientInfo>>();
const clients = new Map<WebSocket, ClientInfo>();

// Cursor colors for different users
const CURSOR_COLORS = [
  '#e03131', '#c2255c', '#9c36b5', '#6741d9', '#3b5bdb',
  '#1971c2', '#0c8599', '#099268', '#2f9e44', '#66a80f',
  '#e8590c', '#d9480f',
];

let colorIndex = 0;
const getNextColor = (): string => {
  const color = CURSOR_COLORS[colorIndex % CURSOR_COLORS.length];
  colorIndex++;
  return color;
};

const broadcastToRoom = (drawingId: string, message: WsMessage, excludeWs?: WebSocket): void => {
  const room = rooms.get(drawingId);
  if (!room) return;

  const data = JSON.stringify(message);

  for (const client of room) {
    if (client.ws !== excludeWs && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  }
};

// Debounce map for saving drawing state to DB
const saveTimers = new Map<string, NodeJS.Timeout>();

const debouncedSave = (drawingId: string, elements: CrdtElement[]): void => {
  const existing = saveTimers.get(drawingId);
  if (existing) clearTimeout(existing);

  saveTimers.set(
    drawingId,
    setTimeout(async () => {
      try {
        await updateDrawing(drawingId, { elements });
        logger.debug({ drawingId }, 'Drawing auto-saved');
      } catch (error) {
        const err = error as Error;
        logger.error({ error: err.message, drawingId }, 'Failed to auto-save drawing');
      }
      saveTimers.delete(drawingId);
    }, 2000) // Save after 2 seconds of inactivity
  );
};

// In-memory element state per room for fast merging
const roomElements = new Map<string, CrdtElement[]>();

const handleMessage = async (ws: WebSocket, data: string): Promise<void> => {
  let message: WsMessage;
  try {
    message = JSON.parse(data) as WsMessage;
  } catch {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
    return;
  }

  const client = clients.get(ws);
  if (!client) return;

  wsMessagesTotal.labels(message.type).inc();

  switch (message.type) {
    case 'join-room': {
      const drawingId = message.drawingId;
      if (!drawingId) {
        ws.send(JSON.stringify({ type: 'error', message: 'drawingId is required' }));
        return;
      }

      // Leave previous room if any
      if (client.drawingId) {
        leaveRoom(client);
      }

      // Join new room
      client.drawingId = drawingId;
      client.userId = message.userId || client.userId;
      client.username = message.username || client.username;

      if (!rooms.has(drawingId)) {
        rooms.set(drawingId, new Set());
      }
      rooms.get(drawingId)!.add(client);

      // Load current drawing state if not in memory
      if (!roomElements.has(drawingId)) {
        const drawing = await getDrawing(drawingId);
        if (drawing) {
          roomElements.set(drawingId, (drawing.elements || []) as CrdtElement[]);
        } else {
          roomElements.set(drawingId, []);
        }
      }

      // Send current state to joining client
      ws.send(JSON.stringify({
        type: 'room-state',
        drawingId,
        elements: roomElements.get(drawingId) || [],
      }));

      // Notify others
      broadcastToRoom(drawingId, {
        type: 'user-joined',
        userId: client.userId,
        username: client.username,
        color: client.color,
      }, ws);

      logger.info({ drawingId, userId: client.userId }, 'User joined room');
      break;
    }

    case 'leave-room': {
      leaveRoom(client);
      break;
    }

    case 'shape-add': {
      if (!client.drawingId || !message.elementData) return;

      const elements = roomElements.get(client.drawingId) || [];
      const updated = applyOperation(elements, {
        type: 'add',
        elementId: message.elementData.id,
        elementData: message.elementData,
      });
      roomElements.set(client.drawingId, updated);

      broadcastToRoom(client.drawingId, {
        type: 'shape-add',
        userId: client.userId,
        elementData: message.elementData,
      }, ws);

      debouncedSave(client.drawingId, updated);
      break;
    }

    case 'shape-update': {
      if (!client.drawingId || !message.elementData) return;

      const elements = roomElements.get(client.drawingId) || [];
      const updated = applyOperation(elements, {
        type: 'update',
        elementId: message.elementData.id,
        elementData: message.elementData,
      });
      roomElements.set(client.drawingId, updated);

      broadcastToRoom(client.drawingId, {
        type: 'shape-update',
        userId: client.userId,
        elementData: message.elementData,
      }, ws);

      debouncedSave(client.drawingId, updated);
      break;
    }

    case 'shape-delete': {
      if (!client.drawingId || !message.elementId) return;

      const elements = roomElements.get(client.drawingId) || [];
      const updated = applyOperation(elements, {
        type: 'delete',
        elementId: message.elementId,
      });
      roomElements.set(client.drawingId, updated);

      broadcastToRoom(client.drawingId, {
        type: 'shape-delete',
        userId: client.userId,
        elementId: message.elementId,
      }, ws);

      debouncedSave(client.drawingId, updated);
      break;
    }

    case 'shape-move': {
      if (!client.drawingId || !message.elementData) return;

      const elements = roomElements.get(client.drawingId) || [];
      const updated = applyOperation(elements, {
        type: 'move',
        elementId: message.elementData.id,
        elementData: message.elementData,
      });
      roomElements.set(client.drawingId, updated);

      broadcastToRoom(client.drawingId, {
        type: 'shape-move',
        userId: client.userId,
        elementData: message.elementData,
      }, ws);

      debouncedSave(client.drawingId, updated);
      break;
    }

    case 'elements-sync': {
      // Full element sync (used for bulk operations)
      if (!client.drawingId || !message.elements) return;

      const existing = roomElements.get(client.drawingId) || [];
      const merged = mergeElements(existing, message.elements);
      roomElements.set(client.drawingId, merged);

      broadcastToRoom(client.drawingId, {
        type: 'elements-sync',
        userId: client.userId,
        elements: merged,
      }, ws);

      debouncedSave(client.drawingId, merged);
      break;
    }

    case 'cursor-move': {
      if (!client.drawingId || message.x === undefined || message.y === undefined) return;

      // Update cursor in Redis for presence
      updateCursor(
        client.drawingId,
        client.userId,
        client.username,
        message.x,
        message.y,
        client.color
      ).catch(() => {
        // Non-critical, ignore errors
      });

      // Broadcast to room directly (Redis is for persistence, WS is for real-time)
      broadcastToRoom(client.drawingId, {
        type: 'cursor-move',
        userId: client.userId,
        username: client.username,
        x: message.x,
        y: message.y,
        color: client.color,
      }, ws);
      break;
    }

    default:
      ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${message.type}` }));
  }
};

const leaveRoom = (client: ClientInfo): void => {
  if (!client.drawingId) return;

  const room = rooms.get(client.drawingId);
  if (room) {
    room.delete(client);

    // Remove cursor
    removeCursor(client.drawingId, client.userId).catch(() => {});

    // Notify others
    broadcastToRoom(client.drawingId, {
      type: 'user-left',
      userId: client.userId,
      username: client.username,
    });

    // Clean up empty rooms
    if (room.size === 0) {
      rooms.delete(client.drawingId);

      // Flush in-memory elements to DB before removing
      const elements = roomElements.get(client.drawingId);
      if (elements) {
        updateDrawing(client.drawingId, { elements }).catch((err: Error) => {
          logger.error({ error: err.message }, 'Failed to flush room elements');
        });
        roomElements.delete(client.drawingId);
      }

      // Clean up save timer
      const timer = saveTimers.get(client.drawingId);
      if (timer) {
        clearTimeout(timer);
        saveTimers.delete(client.drawingId);
      }
    }

    logger.info({ drawingId: client.drawingId, userId: client.userId }, 'User left room');
  }

  client.drawingId = null;
};

/** Initializes the WebSocket server for real-time drawing collaboration and cursor tracking. */
export const setupWebSocket = (wss: WebSocketServer): void => {
  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    const clientInfo: ClientInfo = {
      ws,
      userId: 'anonymous',
      username: 'Anonymous',
      drawingId: null,
      color: getNextColor(),
    };

    clients.set(ws, clientInfo);
    wsConnectionsActive.inc();

    logger.debug('WebSocket client connected');

    ws.on('message', (data: Buffer | string) => {
      const message = typeof data === 'string' ? data : data.toString();
      handleMessage(ws, message).catch((error: unknown) => {
        const err = error as Error;
        logger.error({ error: err.message }, 'WebSocket message handler error');
      });
    });

    ws.on('close', () => {
      const client = clients.get(ws);
      if (client) {
        leaveRoom(client);
        clients.delete(ws);
      }
      wsConnectionsActive.dec();
      logger.debug('WebSocket client disconnected');
    });

    ws.on('error', (error: Error) => {
      logger.error({ error: error.message }, 'WebSocket error');
    });

    // Send welcome message with assigned color
    ws.send(JSON.stringify({
      type: 'connected',
      color: clientInfo.color,
    }));
  });
};

export default setupWebSocket;
