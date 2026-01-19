/**
 * Connection manager for WebSocket room management.
 * Handles room creation, user joining/leaving, and color assignment.
 *
 * @module websocket/connection-manager
 */

import { WebSocket } from 'ws';
import { ExtendedWebSocket, Room, COLORS, Collaborator } from './types.js';
import { createChildLogger } from '../shared/logger.js';
import { wsConnectionsActive } from '../shared/metrics.js';
import {
  setCachedCollaborator,
  removeCachedCollaborator,
} from '../shared/cache.js';

/** Logger for connection management */
const connLogger = createChildLogger({ component: 'connection-manager' });

/**
 * In-memory mapping of spreadsheet IDs to their active rooms.
 * Each room contains all connected WebSocket clients.
 */
const rooms = new Map<string, Room>();

/** Color index for cycling through collaborator colors */
let colorIndex = 0;

/**
 * Returns the next available color from the color palette.
 * Cycles through colors to ensure visual distinction between collaborators.
 *
 * @returns A hex color code for the user's presence indicator
 */
export function getNextColor(): string {
  const color = COLORS[colorIndex % COLORS.length];
  colorIndex++;
  return color;
}

/**
 * Gets or creates a room for a spreadsheet.
 *
 * @param spreadsheetId - The spreadsheet ID
 * @returns The room for the spreadsheet
 */
export function getOrCreateRoom(spreadsheetId: string): Room {
  if (!rooms.has(spreadsheetId)) {
    rooms.set(spreadsheetId, { clients: new Set() });
  }
  return rooms.get(spreadsheetId)!;
}

/**
 * Gets a room for a spreadsheet if it exists.
 *
 * @param spreadsheetId - The spreadsheet ID
 * @returns The room or undefined
 */
export function getRoom(spreadsheetId: string): Room | undefined {
  return rooms.get(spreadsheetId);
}

/**
 * Adds a client to a room.
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param ws - The WebSocket client
 */
export async function joinRoom(spreadsheetId: string, ws: ExtendedWebSocket): Promise<void> {
  const room = getOrCreateRoom(spreadsheetId);
  room.clients.add(ws);

  // Update metrics
  wsConnectionsActive.inc();

  // Cache collaborator info
  await setCachedCollaborator(spreadsheetId, ws.userId!, {
    userId: ws.userId,
    name: ws.userName,
    color: ws.userColor,
  });

  connLogger.info(
    { userId: ws.userId, userName: ws.userName, spreadsheetId },
    'User joined room'
  );
}

/**
 * Removes a client from a room and cleans up empty rooms.
 *
 * @param ws - The WebSocket client
 */
export async function leaveRoom(ws: ExtendedWebSocket): Promise<void> {
  if (!ws.spreadsheetId) return;

  // Update metrics
  wsConnectionsActive.dec();

  const room = rooms.get(ws.spreadsheetId);
  if (room) {
    room.clients.delete(ws);

    // Remove from collaborator cache
    if (ws.userId) {
      await removeCachedCollaborator(ws.spreadsheetId, ws.userId);
    }

    // Clean up empty rooms
    if (room.clients.size === 0) {
      rooms.delete(ws.spreadsheetId);
    }
  }

  connLogger.info(
    { userId: ws.userId, userName: ws.userName, spreadsheetId: ws.spreadsheetId },
    'User left room'
  );
}

/**
 * Gets the list of collaborators in a room, excluding a specific client.
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param excludeWs - Optional client to exclude
 * @returns Array of collaborator info
 */
export function getRoomCollaborators(
  spreadsheetId: string,
  excludeWs?: ExtendedWebSocket
): Collaborator[] {
  const collaborators: Collaborator[] = [];
  const room = rooms.get(spreadsheetId);

  if (room) {
    for (const client of room.clients) {
      if (client !== excludeWs && client.userId) {
        collaborators.push({
          userId: client.userId,
          name: client.userName,
          color: client.userColor,
        });
      }
    }
  }

  return collaborators;
}

/**
 * Broadcasts a message to all clients in a spreadsheet room.
 * Optionally excludes a specific client (typically the sender).
 *
 * @param spreadsheetId - The spreadsheet room to broadcast to
 * @param message - The message object to send (will be JSON-stringified)
 * @param exclude - Optional WebSocket connection to exclude from broadcast
 * @returns Number of clients the message was sent to
 */
export function broadcastToRoom(
  spreadsheetId: string,
  message: any,
  exclude?: ExtendedWebSocket
): number {
  const room = rooms.get(spreadsheetId);
  if (!room) return 0;

  const data = JSON.stringify(message);
  let sentCount = 0;

  for (const client of room.clients) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(data);
      sentCount++;
    }
  }

  return sentCount;
}

/**
 * Gets the number of clients in a room.
 *
 * @param spreadsheetId - The spreadsheet ID
 * @returns Number of connected clients
 */
export function getRoomSize(spreadsheetId: string): number {
  const room = rooms.get(spreadsheetId);
  return room ? room.clients.size : 0;
}
