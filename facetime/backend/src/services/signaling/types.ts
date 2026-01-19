/**
 * Shared types for the signaling service.
 */

import { WebSocket } from 'ws';
import type { createWebSocketLogger } from '../../shared/logger.js';

/**
 * Simplified user profile for signaling operations.
 */
export interface UserProfile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

/**
 * Represents a connected WebSocket client for signaling.
 * Tracks the socket connection, user identity, device info,
 * and last heartbeat for connection health monitoring.
 */
export interface ConnectedClient {
  ws: WebSocket;
  userId: string;
  deviceId: string;
  deviceType: string;
  lastPing: number;
  log: ReturnType<typeof createWebSocketLogger>;
}

/**
 * Extended call initiate data with idempotency key.
 */
export interface CallInitiateDataWithIdempotency {
  calleeIds: string[];
  callType: 'video' | 'audio';
  idempotencyKey?: string;
}

/**
 * Call state stored in Redis.
 */
export interface CallState {
  id: string;
  initiatorId: string;
  initiatorDeviceId: string;
  calleeIds: string[];
  callType: string;
  state: 'ringing' | 'connected' | 'ended' | 'missed' | 'declined';
  participants: { userId: string; deviceId: string }[];
  createdAt: number;
  answeredAt?: number;
}
