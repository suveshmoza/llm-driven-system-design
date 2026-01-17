/**
 * Represents an authenticated user in the system.
 */
export interface User {
  /** Unique user identifier (UUID). */
  id: string;
  /** Display name chosen by the user. */
  username: string;
  /** User role determining permissions. */
  role: 'user' | 'admin';
}

/**
 * Represents a single pixel placement event.
 * Used for real-time updates and displaying pixel information.
 */
export interface PixelEvent {
  /** X coordinate on the canvas (0-indexed from left). */
  x: number;
  /** Y coordinate on the canvas (0-indexed from top). */
  y: number;
  /** Color index from the palette (0-15). */
  color: number;
  /** Unique identifier of the user who placed the pixel. */
  userId: string;
  /** Unix timestamp in milliseconds when the pixel was placed. */
  timestamp: number;
}

/**
 * Represents a user's cooldown status for pixel placement.
 */
export interface CooldownStatus {
  /** Whether the user is allowed to place a pixel now. */
  canPlace: boolean;
  /** Seconds remaining until the user can place another pixel. */
  remainingSeconds: number;
  /** Unix timestamp when the user can place another pixel. */
  nextPlacement: number;
}

/**
 * Canvas configuration received from the server.
 */
export interface CanvasConfig {
  /** Width of the canvas in pixels. */
  width: number;
  /** Height of the canvas in pixels. */
  height: number;
  /** Array of hex color strings for the palette. */
  colors: string[];
  /** Cooldown period in seconds between pixel placements. */
  cooldownSeconds: number;
}

/**
 * Generic WebSocket message structure for client-server communication.
 */
export interface WebSocketMessage {
  /** Message type indicating the kind of data being sent. */
  type: 'canvas' | 'pixel' | 'pixels' | 'cooldown' | 'error' | 'connected' | 'pong';
  /** Payload data, structure depends on the message type. */
  data?: unknown;
}
