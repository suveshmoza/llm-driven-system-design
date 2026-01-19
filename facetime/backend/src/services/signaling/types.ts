/**
 * Shared types for the signaling service.
 */

import { WebSocket } from 'ws';
import type { createWebSocketLogger } from '../../shared/logger.js';

/**
 * Simplified user profile for signaling operations.
 * Contains only the fields needed for call notifications and display.
 *
 * @description A lightweight user representation used in signaling messages
 * to identify callers and callees without exposing sensitive data.
 *
 * @property id - Unique identifier for the user
 * @property username - The user's unique username
 * @property display_name - Human-readable name shown in the UI
 * @property avatar_url - URL to the user's profile image, or null if not set
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
 *
 * @description A data structure that holds all information about a single
 * WebSocket connection, allowing the server to route messages and track
 * connection health.
 *
 * @property ws - The active WebSocket connection
 * @property userId - The ID of the authenticated user
 * @property deviceId - Unique identifier for the connected device
 * @property deviceType - Type of device (e.g., 'desktop', 'mobile', 'tablet')
 * @property lastPing - Unix timestamp of the last heartbeat received, used for timeout detection
 * @property log - Scoped logger instance for this connection
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
 *
 * @description Payload structure for initiating a new call, supporting
 * idempotent request handling to prevent duplicate calls from network retries.
 *
 * @property calleeIds - Array of user IDs to call
 * @property callType - Type of call: 'video' for video calls, 'audio' for audio-only
 * @property idempotencyKey - Optional unique key to prevent duplicate call creation
 */
export interface CallInitiateDataWithIdempotency {
  calleeIds: string[];
  callType: 'video' | 'audio';
  idempotencyKey?: string;
}

/**
 * Call state stored in Redis.
 *
 * @description Complete representation of an active or recent call,
 * stored in Redis for fast access during signaling operations.
 * Includes all participants, timing information, and current state.
 *
 * @property id - Unique identifier for the call (UUID)
 * @property initiatorId - User ID of the person who started the call
 * @property initiatorDeviceId - Device ID of the initiator's device
 * @property calleeIds - Array of user IDs that were called
 * @property callType - Type of call ('video' or 'audio')
 * @property state - Current call state: 'ringing', 'connected', 'ended', 'missed', or 'declined'
 * @property participants - Array of currently connected participants with their device info
 * @property createdAt - Unix timestamp when the call was initiated
 * @property answeredAt - Unix timestamp when the call was answered (optional)
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
