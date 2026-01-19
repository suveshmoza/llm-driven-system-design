/**
 * Real-time collaboration handlers for cursor and selection sync.
 * Handles presence awareness features like cursor positions and selections.
 *
 * @module websocket/collaboration
 */

import { ExtendedWebSocket, CursorMovePayload, SelectionChangePayload } from './types.js';
import { broadcastToRoom } from './connection-manager.js';
import { wsMessagesSent } from '../shared/metrics.js';

/**
 * Handles cursor movement notifications from clients.
 * Broadcasts cursor position to other collaborators for presence awareness.
 *
 * @param ws - The WebSocket connection that moved its cursor
 * @param payload - Contains row and col of the cursor position
 */
export function handleCursorMove(ws: ExtendedWebSocket, payload: CursorMovePayload): void {
  const { row, col } = payload;

  const sentCount = broadcastToRoom(ws.spreadsheetId!, {
    type: 'CURSOR_MOVED',
    userId: ws.userId,
    name: ws.userName,
    color: ws.userColor,
    row,
    col,
  }, ws);

  if (sentCount > 0) {
    wsMessagesSent.labels('CURSOR_MOVED').inc(sentCount);
  }
}

/**
 * Handles selection range changes from clients.
 * Broadcasts the selection to other collaborators for visual feedback.
 *
 * @param ws - The WebSocket connection that changed its selection
 * @param payload - Contains the selection range object
 */
export function handleSelectionChange(ws: ExtendedWebSocket, payload: SelectionChangePayload): void {
  const { range } = payload;

  const sentCount = broadcastToRoom(ws.spreadsheetId!, {
    type: 'SELECTION_CHANGED',
    userId: ws.userId,
    name: ws.userName,
    color: ws.userColor,
    range,
  }, ws);

  if (sentCount > 0) {
    wsMessagesSent.labels('SELECTION_CHANGED').inc(sentCount);
  }
}

/**
 * Broadcasts that a user has joined the spreadsheet.
 *
 * @param ws - The WebSocket connection that joined
 */
export function broadcastUserJoined(ws: ExtendedWebSocket): void {
  const sentCount = broadcastToRoom(ws.spreadsheetId!, {
    type: 'USER_JOINED',
    userId: ws.userId,
    name: ws.userName,
    color: ws.userColor,
  }, ws);

  if (sentCount > 0) {
    wsMessagesSent.labels('USER_JOINED').inc(sentCount);
  }
}

/**
 * Broadcasts that a user has left the spreadsheet.
 *
 * @param ws - The WebSocket connection that left
 */
export function broadcastUserLeft(ws: ExtendedWebSocket): void {
  if (!ws.spreadsheetId) return;

  const sentCount = broadcastToRoom(ws.spreadsheetId, {
    type: 'USER_LEFT',
    userId: ws.userId,
  });

  if (sentCount > 0) {
    wsMessagesSent.labels('USER_LEFT').inc(sentCount);
  }
}
