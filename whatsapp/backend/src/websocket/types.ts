import { WebSocket } from 'ws';

/**
 * Extended WebSocket interface with user-specific properties.
 * Tracks the authenticated user, connection health, and timing for metrics.
 */
export interface AuthenticatedSocket extends WebSocket {
  userId: string;
  isAlive: boolean;
  connectedAt: number;
}

/**
 * Redis message types for cross-server communication.
 */
export type RedisMessageType =
  | 'deliver_message'
  | 'forward_typing'
  | 'forward_receipt'
  | 'forward_reaction';

/**
 * Base structure for messages routed through Redis pub/sub.
 */
export interface RedisMessage {
  type: RedisMessageType;
  recipientId: string;
  payload: unknown;
}

/**
 * Message delivery via Redis to another server.
 */
export interface RedisDeliverMessage extends RedisMessage {
  type: 'deliver_message';
  senderId: string;
  senderServer: string;
  messageId: string;
  sendStartTime: number;
  payload: unknown;
}

/**
 * Forward typing indicator via Redis.
 */
export interface RedisTypingMessage extends RedisMessage {
  type: 'forward_typing';
  payload: {
    type: 'typing' | 'stop_typing';
    payload: {
      conversationId: string;
      userId: string;
    };
  };
}

/**
 * Forward receipt via Redis.
 */
export interface RedisReceiptMessage extends RedisMessage {
  type: 'forward_receipt';
  payload: {
    type: 'delivery_receipt' | 'read_receipt';
    payload: {
      messageId: string;
      messageIds?: string[];
      recipientId: string;
      status: 'delivered' | 'read';
      timestamp: Date;
    };
  };
}

/**
 * Forward reaction update via Redis.
 */
export interface RedisReactionMessage extends RedisMessage {
  type: 'forward_reaction';
  payload: unknown;
}

/**
 * Union type for all Redis message types.
 */
export type AnyRedisMessage =
  | RedisDeliverMessage
  | RedisTypingMessage
  | RedisReceiptMessage
  | RedisReactionMessage;
