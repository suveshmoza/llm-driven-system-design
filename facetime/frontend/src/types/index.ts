/**
 * Represents a user in the FaceTime system.
 * Used for displaying contacts and call participants.
 */
export interface User {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role?: 'user' | 'admin';
}

/**
 * Represents the current state of a call in the application.
 * Tracks call lifecycle from initiation through connection to ending.
 */
export interface CallState {
  callId: string;
  caller: User | null;
  callees: User[];
  callType: 'video' | 'audio';
  state: 'idle' | 'initiating' | 'ringing' | 'connecting' | 'connected' | 'ended';
  direction: 'incoming' | 'outgoing';
  startTime: number | null;
  isGroup: boolean;
}

/**
 * Generic WebSocket message structure for signaling.
 * Used for all communication with the signaling server.
 */
export interface WebSocketMessage {
  type: string;
  callId?: string;
  userId?: string;
  data?: unknown;
  timestamp?: number;
}

/**
 * ICE server configuration for WebRTC peer connections.
 * Supports STUN and TURN servers with optional credentials.
 */
export interface ICEServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Response from the TURN credentials endpoint.
 * Contains array of ICE servers for WebRTC configuration.
 */
export interface TurnCredentials {
  iceServers: ICEServer[];
}

/**
 * Represents a historical call record from the API.
 * Includes call metadata and all participant information.
 */
export interface CallHistoryItem {
  id: string;
  initiator_id: string;
  call_type: 'video' | 'audio' | 'group';
  state: string;
  duration_seconds: number | null;
  created_at: string;
  participants: {
    user_id: string;
    state: string;
    is_initiator: boolean;
    user: User;
  }[];
}
