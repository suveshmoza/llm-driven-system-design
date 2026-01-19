/**
 * WebSocket server for real-time spreadsheet collaboration.
 * Handles connection lifecycle, message routing, room management,
 * and broadcasts cell changes to all connected clients.
 *
 * @module websocket
 */

import { WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { createChildLogger } from '../shared/logger.js';
import { wsMessagesReceived, wsMessageLatency, errorsTotal } from '../shared/metrics.js';
import { ExtendedWebSocket } from './types.js';
import { getNextColor, joinRoom, leaveRoom } from './connection-manager.js';
import {
  handleCursorMove,
  handleSelectionChange,
  broadcastUserJoined,
  broadcastUserLeft,
} from './collaboration.js';
import { handleCellEdit } from './cell-operations.js';
import {
  handleResizeColumn,
  handleResizeRow,
  handleRenameSheet,
} from './sheet-operations.js';
import { sendInitialState } from './state-sync.js';

/** Logger for WebSocket operations */
const wsLogger = createChildLogger({ component: 'websocket' });

/**
 * Initializes the WebSocket server for real-time collaboration.
 * Handles connection lifecycle, message routing, and room management.
 * Implements heartbeat mechanism to detect and clean up stale connections.
 *
 * @param server - The HTTP server instance to attach WebSocket handling to
 * @returns The configured WebSocketServer instance
 */
export function setupWebSocket(server: any) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Heartbeat to detect stale connections
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const extWs = ws as ExtendedWebSocket;
      if (extWs.isAlive === false) {
        handleDisconnect(extWs);
        return extWs.terminate();
      }
      extWs.isAlive = false;
      extWs.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  wss.on('connection', async (ws: ExtendedWebSocket, req: IncomingMessage) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // Parse query params
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const spreadsheetId = url.searchParams.get('spreadsheetId');
    const sessionId = url.searchParams.get('sessionId');
    const userName = url.searchParams.get('name') || 'Anonymous';

    if (!spreadsheetId) {
      ws.close(4000, 'Missing spreadsheetId');
      return;
    }

    // Assign user identity
    ws.spreadsheetId = spreadsheetId;
    ws.sessionId = sessionId || uuidv4();
    ws.userId = uuidv4();
    ws.userName = userName;
    ws.userColor = getNextColor();

    // Join room
    await joinRoom(spreadsheetId, ws);

    wsLogger.info(
      { userId: ws.userId, userName: ws.userName, spreadsheetId },
      'User connected'
    );

    // Send current state to new client
    await sendInitialState(ws, spreadsheetId);

    // Broadcast user joined
    broadcastUserJoined(ws);

    // Handle messages
    ws.on('message', async (data) => {
      const start = Date.now();
      try {
        const message = JSON.parse(data.toString());
        wsMessagesReceived.labels(message.type || 'unknown').inc();

        await handleMessage(ws, message);

        const duration = Date.now() - start;
        wsMessageLatency.labels(message.type || 'unknown').observe(duration);
      } catch (e) {
        errorsTotal.labels('message_parse', 'websocket').inc();
        wsLogger.error({ error: e, userId: ws.userId }, 'Error handling message');
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      handleDisconnect(ws);
    });

    ws.on('error', (error) => {
      errorsTotal.labels('ws_connection', 'websocket').inc();
      wsLogger.error({ error, userId: ws.userId }, 'WebSocket error');
      handleDisconnect(ws);
    });
  });

  return wss;
}

/**
 * Routes incoming WebSocket messages to appropriate handlers.
 *
 * @param ws - The WebSocket connection that sent the message
 * @param message - The parsed message object with type and payload
 */
async function handleMessage(ws: ExtendedWebSocket, message: any) {
  const { type, ...payload } = message;

  switch (type) {
    case 'CELL_EDIT':
      await handleCellEdit(ws, payload);
      break;
    case 'CURSOR_MOVE':
      handleCursorMove(ws, payload);
      break;
    case 'SELECTION_CHANGE':
      handleSelectionChange(ws, payload);
      break;
    case 'RESIZE_COLUMN':
      await handleResizeColumn(ws, payload);
      break;
    case 'RESIZE_ROW':
      await handleResizeRow(ws, payload);
      break;
    case 'RENAME_SHEET':
      await handleRenameSheet(ws, payload);
      break;
    default:
      wsLogger.debug({ type, userId: ws.userId }, 'Unknown message type');
  }
}

/**
 * Handles client disconnection cleanup.
 *
 * @param ws - The WebSocket connection that disconnected
 */
async function handleDisconnect(ws: ExtendedWebSocket) {
  if (!ws.spreadsheetId) return;
  await leaveRoom(ws);
  broadcastUserLeft(ws);
}
