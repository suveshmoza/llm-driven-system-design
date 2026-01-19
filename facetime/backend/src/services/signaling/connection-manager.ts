/**
 * Connection Manager - Handles WebSocket client tracking and utilities.
 *
 * Manages:
 * - Client connection maps
 * - User-to-client lookups
 * - Ring timeout tracking
 * - Call creation time tracking
 * - Message sending utilities
 */

import { WebSocket } from 'ws';
import type { WebSocketMessage } from '../../types/index.js';
import type { ConnectedClient } from './types.js';

/** Map of clientId to ConnectedClient for all active WebSocket connections */
const clients = new Map<string, ConnectedClient>();

/** Map of userId to Set of clientIds for quick user-to-connection lookup */
const userClients = new Map<string, Set<string>>();

/** Map of callId to timeout handle for ring timeout management */
const ringTimeouts = new Map<string, NodeJS.Timeout>();

/** Map of callId to creation timestamp for setup latency tracking */
const callCreationTimes = new Map<string, number>();

// --- Client Management ---

export function getClient(clientId: string): ConnectedClient | undefined {
  return clients.get(clientId);
}

export function setClient(clientId: string, client: ConnectedClient): void {
  clients.set(clientId, client);
}

export function deleteClient(clientId: string): boolean {
  return clients.delete(clientId);
}

export function getAllClients(): Map<string, ConnectedClient> {
  return clients;
}

export function getClientCount(): number {
  return clients.size;
}

// --- User-Client Lookup ---

export function getUserClientIds(userId: string): Set<string> | undefined {
  return userClients.get(userId);
}

export function addUserClient(userId: string, clientId: string): void {
  if (!userClients.has(userId)) {
    userClients.set(userId, new Set());
  }
  userClients.get(userId)!.add(clientId);
}

export function removeUserClient(userId: string, clientId: string): void {
  const clientIds = userClients.get(userId);
  if (clientIds) {
    clientIds.delete(clientId);
    if (clientIds.size === 0) {
      userClients.delete(userId);
    }
  }
}

export function getAllUserClients(): Map<string, Set<string>> {
  return userClients;
}

// --- Ring Timeout Management ---

export function setRingTimeout(callId: string, timeout: NodeJS.Timeout): void {
  ringTimeouts.set(callId, timeout);
}

export function getRingTimeout(callId: string): NodeJS.Timeout | undefined {
  return ringTimeouts.get(callId);
}

export function clearRingTimeout(callId: string): void {
  const timeout = ringTimeouts.get(callId);
  if (timeout) {
    clearTimeout(timeout);
    ringTimeouts.delete(callId);
  }
}

// --- Call Creation Time Tracking ---

export function setCallCreationTime(callId: string, time: number): void {
  callCreationTimes.set(callId, time);
}

export function getCallCreationTime(callId: string): number | undefined {
  return callCreationTimes.get(callId);
}

export function deleteCallCreationTime(callId: string): boolean {
  return callCreationTimes.delete(callId);
}

// --- Message Sending ---

/**
 * Sends a message to a connected WebSocket client.
 * Adds timestamp and handles serialization.
 *
 * @param ws - The WebSocket connection to send to
 * @param message - The message to send
 */
export function sendToClient(ws: WebSocket, message: WebSocketMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ ...message, timestamp: Date.now() }));
  }
}

/**
 * Sends a message to all devices of a specific user.
 *
 * @param userId - The user ID to send to
 * @param message - The message to send
 * @param excludeDeviceId - Optional device ID to exclude from sending
 */
export function sendToUser(
  userId: string,
  message: WebSocketMessage,
  excludeDeviceId?: string
): void {
  const clientIds = userClients.get(userId);
  if (clientIds) {
    for (const clientId of clientIds) {
      const client = clients.get(clientId);
      if (client && (!excludeDeviceId || client.deviceId !== excludeDeviceId)) {
        sendToClient(client.ws, message);
      }
    }
  }
}

/**
 * Returns a list of currently online users with their device counts.
 * Used by the stats endpoint to monitor active connections.
 *
 * @returns Array of objects with userId and deviceCount
 */
export function getOnlineUsers(): { userId: string; deviceCount: number }[] {
  const users: { userId: string; deviceCount: number }[] = [];
  for (const [userId, clientIds] of userClients) {
    users.push({ userId, deviceCount: clientIds.size });
  }
  return users;
}
